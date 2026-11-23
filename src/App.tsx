import { useMemo, useRef, useState, type ReactNode } from 'react';
import { DemoTag, EmptyState, Field, Landing, NotFound, Notice, PageHead, Shell, downloadText, uid, useFlash, usePersistentState, useRoute } from './shared/ui';
import { DataTable, useTable, type Column } from './shared/table';
import { toCSV } from './shared/csv';
import { addDays, daysBetween, formatDay, fromISO, isValidISODate, relativeDays, todayISO } from './shared/dates';
import { freqLabel, impactOf, monthlyEquivalent, monthlySummary, project, round, stats, validate, type Day, type Draft, type Item } from './lib/forecast';

const KEY = 'flowline:store';
const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/forecast', label: 'Forecast' },
  { to: '/items', label: 'Income & costs' },
  { to: '/months', label: 'By month' },
];
const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n) >= 1000 ? `$${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${Math.round(Math.abs(n))}`}`;

interface Settings {
  balance: number;
  asOf: string;
  horizon: number;
  buffer: number;
}
interface Store {
  settings: Settings;
  items: Item[];
}

export function demoStore(today: string): Store {
  const it = (id: string, name: string, kind: Item['kind'], amount: number, freq: Item['freq']): Item => ({ id: `demo-${id}`, name, kind, amount, freq, enabled: true, demo: true });
  return {
    settings: { balance: 1840, asOf: today, horizon: 90, buffer: 500 },
    items: [
      it('pay', 'Salary', 'in', 1180, { type: 'weekly', every: 2, start: addDays(today, 4) }),
      it('side', 'Tutoring', 'in', 120, { type: 'weekly', every: 2, start: addDays(today, 2) }),
      it('rent', 'Rent', 'out', 1450, { type: 'monthly', day: 1 }),
      it('util', 'Utilities', 'out', 140, { type: 'monthly', day: 12 }),
      it('phone', 'Phone and internet', 'out', 70, { type: 'monthly', day: 18 }),
      it('food', 'Groceries', 'out', 110, { type: 'weekly', every: 1, start: addDays(today, 1) }),
      it('transit', 'Transit pass', 'out', 95, { type: 'monthly', day: 28 }),
      it('gym', 'Gym', 'out', 45, { type: 'monthly', day: 5 }),
      it('car', 'Car loan', 'out', 320, { type: 'monthly', day: 8 }),
      it('stream', 'Streaming bundle (video, music and cloud storage)', 'out', 32, { type: 'monthly', day: 20 }),
      it('ins', 'Car insurance (annual)', 'out', 780, { type: 'once', date: addDays(today, 41) }),
      it('gift', 'Holiday gifts', 'out', 350, { type: 'once', date: addDays(today, 24) }),
      it('refund', 'Tax refund (expected)', 'in', 420, { type: 'once', date: addDays(today, 60) }),
    ],
  };
}

export default function App() {
  const [route] = useRoute();
  const today = todayISO();
  const [store, setStore] = usePersistentState<Store>(KEY, () => demoStore(today));
  const ctx = { store, setStore, today };
  const edit = route.match(/^\/item\/(.+)$/);
  let page: ReactNode;
  if (route === '/') page = <Home />;
  else if (route === '/forecast') page = <Forecast {...ctx} />;
  else if (route === '/items') page = <Items {...ctx} />;
  else if (edit) page = <Editor {...ctx} id={edit[1] === 'new' ? undefined : edit[1]} />;
  else if (route === '/months') page = <Months {...ctx} />;
  else page = <NotFound />;
  return (
    <Shell name="Flowline" wordmark={['Flow', 'line']} nav={NAV} route={route} cta={{ to: '/forecast', label: 'See the forecast' }} footerNote="Flowline projects the figures you enter. It is not financial advice and doesn’t connect to any bank.">
      {page}
    </Shell>
  );
}

type Ctx = { store: Store; setStore: (s: Store) => void; today: string };

/* ---------- Line chart ---------- */
export function BalanceChart({ days, buffer, height = 280, compact }: { days: Day[]; buffer: number; height?: number; compact?: boolean }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!days.length) return null;
  const W = 800, H = height, L = 56, R = 12, T = 14, B = 28;
  const vals = days.map((d) => d.balance);
  const lo = Math.min(0, buffer, ...vals), hi = Math.max(buffer, ...vals);
  const pad = (hi - lo) * 0.08 || 100;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => L + (i / Math.max(1, days.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join('');
  const s = stats(days, buffer);
  const lowI = days.indexOf(s.lowest!);
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const monthStarts = days.map((d, i) => ({ d, i })).filter(({ d, i }) => i > 0 && d.date.endsWith('-01'));
  const cur = cursor != null ? days[cursor] : null;
  function onMove(e: React.PointerEvent) {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setCursor(Math.max(0, Math.min(days.length - 1, Math.round(((px - L) / (W - L - R)) * (days.length - 1)))));
  }
  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 7 : 1;
    if (e.key === 'ArrowRight') setCursor(Math.min(days.length - 1, (cursor ?? -1) + step));
    else if (e.key === 'ArrowLeft') setCursor(Math.max(0, (cursor ?? days.length) - step));
    else if (e.key === 'Home') setCursor(0);
    else if (e.key === 'End') setCursor(days.length - 1);
    else return;
    e.preventDefault();
  }
  return (
    <figure className="bchart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={compact ? -1 : 0} aria-label={`Projected balance over ${days.length} days: starts at ${money(days[0].balance)}, lowest ${money(s.lowest!.balance)} on ${formatDay(s.lowest!.date)}, ends at ${money(s.end)}.${compact ? '' : ' Use the left and right arrow keys to read individual days.'}`}
        onPointerMove={onMove} onPointerLeave={() => setCursor(null)} onKeyDown={onKey} onBlur={() => setCursor(null)}>
        <defs><linearGradient id="fl-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{short(t)}</text></g>)}
        {monthStarts.map(({ d, i }) => <g key={d.date}><line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="grid month" /><text x={x(i) + 4} y={H - 8} className="axis">{fromISO(d.date).toLocaleDateString(undefined, { month: 'short' })}</text></g>)}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="zero" />
        {buffer > 0 && <><line x1={L} x2={W - R} y1={y(buffer)} y2={y(buffer)} className="buffer" /><text x={W - R} y={y(buffer) - 6} textAnchor="end" className="axis buffer-lbl">buffer {short(buffer)}</text></>}
        <path d={`${path}L${x(days.length - 1)},${H - B}L${x(0)},${H - B}Z`} fill="url(#fl-fill)" />
        <path d={path} className="line" />
        <circle cx={x(lowI)} cy={y(s.lowest!.balance)} r={6} className={`low ${s.lowest!.balance < buffer ? 'is-under' : ''}`} />
        {!compact && <text x={Math.min(x(lowI) + 10, W - 120)} y={y(s.lowest!.balance) + 18} className="axis low-lbl">lowest {short(s.lowest!.balance)}</text>}
        {cur && (
          <g>
            <line x1={x(cursor!)} x2={x(cursor!)} y1={T} y2={H - B} className="cursor" />
            <circle cx={x(cursor!)} cy={y(cur.balance)} r={5} className="cursor-dot" />
          </g>
        )}
      </svg>
      {!compact && (
        <figcaption className="bchart-cap">
          <p className="small" aria-live="polite" data-testid="chart-readout">
            {cur ? <><strong>{formatDay(cur.date, { weekday: 'short', day: 'numeric', month: 'short' })}: {money(cur.balance)}</strong>{cur.events.length > 0 && <> — {cur.events.map((e) => `${e.item.name} ${e.delta > 0 ? '+' : '−'}${money(Math.abs(e.delta))}`).join(', ')}</>}</> : 'Hover over the chart, or focus it and use the arrow keys, to read any day.'}
          </p>
          <p className="legend"><span><i className="k-line" />Projected balance</span><span><i className="k-buffer" />Safety buffer</span><span><i className="k-zero" />Zero</span><span><i className="k-low" />Lowest point</span></p>
        </figcaption>
      )}
    </figure>
  );
}

function HeroPreview() {
  const today = todayISO();
  const s = demoStore(today);
  const days = project(s.settings.balance, today, s.items, 90);
  const st = stats(days, s.settings.buffer);
  return (
    <div className="hero-fl">
      <div className="hero-fl-kpis">
        <div><span>Today</span><b>{money(s.settings.balance)}</b></div>
        <div><span>Lowest in 90 days</span><b className={st.lowest!.balance < s.settings.buffer ? 'warn' : ''}>{money(st.lowest!.balance)}</b></div>
        <div><span>In 90 days</span><b>{money(st.end)}</b></div>
      </div>
      <BalanceChart days={days} buffer={s.settings.buffer} height={230} compact />
    </div>
  );
}

function Home() {
  return (
    <Landing
      eyebrow="Cash-flow forecast"
      title={<>See the dip <em>before it happens.</em></>}
      lead="Enter today’s balance and the money that regularly comes in and goes out. Flowline plays it forward day by day, shows your lowest point and when you’d drop below your safety buffer — and lets you test what changes if you cut something."
      primary={{ href: '#/forecast', label: 'Open the forecast' }}
      secondary={{ href: '#/items', label: 'Edit income and costs' }}
      previewLabel="Next 90 days — demo figures"
      preview={<HeroPreview />}
      steps={[
        { title: 'Start from today', body: 'Type the balance you have now and a safety buffer you’d rather not go below.' },
        { title: 'Add what repeats', body: 'Pay every two weeks, rent on the 1st, a yearly bill, a one-off refund — each with its real schedule.' },
        { title: 'Read the line', body: 'The chart, the day-by-day ledger and the monthly table show where things get tight.' },
      ]}
      stepsIntro="Flowline opens with labelled, fictional demo figures. Replace them with your own whenever you’re ready."
      features={[
        { title: 'Real schedules', body: 'Weekly, fortnightly, monthly (with month-end handling), yearly and one-off items.' },
        { title: 'What-if switches', body: 'Turn any item off to see how much it changes your lowest point and end balance.' },
        { title: 'Readable chart', body: 'Axis in dollars, month markers, buffer and zero lines, and a keyboard-readable day cursor.' },
        { title: 'Ledger and export', body: 'Every projected transaction with a running balance, downloadable as CSV.' },
      ]}
      note="Flowline only projects the figures you enter. It isn’t financial advice and doesn’t know about anything you leave out."
      closing={{ title: <>Know your <em>tightest week.</em></>, action: { href: '#/forecast', label: 'See the forecast' } }}
    />
  );
}

/* ---------- Forecast ---------- */
function Forecast({ store, setStore, today }: Ctx) {
  const { settings: st, items } = store;
  const [balText, setBalText] = useState(String(st.balance));
  const [bufText, setBufText] = useState(String(st.buffer));
  const [errs, setErrs] = useState<{ bal?: string; buf?: string; date?: string }>({});
  const days = useMemo(() => project(st.balance, st.asOf, items, st.horizon), [st, items]);
  const s = stats(days, st.buffer);
  const [showAll, setShowAll] = useState(false);
  const allEvents = days.flatMap((d) => d.events.map((e) => ({ ...e, after: d.balance })));
  const ledger = showAll ? allEvents : allEvents.slice(0, 20);
  if (items.length === 0)
    return <EmptyState title="Nothing to project yet" actions={<><a className="btn btn-primary" href="#/item/new">Add income or a cost</a><button type="button" className="btn" onClick={() => setStore(demoStore(today))}>Load demo figures</button></>}>Add your pay and your biggest regular costs first.</EmptyState>;
  function commit() {
    const bal = Number(balText), buf = Number(bufText);
    const e: typeof errs = {};
    if (!balText.trim() || !Number.isFinite(bal)) e.bal = 'Enter your current balance (it can be negative).';
    if (!bufText.trim() || !Number.isFinite(buf) || buf < 0) e.buf = 'Buffer must be 0 or more.';
    setErrs(e);
    if (!Object.keys(e).length) setStore({ ...store, settings: { ...st, balance: round(bal), buffer: round(buf) } });
  }
  const stale = st.asOf < today;
  return (
    <div className="stack">
      <PageHead eyebrow="Forecast" title={<>The next <em>{st.horizon} days.</em></>} actions={<button type="button" className="btn" onClick={() => downloadText('flowline-forecast.csv', toCSV(['Date', 'Item', 'Change', 'Balance after'], days.flatMap((d) => d.events.map((e) => [d.date, e.item.name, e.delta.toFixed(2), d.balance.toFixed(2)]))), 'text/csv')}>Export CSV</button>} />
      {stale && <Notice kind="info">Your balance is from {formatDay(st.asOf)}. Update it to today for an accurate forecast. <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStore({ ...store, settings: { ...st, asOf: today } })}>Use today’s date</button></Notice>}
      <form className="card filters" onSubmit={(e) => { e.preventDefault(); commit(); }} noValidate>
        <Field label="Balance (USD)" error={errs.bal}>{(p) => <input {...p} inputMode="decimal" value={balText} onChange={(e) => setBalText(e.target.value)} onBlur={commit} />}</Field>
        <Field label="As of" error={errs.date}>{(p) => <input {...p} type="date" value={st.asOf} onChange={(e) => isValidISODate(e.target.value) ? setStore({ ...store, settings: { ...st, asOf: e.target.value } }) : setErrs({ ...errs, date: 'Choose a date.' })} />}</Field>
        <Field label="Safety buffer" error={errs.buf}>{(p) => <input {...p} inputMode="decimal" value={bufText} onChange={(e) => setBufText(e.target.value)} onBlur={commit} />}</Field>
        <Field label="Look ahead">{(p) => <select {...p} value={st.horizon} onChange={(e) => setStore({ ...store, settings: { ...st, horizon: Number(e.target.value) } })}>{[30, 60, 90, 180, 365].map((h) => <option key={h} value={h}>{h} days</option>)}</select>}</Field>
        <button type="submit" className="btn">Update</button>
      </form>
      <div className="stats" data-testid="kpis">
        <div className="stat"><span className="stat-label">Lowest point</span><span className={`stat-value ${s.lowest!.balance < st.buffer ? 'warn' : ''}`}>{money(s.lowest!.balance)}</span><span className="small muted">{formatDay(s.lowest!.date, { day: 'numeric', month: 'short' })}</span></div>
        <div className="stat"><span className="stat-label">Days under buffer</span><span className="stat-value">{s.daysBelowBuffer}</span><span className="small muted">{s.firstBelowBuffer ? `from ${formatDay(s.firstBelowBuffer.date, { day: 'numeric', month: 'short' })}` : 'never'}</span></div>
        <div className="stat"><span className="stat-label">In / out</span><span className="stat-value">{short(s.totalIn)} / {short(s.totalOut)}</span></div>
        <div className="stat"><span className="stat-label">End balance</span><span className="stat-value">{money(s.end)}</span><span className="small muted">{formatDay(days[days.length - 1].date, { day: 'numeric', month: 'short' })}</span></div>
      </div>
      {s.firstNegative ? <Notice kind="error">Projected to go overdrawn on {formatDay(s.firstNegative.date)} ({relativeDays(daysBetween(today, s.firstNegative.date))}).</Notice> : s.firstBelowBuffer ? <Notice kind="warn">Projected to dip below your {money(st.buffer)} buffer on {formatDay(s.firstBelowBuffer.date)}.</Notice> : <Notice kind="success">Stays above your buffer for the whole period.</Notice>}
      <section className="card stack" aria-labelledby="chart-t"><h2 id="chart-t" className="h3">Projected balance</h2><BalanceChart days={days} buffer={st.buffer} /></section>
      <div className="layout-main">
        <section className="card stack" aria-labelledby="led-t">
          <h2 id="led-t" className="h3">Upcoming</h2>
          <div className="table-wrap"><table className="table">
            <caption className="sr-only">Projected transactions with running balance</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col" className="num">Change</th><th scope="col" className="num">Balance</th></tr></thead>
            <tbody>{ledger.map((e, i) => <tr key={i} className={e.after < st.buffer ? 'under' : ''}><td className="nowrap-cell">{formatDay(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><th scope="row">{e.item.name}</th><td className={`num ${e.delta > 0 ? 'pos' : ''}`}>{e.delta > 0 ? '+' : '−'}{money(Math.abs(e.delta))}</td><td className="num">{money(e.after)}</td></tr>)}</tbody>
          </table></div>
          {allEvents.length > 20 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the next 20 only' : `Show all ${allEvents.length} transactions`}</button>}
        </section>
        <aside className="card stack" aria-labelledby="what-t">
          <h2 id="what-t" className="h3">What if…</h2>
          <p className="small muted">Switch items off to see how the forecast changes. Nothing is deleted.</p>
          <ul className="whatif">
            {items.map((i) => {
              const imp = impactOf(i.id, st.balance, st.asOf, items, st.horizon, st.buffer);
              return (
                <li key={i.id}>
                  <label className="check"><input type="checkbox" checked={i.enabled} onChange={() => setStore({ ...store, items: items.map((x) => (x.id === i.id ? { ...x, enabled: !x.enabled } : x)) })} /> <span className={i.enabled ? '' : 'off'}>{i.name}</span></label>
                  <span className="small mono">{`${imp.endChange > 0 ? '+' : ''}${short(imp.endChange)} if ${i.enabled ? 'off' : 'on'}`}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/* ---------- Items ---------- */
function Items({ store, setStore, today }: Ctx) {
  const [flash, setFlash] = useFlash();
  const columns: Column<Item>[] = [
    { key: 'name', label: 'Item', sort: (i) => i.name, render: (i) => <><a href={`#/item/${i.id}`}>{i.name}</a>{!i.enabled && <span className="badge">Off</span>}{i.demo && <> <DemoTag /></>}</> },
    { key: 'kind', label: 'Type', sort: (i) => i.kind, render: (i) => (i.kind === 'in' ? <span className="pos">Income</span> : 'Cost') },
    { key: 'freq', label: 'When', render: (i) => freqLabel(i.freq) },
    { key: 'amt', label: 'Amount', num: true, sort: (i) => i.amount, render: (i) => money(i.amount) },
    { key: 'mo', label: 'Per month (avg)', num: true, sort: (i) => monthlyEquivalent(i), render: (i) => (i.freq.type === 'once' ? '—' : <span className={monthlyEquivalent(i) > 0 ? 'pos' : ''}>{money(monthlyEquivalent(i))}</span>) },
  ];
  const table = useTable(store.items, columns, { initialSort: 'mo' });
  const net = round(store.items.filter((i) => i.enabled).reduce((s, i) => s + monthlyEquivalent(i), 0));
  return (
    <div className="stack">
      <PageHead eyebrow="Income & costs" title={<>What comes in, <em>what goes out.</em></>} description={`Recurring items average ${money(net)} a month (one-off items excluded).`} actions={<a className="btn btn-primary" href="#/item/new">Add item</a>} />
      {flash && <Notice kind={flash.kind} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      {store.items.length === 0 ? <EmptyState title="No items yet" actions={<><a className="btn btn-primary" href="#/item/new">Add income or a cost</a><button type="button" className="btn" onClick={() => setStore(demoStore(today))}>Load demo figures</button></>} /> : (
        <div className="card stack">
          <DataTable caption="Recurring income and costs" columns={columns} table={table} rowKey={(i) => i.id} />
          {store.items.some((i) => i.demo) && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStore({ ...store, items: store.items.filter((i) => !i.demo) }); setFlash({ kind: 'success', text: 'Demo items removed.' }); }}>Clear demo items</button></div>}
        </div>
      )}
    </div>
  );
}

