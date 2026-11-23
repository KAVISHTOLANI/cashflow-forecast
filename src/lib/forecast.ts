import { addDays, daysBetween, isValidISODate } from '../shared/dates';

export type Freq =
  | { type: 'once'; date: string }
  | { type: 'weekly'; every: number; start: string }
  | { type: 'monthly'; day: number }
  | { type: 'yearly'; month: number; day: number };

export interface Item {
  id: string;
  name: string;
  kind: 'in' | 'out';
  amount: number;
  freq: Freq;
  enabled: boolean;
  demo?: boolean;
}

export interface Event {
  item: Item;
  date: string;
  delta: number;
}

export interface Day {
  date: string;
  balance: number;
  events: Event[];
}

export const round = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export function occursOn(f: Freq, date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  switch (f.type) {
    case 'once':
      return f.date === date;
    case 'weekly': {
      const diff = daysBetween(f.start, date);
      return diff >= 0 && diff % (7 * f.every) === 0;
    }
    case 'monthly':
      return d === Math.min(f.day, lastDay(y, m));
    case 'yearly':
      return m === f.month && d === Math.min(f.day, lastDay(y, m));
  }
}

export function freqLabel(f: Freq): string {
  if (f.type === 'once') return `Once on ${f.date}`;
  if (f.type === 'weekly') return f.every === 1 ? 'Weekly' : f.every === 2 ? 'Every 2 weeks' : `Every ${f.every} weeks`;
  if (f.type === 'monthly') return f.day >= 31 ? 'Monthly, last day' : `Monthly on day ${f.day}`;
  return `Yearly on ${pad(f.day)}/${pad(f.month)}`;
}

/** Average monthly effect (for the “what’s driving this” list). */
export function monthlyEquivalent(i: Item): number {
  const sign = i.kind === 'in' ? 1 : -1;
  const per = i.freq.type === 'weekly' ? 52 / 12 / i.freq.every : i.freq.type === 'monthly' ? 1 : i.freq.type === 'yearly' ? 1 / 12 : 0;
  return round(sign * i.amount * per);
}

/**
 * Projects the balance day by day. `startBalance` is the balance at the start of `startDate`,
 * so events on `startDate` itself are applied.
 */
export function project(startBalance: number, startDate: string, items: Item[], days: number): Day[] {
  const active = items.filter((i) => i.enabled);
  const out: Day[] = [];
  let bal = startBalance;
  for (let n = 0; n < days; n++) {
    const date = addDays(startDate, n);
    const events = active.filter((i) => occursOn(i.freq, date)).map((item) => ({ item, date, delta: item.kind === 'in' ? item.amount : -item.amount }));
    bal = round(bal + events.reduce((s, e) => s + e.delta, 0));
    out.push({ date, balance: bal, events });
  }
  return out;
}

export function stats(days: Day[], buffer: number) {
  if (!days.length) return { lowest: null, firstBelowBuffer: null, firstNegative: null, daysBelowBuffer: 0, end: 0, totalIn: 0, totalOut: 0 };
  let lowest = days[0];
  for (const d of days) if (d.balance < lowest.balance) lowest = d;
  const all = days.flatMap((d) => d.events);
  return {
    lowest,
    firstBelowBuffer: days.find((d) => d.balance < buffer) ?? null,
    firstNegative: days.find((d) => d.balance < 0) ?? null,
    daysBelowBuffer: days.filter((d) => d.balance < buffer).length,
    end: days[days.length - 1].balance,
    totalIn: round(all.filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0)),
    totalOut: round(-all.filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0)),
  };
}

export function monthlySummary(days: Day[]) {
  const map = new Map<string, { month: string; in: number; out: number; end: number }>();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    const row = map.get(k) ?? { month: k, in: 0, out: 0, end: d.balance };
    for (const e of d.events) e.delta > 0 ? (row.in = round(row.in + e.delta)) : (row.out = round(row.out - e.delta));
    row.end = d.balance;
    map.set(k, row);
  }
  return [...map.values()].map((r) => ({ ...r, net: round(r.in - r.out) }));
}

/** Difference in the end balance and lowest point if one item were switched off. */
export function impactOf(itemId: string, startBalance: number, startDate: string, items: Item[], days: number, buffer: number) {
  const base = stats(project(startBalance, startDate, items, days), buffer);
  const without = stats(project(startBalance, startDate, items.map((i) => (i.id === itemId ? { ...i, enabled: !i.enabled } : i)), days), buffer);
  return { endChange: round(without.end - base.end), lowestChange: round((without.lowest?.balance ?? 0) - (base.lowest?.balance ?? 0)) };
}

export interface Draft {
  name: string;
  kind: 'in' | 'out';
  amount: string;
  type: Freq['type'];
  date: string;
  every: string;
  day: string;
  month: string;
}

export function validate(d: Draft): { errors: Partial<Record<keyof Draft, string>>; freq?: Freq; amount?: number } {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (!d.name.trim()) e.name = 'Name the item.';
  const amount = Number(d.amount);
  if (!d.amount.trim() || !Number.isFinite(amount) || amount <= 0) e.amount = 'Enter an amount greater than 0.';
  if ((d.type === 'once' || d.type === 'weekly') && !isValidISODate(d.date)) e.date = 'Choose a date.';
  const every = Number(d.every);
  if (d.type === 'weekly' && (!Number.isInteger(every) || every < 1 || every > 8)) e.every = 'Every 1–8 weeks.';
  const day = Number(d.day);
  if ((d.type === 'monthly' || d.type === 'yearly') && (!Number.isInteger(day) || day < 1 || day > 31)) e.day = 'Day 1–31.';
  const month = Number(d.month);
  if (d.type === 'yearly' && (!Number.isInteger(month) || month < 1 || month > 12)) e.month = 'Choose a month.';
  if (Object.keys(e).length) return { errors: e };
  const freq: Freq = d.type === 'once' ? { type: 'once', date: d.date } : d.type === 'weekly' ? { type: 'weekly', every, start: d.date } : d.type === 'monthly' ? { type: 'monthly', day } : { type: 'yearly', month, day };
  return { errors: e, freq, amount: round(amount) };
}
