import { useMemo, useState, type ReactNode } from "react";
import type { CapiLogRow, Report } from "../../lib/types";
import { CampaignTable, CityTable, HeroPanel, InsightsPanel, MethodNote, SignalsTable, TrendChart } from "../Dashboard";
import { int, money, pct, roas } from "../format";
import { IconCampaigns, IconCheck, IconChevron, IconCities, IconCopy, IconLock, IconPlug, IconSignals, IconStore, IconTarget, IconTruck } from "./icons";
import { Bar, Ring, StatusPill, useToast } from "./ui";

export type View = "overview" | "campaigns" | "cities" | "signals" | "integrations";

export interface SourceState {
  shopify: boolean;
  courier: boolean;
  meta: boolean;
}

export interface Accuracy {
  score: number;
  parts: { label: string; value: number; note: string }[];
}

export function computeAccuracy(r: Report | null, s: SourceState, courierCoverage: number): Accuracy {
  const utm = r && r.totals.orders ? 1 - r.unattributed.orders / r.totals.orders : 0;
  const parts = [
    { label: "Orders imported", value: s.shopify ? 1 : 0, note: s.shopify ? "every order in range" : "connect Shopify" },
    { label: "Courier outcome known", value: s.courier ? courierCoverage : 0, note: s.courier ? "dispatched orders with a status" : "connect a courier" },
    { label: "Meta spend", value: s.meta ? 1 : 0, note: s.meta ? "ad level, daily" : "connect Meta Ads" },
    { label: "Orders with campaign ids", value: s.shopify && s.meta ? Math.max(0, utm) : 0, note: "UTM template on every ad" },
  ];
  const score = 0.3 * parts[0].value + 0.35 * parts[1].value + 0.2 * parts[2].value + 0.15 * parts[3].value;
  return { score, parts };
}

function Locked({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <section className="sx-card sx-locked sx-rise">
      <span className="sx-locked-icon">{icon}</span>
      <div>
        <h3><IconLock size={14} /> {title}</h3>
        <p>{body}</p>
      </div>
      {action}
    </section>
  );
}

export function SetupStrip({ sources, onOpen }: { sources: SourceState; onOpen: () => void }) {
  const items = [
    { key: "shopify", label: "Shopify store", icon: <IconStore size={16} />, done: sources.shopify },
    { key: "courier", label: "Courier status", icon: <IconTruck size={16} />, done: sources.courier },
    { key: "meta", label: "Meta Ads", icon: <IconTarget size={16} />, done: sources.meta },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === 3) return null;
  return (
    <section className="sx-card sx-setup sx-rise" aria-label="Setup">
      <div className="sx-setup-text">
        <strong>{done} of 3 connected</strong>
        <span>Delivered ROAS needs all three: orders from Shopify, outcomes from your courier, and spend from Meta.</span>
        <Bar value={done / 3} />
      </div>
      <ol className="sx-setup-steps">
        {items.map((i) => (
          <li key={i.key} className={i.done ? "is-done" : ""}>
            <span className="sx-setup-mark">{i.done ? <IconCheck size={14} /> : i.icon}</span>
            {i.label}
          </li>
        ))}
      </ol>
      <button type="button" className="sx-btn is-primary" onClick={onOpen}>
        Connect {items.find((i) => !i.done)?.label} <IconChevron size={14} />
      </button>
    </section>
  );
}