function Editor({ store, setStore, today, id }: Ctx & { id?: string }) {
  const ex = id ? store.items.find((i) => i.id === id) : undefined;
  const f = ex?.freq;
  const [d, setD] = useState<Draft>({ name: ex?.name ?? '', kind: ex?.kind ?? 'out', amount: ex ? String(ex.amount) : '', type: f?.type ?? 'monthly', date: f?.type === 'once' ? f.date : f?.type === 'weekly' ? f.start : today, every: f?.type === 'weekly' ? String(f.every) : '1', day: f?.type === 'monthly' || f?.type === 'yearly' ? String(f.day) : String(Number(today.slice(8))), month: f?.type === 'yearly' ? String(f.month) : String(Number(today.slice(5, 7))) });
  const [submitted, setSubmitted] = useState(false);
  if (id && !ex) return <EmptyState title="Item not found" actions={<a className="btn btn-primary" href="#/items">Back</a>} />;
  const errors = submitted ? validate(d).errors : {};
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  function save(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const r = validate(d);
    if (!r.freq) return;
    const v = { name: d.name.trim(), kind: d.kind, amount: r.amount!, freq: r.freq };
    if (ex) setStore({ ...store, items: store.items.map((i) => (i.id === ex.id ? { ...ex, ...v, demo: false } : i)) });
    else setStore({ ...store, items: [...store.items, { ...v, id: uid('item'), enabled: true }] });
    window.location.hash = '/items';
  }
  return (
    <div className="stack">
      <PageHead eyebrow={ex ? 'Edit item' : 'New item'} title={ex ? <>Edit <em>{ex.name}</em></> : <>Add income <em>or a cost.</em></>} actions={ex && <button type="button" className="btn btn-danger" onClick={() => { setStore({ ...store, items: store.items.filter((i) => i.id !== ex.id) }); window.location.hash = '/items'; }}>Delete</button>} />
      <form className="card stack" onSubmit={save} noValidate>
        {Object.keys(errors).length > 0 && <Notice kind="error">Please fix the highlighted fields.</Notice>}
        <div className="tabs" role="radiogroup" aria-label="Type">{(['in', 'out'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={d.kind === k} onClick={() => set('kind', k)}>{k === 'in' ? 'Income' : 'Cost'}</button>)}</div>
        <div className="form-grid">
          <Field label="Name" error={errors.name}>{(p) => <input {...p} value={d.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Amount (USD)" error={errors.amount}>{(p) => <input {...p} inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />}</Field>
          <Field label="How often">{(p) => <select {...p} value={d.type} onChange={(e) => set('type', e.target.value as Draft['type'])}><option value="once">Once</option><option value="weekly">Every N weeks</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>}</Field>
          {(d.type === 'once' || d.type === 'weekly') && <Field label={d.type === 'once' ? 'Date' : 'Next date'} error={errors.date}>{(p) => <input {...p} type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />}</Field>}
          {d.type === 'weekly' && <Field label="Every (weeks)" hint="2 = fortnightly" error={errors.every}>{(p) => <input {...p} inputMode="numeric" value={d.every} onChange={(e) => set('every', e.target.value)} />}</Field>}
          {d.type === 'yearly' && <Field label="Month" error={errors.month}>{(p) => <select {...p} value={d.month} onChange={(e) => set('month', e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{fromISO(`2000-${String(i + 1).padStart(2, '0')}-01`).toLocaleDateString(undefined, { month: 'long' })}</option>)}</select>}</Field>}
          {(d.type === 'monthly' || d.type === 'yearly') && <Field label="Day of month" hint="31 = last day" error={errors.day}>{(p) => <input {...p} inputMode="numeric" value={d.day} onChange={(e) => set('day', e.target.value)} />}</Field>}
        </div>
        <div className="row"><button className="btn btn-primary" type="submit">{ex ? 'Save changes' : 'Save item'}</button><a className="btn btn-ghost" href="#/items">Cancel</a></div>
      </form>
    </div>
  );
}

/* ---------- Months ---------- */
function Months({ store }: Ctx) {
  const st = store.settings;
  const days = project(st.balance, st.asOf, store.items, Math.max(st.horizon, 90));
  const rows = monthlySummary(days);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.in, r.out)));
  const [tip, setTip] = useState<string | null>(null);
  const monthName = (m: string) => fromISO(`${m}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'm', label: 'Month', sort: (r) => r.month, render: (r) => monthName(r.month) },
    { key: 'in', label: 'In', num: true, sort: (r) => r.in, render: (r) => <span className="pos">{money(r.in)}</span> },
    { key: 'out', label: 'Out', num: true, sort: (r) => r.out, render: (r) => money(r.out) },
    { key: 'net', label: 'Net', num: true, sort: (r) => r.net, render: (r) => <span className={r.net < 0 ? 'neg' : 'pos'}>{money(r.net)}</span> },
    { key: 'end', label: 'Month-end balance', num: true, sort: (r) => r.end, render: (r) => money(r.end) },
  ];
  const table = useTable(rows, columns, { initialSort: 'm', pageSize: 12 });
  return (
    <div className="stack">
      <PageHead eyebrow="By month" title={<>Month <em>by month.</em></>} description="Partial first and last months include only the days in the forecast." />
      <section className="card stack" aria-labelledby="io-t">
        <h2 id="io-t" className="h3">Money in and out</h2>
        <div className="io-chart" role="img" aria-label={rows.map((r) => `${monthName(r.month)}: in ${money(r.in)}, out ${money(r.out)}`).join('; ')} onMouseLeave={() => setTip(null)}>
          {rows.map((r, i) => {
            const text = `${monthName(r.month)} — in ${money(r.in)}, out ${money(r.out)}, net ${money(r.net)}`;
            return (
              <div key={r.month} className="io-col" tabIndex={0} aria-label={text} style={{ ['--i' as string]: i }} onMouseEnter={() => setTip(text)} onFocus={() => setTip(text)} onBlur={() => setTip(null)}>
                <div className="io-pair"><span className="io-in" style={{ height: `${(r.in / max) * 100}%` }} /><span className="io-out" style={{ height: `${(r.out / max) * 100}%` }} /></div>
                <span className="bar-label mono">{fromISO(`${r.month}-01`).toLocaleDateString(undefined, { month: 'short' })}</span>
              </div>
            );
          })}
        </div>
        <p className="small" aria-live="polite">{tip ?? 'Hover or focus a month for the figures.'}</p>
        <p className="legend"><span><i className="k-in" />In</span><span><i className="k-out" />Out</span><span className="muted">· bar height relative to the largest month ({money(max)})</span></p>
      </section>
      <div className="card"><DataTable caption="Monthly summary" columns={columns} table={table} rowKey={(r) => r.month} /></div>
      <p className="small muted">Projection from {formatDay(st.asOf)} to {formatDay(addDays(st.asOf, days.length - 1))}.</p>
    </div>
  );
}
