import { describe, expect, it } from 'vitest';
import { freqLabel, impactOf, monthlyEquivalent, monthlySummary, occursOn, project, stats, validate, type Draft, type Item } from './forecast';

const item = (p: Partial<Item>): Item => ({ id: 'x', name: 'X', kind: 'out', amount: 100, freq: { type: 'monthly', day: 1 }, enabled: true, ...p });

describe('schedules', () => {
  it('handles once, weekly, month-end and yearly dates', () => {
    expect(occursOn({ type: 'once', date: '2026-12-01' }, '2026-12-01')).toBe(true);
    const fortnightly = { type: 'weekly', every: 2, start: '2026-11-20' } as const;
    expect(['2026-11-20', '2026-11-27', '2026-12-04', '2026-11-06'].map((d) => occursOn(fortnightly, d))).toEqual([true, false, true, false]);
    expect(occursOn({ type: 'monthly', day: 31 }, '2027-02-28')).toBe(true);
    expect(occursOn({ type: 'monthly', day: 31 }, '2027-02-27')).toBe(false);
    expect(occursOn({ type: 'yearly', month: 2, day: 29 }, '2027-02-28')).toBe(true);
  });
  it('labels and averages frequencies', () => {
    expect(freqLabel({ type: 'weekly', every: 2, start: '2026-01-01' })).toBe('Every 2 weeks');
    expect(freqLabel({ type: 'monthly', day: 31 })).toBe('Monthly, last day');
    expect(monthlyEquivalent(item({ kind: 'in', amount: 1200, freq: { type: 'weekly', every: 2, start: '2026-01-01' } }))).toBe(2600);
    expect(monthlyEquivalent(item({ amount: 600, freq: { type: 'yearly', month: 3, day: 1 } }))).toBe(-50);
    expect(monthlyEquivalent(item({ freq: { type: 'once', date: '2026-01-01' } }))).toBe(-0);
  });
});

describe('projection', () => {
  const items = [
    item({ id: 'pay', kind: 'in', amount: 2000, freq: { type: 'monthly', day: 25 } }),
    item({ id: 'rent', amount: 1500, freq: { type: 'monthly', day: 1 } }),
    item({ id: 'off', amount: 999, freq: { type: 'monthly', day: 2 }, enabled: false }),
  ];
  const days = project(300, '2026-11-23', items, 40); // to 2027-01-01
  it('applies events on their days, including the start date', () => {
    expect(days[0].balance).toBe(300);
    expect(days.find((d) => d.date === '2026-11-25')!.balance).toBe(2300);
    expect(days.find((d) => d.date === '2026-12-01')!.balance).toBe(800);
    expect(days.find((d) => d.date === '2026-12-02')!.events).toEqual([]);
    expect(project(100, '2026-12-01', items, 1)[0].balance).toBe(-1400);
  });
  it('finds the low point, buffer breaches and totals', () => {
    const s = stats(days, 500);
    expect(s.lowest!.balance).toBe(300);
    expect(s.firstBelowBuffer!.date).toBe('2026-11-23');
    expect(s.firstNegative).toBeNull();
    expect(s.totalIn).toBe(4000);
    expect(s.totalOut).toBe(3000);
    expect(s.end).toBe(1300);
  });
  it('summarises by month', () => {
    expect(monthlySummary(days).map((m) => [m.month, m.in, m.out, m.net, m.end])).toEqual([
      ['2026-11', 2000, 0, 2000, 2300],
      ['2026-12', 2000, 1500, 500, 2800],
      ['2027-01', 0, 1500, -1500, 1300],
    ]);
  });
  it('measures the impact of switching an item', () => {
    expect(impactOf('rent', 300, '2026-11-23', items, 40, 0).endChange).toBe(3000);
    expect(impactOf('off', 300, '2026-11-23', items, 40, 0).endChange).toBe(-999);
  });
});

describe('validation', () => {
  const d: Draft = { name: '', kind: 'out', amount: '0', type: 'weekly', date: '', every: '9', day: '1', month: '1' };
  it('reports relevant errors', () => {
    expect(Object.keys(validate(d).errors).sort()).toEqual(['amount', 'date', 'every', 'name']);
  });
  it('builds a frequency', () => {
    expect(validate({ ...d, name: 'Gym', amount: '30', type: 'monthly', day: '15' })).toMatchObject({ freq: { type: 'monthly', day: 15 }, amount: 30 });
  });
});
