import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CapiLogRow, CityRow, Report, ReportRow } from "../lib/types";
import { RANGE_PRESETS } from "../lib/metrics";
import { int, money, pct, rangeLabel, roas, roasTone, rtoTone, shortDate, timeAgo } from "./format";
import { buildInsights } from "./insights";
import { useCountUp } from "./motion";

// Report building blocks shared by the embedded Shopify app, the public demo and the SaaS shell.

const BE_KEY = "dr.breakEven";

export function useBreakEven(): [number, (v: number) => void] {
  const [breakEven, setBreakEven] = useState(2);
  // Read after mount so the server render and the first client render match
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(BE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v > 0 && v < 20) setBreakEven(v);
    } catch {
      /* storage blocked */
    }
  }, []);
  const save = (v: number) => {
    setBreakEven(v);
    try {
      window.localStorage.setItem(BE_KEY, String(v));
    } catch {
      /* storage blocked: keep it for this visit only */
    }
  };
  return [breakEven, save];
}

export function RangeControls(props: {
  preset: string;
  onPresetChange: (id: string) => void;
  breakEven: number;
  onBreakEven: (v: number) => void;
}) {
  return (
    <div className="dr-controls">
      <div className="dr-seg" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === props.preset ? "is-on" : ""}
            aria-pressed={p.id === props.preset}
            onClick={() => props.onPresetChange(p.id)}
            title={p.label}
          >
            {p.id === "settled" ? "Settled" : p.label.replace("Last ", "")}
          </button>
        ))}
      </div>
      <label className="dr-be" htmlFor="dr-break-even">
        Break even ROAS
        <input
          id="dr-break-even"
          type="number"
          min={0.5}
          max={10}
          step={0.1}
          value={props.breakEven}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) props.onBreakEven(v);
          }}
        />
      </label>
    </div>
  );
}

function Animated({ value, format }: { value: number | null | undefined; format: (n: number | null) => string }) {
  const v = useCountUp(value ?? null);
  return <>{format(v)}</>;
}

export function HeroPanel({ report: r, breakEven }: { report: Report; breakEven: number }) {
  const t = r.totals;
  const cur = r.currency;
  return (
    <section className="dr-hero dr-rise" aria-label="Headline numbers">
      <div className="dr-versus">
        <div className="dr-figure dr-figure-meta">
          <span className="dr-figure-label">Meta says</span>
          <span className="dr-figure-value">
            <Animated value={t.metaRoas} format={roas} />
          </span>
          <span className="dr-figure-note">{money(t.metaValue, cur, true)} purchase value</span>
        </div>
        <div className="dr-arrow" aria-hidden="true">
          <svg viewBox="0 0 40 16" width="40" height="16">
            <path d="M2 8h32M28 2l7 6-7 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="dr-figure dr-figure-real">
          <span className="dr-figure-label">Delivered, cash in hand</span>
          <span className={`dr-figure-value tone-${roasTone(t.deliveredRoas, breakEven)}`}>
            <Animated value={t.deliveredRoas} format={roas} />
          </span>
          <span className="dr-figure-note">{money(t.deliveredRevenue, cur, true)} delivered revenue</span>
        </div>
        {t.overstatement != null && t.overstatement > 1 ? (
          <p className="dr-gap">
            Meta shows <strong>{pct(t.overstatement - 1)} more</strong> than what reached your bank.
          </p>
        ) : null}
      </div>
      <dl className="dr-stats">
        <Stat label="Ad spend" value={<Animated value={t.spend} format={(n) => money(n, cur)} />} />
        <Stat label="Delivered orders" value={`${int(t.delivered)} of ${int(t.orders)}`} />
        <Stat label="RTO" value={<Animated value={t.rtoPct} format={(n) => pct(n)} />} tone={rtoTone(t.rtoPct, 0.2)} hint="Returned ÷ (delivered + returned)" />
        <Stat label="Cost per delivered order" value={<Animated value={t.costPerDelivered} format={(n) => money(n, cur)} />} />
        <Stat
          label="In transit"
          value={int(t.inTransit)}
          hint={t.inTransit || t.pendingValue ? `Expected ROAS ${roas(t.expectedRoas)} once they land` : "Every parcel has a final status"}
        />
        <Stat label="Blended ROAS" value={roas(r.store.blendedRoas)} hint="All store delivered revenue ÷ Meta spend" />
      </dl>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="dr-stat">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
      {hint ? <dd className="dr-stat-hint">{hint}</dd> : null}
    </div>
  );
}