export function AccuracyCard({ accuracy }: { accuracy: Accuracy }) {
  return (
    <section className="sx-card sx-accuracy sx-rise" aria-label="Report accuracy">
      <div className="sx-accuracy-head">
        <Ring value={accuracy.score} size={72} label={`Report accuracy ${Math.round(accuracy.score * 100)} out of 100`} />
        <div>
          <h3>Report accuracy</h3>
          <p>How much of the real outcome these numbers are built on.</p>
        </div>
      </div>
      <ul>
        {accuracy.parts.map((p) => (
          <li key={p.label}>
            <span className="sx-acc-label">{p.label}<small>{p.note}</small></span>
            <span className="sx-acc-val">{pct(p.value)}</span>
            <Bar value={p.value} tone={p.value >= 0.85 ? "good" : p.value >= 0.5 ? "warn" : "bad"} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OverviewView(props: {
  report: Report | null;
  sources: SourceState;
  accuracy: Accuracy;
  breakEven: number;
  onConnect: () => void;
  go: (v: View) => void;
}) {
  const { report: r, sources } = props;
  if (!r || !sources.shopify) {
    return (
      <div className="sx-stack">
        <SetupStrip sources={sources} onOpen={props.onConnect} />
        <Locked
          icon={<IconStore size={22} />}
          title="Connect your Shopify store first"
          body="Orders are the base of every number here. Once the store is connected, the last 60 days import in about a minute."
          action={<button type="button" className="sx-btn is-primary" onClick={props.onConnect}>Connect Shopify</button>}
        />
      </div>
    );
  }
  return (
    <div className="sx-stack">
      <SetupStrip sources={sources} onOpen={props.onConnect} />
      {sources.courier && sources.meta ? (
        <div className="sx-overview-top">
          <HeroPanel report={r} breakEven={props.breakEven} />
          <AccuracyCard accuracy={props.accuracy} />
        </div>
      ) : (
        <div className="sx-overview-top">
          <Locked
            icon={sources.meta ? <IconTruck size={22} /> : <IconTarget size={22} />}
            title={sources.meta ? "Delivered ROAS needs courier status" : "ROAS needs Meta spend"}
            body={
              sources.meta
                ? `Meta reports ${roas(r.totals.metaRoas)} on ${money(r.totals.spend, r.currency, true)} of spend. Without courier outcomes nobody can say how much of that was delivered.`
                : `${int(r.store.orders)} orders are in. Connect Meta Ads to compare them with spend, campaign by campaign.`
            }
            action={<button type="button" className="sx-btn is-primary" onClick={props.onConnect}>Connect {sources.meta ? "a courier" : "Meta Ads"}</button>}
          />
          <AccuracyCard accuracy={props.accuracy} />
        </div>
      )}
      {sources.courier && sources.meta ? <InsightsPanel report={r} /> : null}
      {sources.meta ? <TrendChart report={r} /> : null}
      {sources.meta ? (
        <section className="sx-section sx-rise">
          <div className="sx-section-head">
            <h2 className="dr-h2">Top campaigns</h2>
            <button type="button" className="sx-link" onClick={() => props.go("campaigns")}>All campaigns and ads <IconChevron size={14} /></button>
          </div>
          <CampaignTable report={sources.courier ? r : { ...r, campaignJoin: false }} breakEven={props.breakEven} limit={5} />
        </section>
      ) : null}
      {sources.courier ? (
        <section className="sx-section sx-rise">
          <div className="sx-section-head">
            <h2 className="dr-h2">Cities returning the most</h2>
            <button type="button" className="sx-link" onClick={() => props.go("cities")}>Every city <IconChevron size={14} /></button>
          </div>
          <CityTable cities={r.cities} average={r.totals.rtoPct ?? r.store.returned / Math.max(1, r.store.delivered + r.store.returned)} currency={r.currency} limit={5} />
        </section>
      ) : null}
      <MethodNote />
    </div>
  );
}

export function CampaignsView({ report, sources, breakEven, onConnect }: { report: Report | null; sources: SourceState; breakEven: number; onConnect: () => void }) {
  if (!report || !sources.shopify || !sources.meta) {
    return <Locked icon={<IconCampaigns size={22} />} title="Campaigns need Shopify and Meta Ads" body="Spend comes from Meta, orders from Shopify, and the UTM ids on each order tie them together." action={<button type="button" className="sx-btn is-primary" onClick={onConnect}>Open integrations</button>} />;
  }
  const r = sources.courier ? report : { ...report, campaignJoin: false };
  const best = [...report.campaigns].filter((c) => c.deliveredRoas != null && c.spend > 0).sort((a, b) => (b.deliveredRoas ?? 0) - (a.deliveredRoas ?? 0))[0];
  return (
    <div className="sx-stack">
      {r.campaignJoin === false ? (
        <p className="sx-note sx-rise">
          {sources.courier
            ? "These orders carry no campaign ids, so spend and Meta ROAS show per campaign while delivered results stay at account level on Overview."
            : "Connect a courier to add delivered ROAS, RTO and cost per delivered order to every campaign and ad."}
        </p>
      ) : (
        <div className="sx-chips sx-rise">
          <span className="sx-chip">{report.campaigns.length} campaigns</span>
          <span className="sx-chip">{int(report.campaigns.reduce((n, c) => n + (c.children?.length ?? 0), 0))} ads</span>
          {best ? <span className="sx-chip is-good">Best delivered: {best.name} at {roas(best.deliveredRoas)}</span> : null}
          <span className="sx-chip">Click a campaign to open its ads, click a column to sort</span>
        </div>
      )}
      <CampaignTable report={r} breakEven={breakEven} />
    </div>
  );
}

export function CitiesView({ report, sources, onConnect }: { report: Report | null; sources: SourceState; onConnect: () => void }) {
  const toast = useToast();
  if (!report || !sources.shopify || !sources.courier) {
    return <Locked icon={<IconCities size={22} />} title="City RTO needs courier status" body="Returned parcels come from your courier. Connect one to see which cities send your parcels back." action={<button type="button" className="sx-btn is-primary" onClick={onConnect}>Connect a courier</button>} />;
  }
  const avg = report.totals.rtoPct ?? report.store.returned / Math.max(1, report.store.delivered + report.store.returned);
  const restrict = report.cities.filter((c) => c.rtoPct != null && c.rtoPct >= avg * 1.4 && c.delivered + c.returned >= 20);
  const list = restrict.map((c) => c.label).join(", ");
  const lost = restrict.reduce((n, c) => n + c.lostValue, 0);
  return (
    <div className="sx-stack">
      {restrict.length ? (
        <section className="sx-card sx-exclude sx-rise">
          <div>
            <h3>{restrict.length} cities to exclude from prospecting</h3>
            <p>
              They returned {money(lost, report.currency)} of orders in this range. Paste the list into the location exclusions of your sales
              campaigns, or ask for advance payment there.
            </p>
            <code>{list}</code>
          </div>
          <button
            type="button"
            className="sx-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(list);
                toast({ tone: "good", title: "Exclusion list copied", body: `${restrict.length} cities` });
              } catch {
                toast({ tone: "info", title: "Copy is blocked here", body: "Select the list and copy it by hand." });
              }
            }}
          >
            <IconCopy size={16} /> Copy list
          </button>
        </section>
      ) : null}
      <CityTable cities={report.cities} average={avg} currency={report.currency} />
    </div>
  );
}

export function SignalsView({
  rows,
  fresh,
  sources,
  currency,
  onConnect,
  live,
}: {
  rows: CapiLogRow[];
  fresh: Set<string>;
  sources: SourceState;
  currency: string;
  onConnect: () => void;
  live: boolean;
}) {
  const counts = useMemo(() => {
    const c = { ConfirmedOrder: 0, DeliveredOrder: 0, ReturnedOrder: 0 } as Record<string, number>;
    for (const r of rows) c[r.eventName] = (c[r.eventName] ?? 0) + 1;
    return c;
  }, [rows]);
  if (!sources.meta || !sources.shopify) {
    return <Locked icon={<IconSignals size={22} />} title="Signals start once Meta Ads is connected" body="Confirmed, delivered and returned orders go to your pixel through the Conversions API, so Meta learns which buyers actually pay." action={<button type="button" className="sx-btn is-primary" onClick={onConnect}>Connect Meta Ads</button>} />;
  }
  if (!live) {
    return (
      <Locked
        icon={<IconSignals size={22} />}
        title="Signals run in the installed app"
        body="An audit from files reads history. Sending ConfirmedOrder and DeliveredOrder to Meta needs the live connection, which keeps sending them every hour."
      />
    );
  }
  return (
    <div className="sx-stack">
      <div className="sx-signal-cards">
        {(
          [
            ["ConfirmedOrder", "Optimize on this. Sent the same day the order is confirmed.", "accent"],
            ["DeliveredOrder", "The truth. Sent when the courier delivers, with the value.", "good"],
            ["ReturnedOrder", "Builds an audience of buyers to exclude.", "bad"],
          ] as const
        ).map(([name, hint, tone]) => (
          <section key={name} className={`sx-card sx-signal tone-${tone} sx-rise`}>
            <span className={`dr-event dr-event-${name}`}>{name}</span>
            <strong className="sx-signal-num">{int(counts[name] ?? 0)}</strong>
            <small>sent recently</small>
            <p>{hint}</p>
          </section>
        ))}
      </div>
      <section className="sx-section sx-rise">
        <div className="sx-section-head">
          <h2 className="dr-h2">Live event log</h2>
          <StatusPill state="busy">Sending</StatusPill>
        </div>
        <SignalsTable rows={rows.slice(0, 60)} currency={currency} freshIds={fresh} />
      </section>
    </div>
  );
}

export interface ConnectionCard {
  key: "shopify" | "courier" | "meta";
  title: string;
  icon: ReactNode;
  connected: boolean;
  lines: string[];
  lastSync?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  connectLabel: string;
  extraAction?: ReactNode;
}

export function IntegrationsView({ cards, footer }: { cards: ConnectionCard[]; footer?: ReactNode }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="sx-stack">
      <div className="sx-int-grid">
        {cards.map((c, i) => (
          <section key={c.key} className={`sx-card sx-int sx-rise${c.connected ? " is-on" : ""}`} style={{ animationDelay: `${i * 70}ms` }}>
            <header>
              <span className="sx-source-icon">{c.icon}</span>
              <h3>{c.title}</h3>
              <StatusPill state={c.connected ? "on" : "off"}>{c.connected ? "Connected" : "Not connected"}</StatusPill>
            </header>
            <ul className="sx-int-lines">
              {c.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {c.lastSync ? <p className="sx-fine">Last sync {c.lastSync}</p> : null}
            <div className="sx-actions">
              {confirm === c.key ? (
                <>
                  <span className="sx-fine">Disconnect {c.title}?</span>
                  <button type="button" className="sx-btn" onClick={() => setConfirm(null)}>Keep</button>
                  <button
                    type="button"
                    className="sx-btn is-danger"
                    onClick={() => {
                      setConfirm(null);
                      c.onDisconnect?.();
                    }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  {c.extraAction}
                  {c.connected && c.onDisconnect ? (
                    <button type="button" className="sx-btn is-ghost" onClick={() => setConfirm(c.key)}>Disconnect</button>
                  ) : null}
                  <button type="button" className={`sx-btn${c.connected ? "" : " is-primary"}`} onClick={c.onConnect}>
                    {c.connectLabel}
                  </button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {footer}
    </div>
  );
}

export const VIEW_META: Record<View, { label: string; icon: ReactNode }> = {
  overview: { label: "Overview", icon: null },
  campaigns: { label: "Campaigns", icon: <IconCampaigns /> },
  cities: { label: "Cities", icon: <IconCities /> },
  signals: { label: "Meta signals", icon: <IconSignals /> },
  integrations: { label: "Integrations", icon: <IconPlug /> },
};