export function InsightsPanel({ report }: { report: Report }) {
  const insights = useMemo(() => buildInsights(report), [report]);
  if (!insights.length) return null;
  return (
    <section className="dr-insights" aria-label="Findings">
      <h2 className="dr-h2">What to do with this</h2>
      <ul>
        {insights.map((i, idx) => (
          <li key={i.label} className={`dr-insight tone-${i.tone} dr-rise`} style={{ animationDelay: `${120 + idx * 70}ms` }}>
            <span className="dr-insight-label">{i.label}</span>
            <span className="dr-insight-text">{i.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type SortKey = "spend" | "metaRoas" | "deliveredRoas" | "expectedRoas" | "rtoPct" | "delivered" | "costPerDelivered";

const COLUMNS: { key: SortKey; label: string; title: string; needsOrders?: boolean }[] = [
  { key: "spend", label: "Spend", title: "Amount spent in the range" },
  { key: "metaRoas", label: "Meta ROAS", title: "Purchase value Meta reports ÷ spend" },
  { key: "deliveredRoas", label: "Delivered ROAS", title: "Delivered revenue ÷ spend", needsOrders: true },
  { key: "expectedRoas", label: "Expected", title: "Delivered ROAS plus parcels still moving at this row's delivery rate", needsOrders: true },
  { key: "rtoPct", label: "RTO", title: "Returned ÷ parcels with a final status", needsOrders: true },
  { key: "delivered", label: "Delivered", title: "Delivered orders of all orders", needsOrders: true },
  { key: "costPerDelivered", label: "Cost per delivered", title: "Spend ÷ delivered orders", needsOrders: true },
];

function sortRows(rows: ReportRow[], key: SortKey, dir: 1 | -1) {
  return [...rows].sort((a, b) => (((a[key] ?? -Infinity) as number) > ((b[key] ?? -Infinity) as number) ? dir : -dir));
}

export function CampaignTable({ report, breakEven, limit }: { report: Report; breakEven: number; limit?: number }) {
  const join = report.campaignJoin !== false;
  const cols = join ? COLUMNS : COLUMNS.filter((c) => !c.needsOrders);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(() => new Set(report.campaigns[0] && join ? [report.campaigns[0].key] : []));
  const rows = useMemo(() => {
    const sorted = sortRows(report.campaigns, sort.key, sort.dir);
    return limit ? sorted.slice(0, limit) : sorted;
  }, [report.campaigns, sort, limit]);
  const avgRto = report.totals.rtoPct;
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const cells = (row: ReportRow) => (
    <>
      <td className="num">{money(row.spend, report.currency)}</td>
      <td className="num dr-meta-col">{roas(row.metaRoas)}</td>
      {join ? (
        <>
          <td className={`num dr-strong tone-${roasTone(row.deliveredRoas, breakEven)}`}>
            <RoasCell value={row.deliveredRoas} meta={row.metaRoas} />
          </td>
          <td className="num dr-muted-num">{row.inTransit || row.pendingValue ? roas(row.expectedRoas) : roas(row.deliveredRoas)}</td>
          <td className={`num tone-${rtoTone(row.rtoPct, avgRto)}`}>{pct(row.rtoPct)}</td>
          <td className="num">
            {int(row.delivered)}
            <span className="dr-of"> / {int(row.orders)}</span>
            {row.inTransit ? <span className="dr-transit" title="Parcels still in transit"> +{int(row.inTransit)}</span> : null}
          </td>
          <td className="num">{money(row.costPerDelivered, report.currency)}</td>
        </>
      ) : null}
    </>
  );

  return (
    <div className="dr-table-wrap" role="region" aria-label="Campaigns and ads" tabIndex={0}>
      <table className="dr-table">
        <thead>
          <tr>
            <th scope="col" className="dr-name-col">Campaign and ad</th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className="num" title={c.title} aria-sort={sort.key === c.key ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
                <button type="button" className="dr-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((s.dir * -1) as 1 | -1) : -1 }))}>
                  {c.label}
                  <span aria-hidden="true" className="dr-sort-mark">{sort.key === c.key ? (sort.dir === -1 ? "▾" : "▴") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const isOpen = open.has(c.key);
            const kids = sortRows(c.children ?? [], sort.key, sort.dir);
            return (
              <Fragment key={c.key}>
                <tr className="dr-row-campaign">
                  <th scope="row" className="dr-name-col">
                    <button type="button" className="dr-expand" aria-expanded={isOpen} onClick={() => toggle(c.key)} disabled={!kids.length}>
                      <span className={`dr-caret${isOpen ? " is-open" : ""}`} aria-hidden="true">{kids.length ? "▸" : ""}</span>
                      <span className="dr-row-name">{c.name}</span>
                      {kids.length ? <span className="dr-count">{kids.length} ads</span> : null}
                    </button>
                  </th>
                  {cells(c)}
                </tr>
                {isOpen
                  ? kids.map((a, i) => (
                      <tr key={a.key} className="dr-row-ad dr-fade" style={{ animationDelay: `${i * 35}ms` }}>
                        <th scope="row" className="dr-name-col">
                          <span className="dr-row-name">{a.name}</span>
                        </th>
                        {cells(a)}
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
          {join && report.unattributed.orders ? (
            <tr className="dr-row-unattr">
              <th scope="row" className="dr-name-col">
                <span className="dr-row-name">Unattributed Meta orders</span>
                <span className="dr-count">no campaign id on the order</span>
              </th>
              <td className="num">n/a</td>
              <td className="num">n/a</td>
              <td className="num">n/a</td>
              <td className="num">n/a</td>
              <td className={`num tone-${rtoTone(report.unattributed.rtoPct, avgRto)}`}>{pct(report.unattributed.rtoPct)}</td>
              <td className="num">
                {int(report.unattributed.delivered)}
                <span className="dr-of"> / {int(report.unattributed.orders)}</span>
              </td>
              <td className="num">n/a</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="dr-row-total">
            <th scope="row" className="dr-name-col">{join ? "All Meta orders" : "All campaigns"}</th>
            {cells(report.totals)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Delivered ROAS with a thin bar showing how much of Meta's claim survived delivery. */
function RoasCell({ value, meta }: { value: number | null; meta: number | null }) {
  const share = value != null && meta ? Math.max(0, Math.min(1, value / meta)) : null;
  return (
    <span className="dr-roas-cell">
      {roas(value)}
      {share != null ? (
        <span className="dr-keep" aria-hidden="true" title={`${pct(share)} of Meta's number survives delivery`}>
          <span style={{ width: `${share * 100}%` }} />
        </span>
      ) : null}
    </span>
  );
}

export function CityTable({ cities, average, currency, limit }: { cities: CityRow[]; average: number | null; currency: string; limit?: number }) {
  const [minOnly, setMinOnly] = useState(true);
  const list = useMemo(() => {
    const l = cities.filter((c) => !minOnly || c.delivered + c.returned >= 20).sort((a, b) => (b.rtoPct ?? -1) - (a.rtoPct ?? -1));
    return limit ? l.slice(0, limit) : l;
  }, [cities, minOnly, limit]);
  const max = Math.max(0.01, ...list.map((c) => c.rtoPct ?? 0));
  return (
    <div className="dr-cities">
      <div className="dr-cities-bar">
        <p>
          Account average RTO <strong>{pct(average)}</strong>. Cities marked Restrict return at least 40% more than that.
        </p>
        <label className="dr-check" htmlFor="dr-min-parcels">
          <input id="dr-min-parcels" type="checkbox" checked={minOnly} onChange={(e) => setMinOnly(e.target.checked)} />
          Only cities with 20+ final parcels
        </label>
      </div>
      <div className="dr-table-wrap" role="region" aria-label="RTO by city" tabIndex={0}>
        <table className="dr-table">
          <thead>
            <tr>
              <th scope="col" className="dr-name-col">City</th>
              <th scope="col" className="num">Orders</th>
              <th scope="col" className="num">Delivered</th>
              <th scope="col" className="num">Returned</th>
              <th scope="col" className="dr-bar-col">RTO</th>
              <th scope="col" className="num">Value returned</th>
              <th scope="col" className="num">Share of orders</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => {
              const tone = rtoTone(c.rtoPct, average);
              const restrict = average != null && c.rtoPct != null && c.rtoPct >= average * 1.4 && c.delivered + c.returned >= 20;
              return (
                <tr key={c.city}>
                  <th scope="row" className="dr-name-col">
                    <span className="dr-row-name">{c.label}</span>
                    {restrict ? <span className="dr-pill tone-bad">Restrict</span> : null}
                  </th>
                  <td className="num">{int(c.orders)}</td>
                  <td className="num">{int(c.delivered)}</td>
                  <td className="num">{int(c.returned)}</td>
                  <td className="dr-bar-col">
                    <span className="dr-bar">
                      <span
                        className={`dr-bar-fill tone-bg-${tone}`}
                        style={{ width: `${((c.rtoPct ?? 0) / max) * 100}%`, animationDelay: `${i * 30}ms` }}
                      />
                    </span>
                    <span className={`dr-bar-val tone-${tone}`}>{pct(c.rtoPct)}</span>
                  </td>
                  <td className="num">{money(c.lostValue, currency)}</td>
                  <td className="num">{pct(c.share, 1)}</td>
                </tr>
              );
            })}
            {!list.length ? (
              <tr>
                <td colSpan={7} className="dr-none">No city has 20 final parcels yet in this range. Untick the filter to see every city.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SignalsTable({ rows, currency, freshIds }: { rows: CapiLogRow[]; currency: string; freshIds?: Set<string> }) {
  if (!rows.length) {
    return <p className="dr-none">No events sent yet. They start once an order is confirmed, delivered or returned.</p>;
  }
  return (
    <div className="dr-table-wrap" role="region" aria-label="Signals sent to Meta" tabIndex={0}>
      <table className="dr-table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Order</th>
            <th scope="col" className="num">Value</th>
            <th scope="col">Happened</th>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={freshIds?.has(e.id) ? "dr-row-fresh" : undefined}>
              <td>
                <span className={`dr-event dr-event-${e.eventName}`}>{e.eventName}</span>
              </td>
              <td className="mono">{e.orderName}</td>
              <td className="num">{e.value != null ? money(e.value, currency) : "n/a"}</td>
              <td>{timeAgo(e.eventTime)}</td>
              <td className="mono">{e.source ?? "n/a"}</td>
              <td>
                <span className={`dr-pill tone-${e.status === "SENT" ? "good" : e.status === "QUEUED" ? "info" : e.status === "FAILED" ? "bad" : "warn"}`}>
                  {e.status.toLowerCase()}
                </span>
                {e.error ? <span className="dr-err">{e.error}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendChart({ report }: { report: Report }) {
  const W = 760;
  const H = 230;
  const pad = { l: 56, r: 16, t: 16, b: 30 };
  const d = report.daily;
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (d.length < 2) return null;

  const maxV = Math.max(1, ...d.map((p) => Math.max(p.metaValue, p.expectedRevenue, p.deliveredRevenue)));
  // Round the top of the scale to a clean step so every tick label is a real value on the axis
  const step = niceStep(maxV / 4);
  const top = Math.ceil(maxV / step) * step;
  const x = (i: number) => pad.l + (i / (d.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const line = (k: "metaValue" | "deliveredRevenue") => d.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const area = `${line("deliveredRevenue")} L${x(d.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(d.length / 8));
  // Regular labels stop short of the last day so the final label never collides with one
  const showLabel = (i: number) => i === d.length - 1 || (i % labelEvery === 0 && d.length - 1 - i >= labelEvery * 0.75);
  const inLakh = top >= 100_000;
  const tickLabel = (v: number) => (v === 0 ? "0" : inLakh ? `${Number((v / 100_000).toFixed(2))}L` : `${Math.round(v / 1000)}K`);
  const hasExpected = d.some((p) => p.expectedRevenue - p.deliveredRevenue > 1);
  // The dashed projection only matters where parcels are still open; elsewhere it equals the solid line
  const firstOpen = d.findIndex((p) => p.expectedRevenue - p.deliveredRevenue > 1);
  const expPath =
    firstOpen < 0
      ? ""
      : d
          .map((p, i) => ({ p, i }))
          .filter(({ i }) => i >= Math.max(0, firstOpen - 1))
          .map(({ p, i }, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.expectedRevenue).toFixed(1)}`)
          .join(" ");

  const onMove = (e: React.PointerEvent) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * (d.length - 1));
    setHover(Math.max(0, Math.min(d.length - 1, i)));
  };
  const h = hover != null ? d[hover] : null;
  const animKey = `${report.since}:${report.until}:${d.length}`;

  return (
    <section className="dr-trend dr-rise" aria-label="Daily revenue, Meta reported against delivered">
      <div className="dr-trend-head">
        <h2 className="dr-h2">Daily revenue, Meta reported against delivered</h2>
        <ul className="dr-legend">
          <li><span className="dr-key dr-key-meta" />Meta reported</li>
          <li><span className="dr-key dr-key-real" />Delivered</li>
          {hasExpected ? <li><span className="dr-key dr-key-exp" />Expected with parcels still moving</li> : null}
        </ul>
      </div>
      <div
        className="dr-chart-wrap"
        ref={wrap}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg key={animKey} viewBox={`0 0 ${W} ${H}`} className="dr-chart" role="img" aria-label="Line chart of daily Meta reported revenue and delivered revenue">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="dr-grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="dr-axis">{tickLabel(v)}</text>
            </g>
          ))}
          {d.map((p, i) =>
            showLabel(i) ? (
              <text key={p.date} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === d.length - 1 ? "end" : "middle"} className="dr-axis">
                {shortDate(p.date)}
              </text>
            ) : null,
          )}
          <path d={area} className="dr-area" />
          <path d={line("metaValue")} className="dr-line-meta dr-draw" fill="none" pathLength={1} />
          {hasExpected ? <path d={expPath} className="dr-line-exp" fill="none" /> : null}
          <path d={line("deliveredRevenue")} className="dr-line-real dr-draw" fill="none" pathLength={1} />
          <circle cx={x(d.length - 1)} cy={y(d[d.length - 1].deliveredRevenue)} r={3.5} className="dr-dot" />
          {h && hover != null ? (
            <g className="dr-cross">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="dr-cross-line" />
              <circle cx={x(hover)} cy={y(h.metaValue)} r={4} className="dr-cross-meta" />
              <circle cx={x(hover)} cy={y(h.deliveredRevenue)} r={4.5} className="dr-cross-real" />
            </g>
          ) : null}
        </svg>
        {h && hover != null ? (
          <div
            className="dr-tip"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > d.length * 0.6 ? "calc(-100% - 12px)" : "12px"})` }}
            role="status"
          >
            <strong>{shortDate(h.date)}</strong>
            <span><i className="dr-key dr-key-meta" />Meta {money(h.metaValue, report.currency)}</span>
            <span><i className="dr-key dr-key-real" />Delivered {money(h.deliveredRevenue, report.currency)}</span>
            {h.expectedRevenue - h.deliveredRevenue > 1 ? (
              <span><i className="dr-key dr-key-exp" />Expected {money(h.expectedRevenue, report.currency)}</span>
            ) : null}
            <span className="dr-tip-spend">Spend {money(h.spend, report.currency)}</span>
          </div>
        ) : null}
      </div>
      {hasExpected ? (
        <p className="dr-trend-note">Recent days sit low because parcels take 3 to 8 days to deliver. The dashed line shows where they are heading.</p>
      ) : null}
    </section>
  );
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

export function MethodNote() {
  return (
    <details className="dr-method">
      <summary>How these numbers are calculated</summary>
      <ul>
        <li>Orders are grouped by the day they were placed, and joined to Meta campaigns and ads through the utm_campaign and utm_content ids on the order.</li>
        <li>Delivered ROAS is the revenue of delivered parcels divided by ad spend. Returned, cancelled and never dispatched orders count as zero.</li>
        <li>RTO is returned parcels divided by parcels with a final status. Parcels still moving are shown as in transit.</li>
        <li>Expected ROAS adds parcels in transit, and recent orders not booked yet, at the delivery rate the campaign has earned so far.</li>
        <li>Meta orders that arrive without campaign ids sit in their own Unattributed row so the totals stay honest.</li>
      </ul>
    </details>
  );
}

export interface DashboardProps {
  report: Report;
  storeName: string;
  preset: string;
  onPresetChange: (id: string) => void;
  mode: "app" | "demo";
  syncNote?: string | null;
  capiLog?: CapiLogRow[];
  notice?: ReactNode;
}

type Tab = "campaigns" | "cities" | "signals";

/** The single page report used inside the Shopify admin. */
export function Dashboard(props: DashboardProps) {
  const { report: r } = props;
  const [tab, setTab] = useState<Tab>("campaigns");
  const [breakEven, setBreakEven] = useBreakEven();
  const t = r.totals;
  const empty = t.spend === 0 && t.orders === 0;

  return (
    <div className="dr">
      <header className="dr-head">
        <div className="dr-head-title">
          <span className="dr-brand">
            <span className="dr-brand-mark" aria-hidden="true" />
            Delivered ROAS
          </span>
          <h1 className="dr-store">{props.storeName}</h1>
          <p className="dr-sub">
            Orders placed {rangeLabel(r.since, r.until)}
            {props.syncNote ? <span className="dr-sync"> · {props.syncNote}</span> : null}
          </p>
        </div>
        <RangeControls preset={props.preset} onPresetChange={props.onPresetChange} breakEven={breakEven} onBreakEven={setBreakEven} />
      </header>

      {props.notice}

      {empty ? (
        <section className="dr-empty">
          <h2>No orders or ad spend in this range yet</h2>
          <p>
            Once the first orders sync from Shopify and spend arrives from Meta, this page fills in on its own. Courier
            status adds delivered and returned outcomes within the hour.
          </p>
        </section>
      ) : (
        <>
          <HeroPanel report={r} breakEven={breakEven} />
          <InsightsPanel report={r} />
          <TrendChart report={r} />
          <nav className="dr-tabs" aria-label="Report views">
            <button type="button" className={tab === "campaigns" ? "is-on" : ""} aria-pressed={tab === "campaigns"} onClick={() => setTab("campaigns")}>
              Campaigns and ads
            </button>
            <button type="button" className={tab === "cities" ? "is-on" : ""} aria-pressed={tab === "cities"} onClick={() => setTab("cities")}>
              RTO by city
            </button>
            {props.capiLog ? (
              <button type="button" className={tab === "signals" ? "is-on" : ""} aria-pressed={tab === "signals"} onClick={() => setTab("signals")}>
                Signals sent to Meta
              </button>
            ) : null}
          </nav>
          {tab === "campaigns" ? <CampaignTable report={r} breakEven={breakEven} /> : null}
          {tab === "cities" ? <CityTable cities={r.cities} average={t.rtoPct} currency={r.currency} /> : null}
          {tab === "signals" && props.capiLog ? <SignalsTable rows={props.capiLog} currency={r.currency} /> : null}
          <MethodNote />
        </>
      )}
    </div>
  );
}
