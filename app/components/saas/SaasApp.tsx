import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildDemoData } from "../../lib/demo";
import { auditReport, type AuditData } from "../../lib/imports/audit";
import { computeReport, resolveRange } from "../../lib/metrics";
import type { CapiLogRow } from "../../lib/types";
import { useBreakEven } from "../Dashboard";
import { int, rangeLabel, timeAgo } from "../format";
import { sleep, useInterval } from "../motion";
import { AuditSetup, emptyAuditFiles, type AuditFiles } from "./audit";
import {
  IconAudit,
  IconCampaigns,
  IconChevronDown,
  IconCities,
  IconMenu,
  IconOverview,
  IconPlug,
  IconSignals,
  IconStore,
  IconSync,
  IconTarget,
  IconTruck,
} from "./icons";
import { Ring, Spinner, ToastProvider, useToast } from "./ui";
import {
  CampaignsView,
  CitiesView,
  IntegrationsView,
  OverviewView,
  SignalsView,
  computeAccuracy,
  type ConnectionCard,
  type View,
} from "./views";
import { CourierWizard, MetaWizard, ShopifyWizard, type CourierConn, type MetaConn, type ShopifyConn } from "./wizards";

type Workspace = "sample" | "audit";

const PRESETS = [
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "settled", label: "Settled", title: "Orders placed 40 to 10 days ago, when almost every parcel has a final status" },
];

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <IconOverview /> },
  { id: "campaigns", label: "Campaigns", icon: <IconCampaigns /> },
  { id: "cities", label: "Cities", icon: <IconCities /> },
  { id: "signals", label: "Meta signals", icon: <IconSignals /> },
  { id: "integrations", label: "Integrations", icon: <IconPlug /> },
];

export function SaasApp({ today }: { today: string }) {
  return (
    <ToastProvider>
      <Shell today={today} />
    </ToastProvider>
  );
}

function Shell({ today }: { today: string }) {
  const toast = useToast();
  const demo = useMemo(() => buildDemoData(today), [today]);
  const dispatchedSample = useMemo(() => demo.orders.filter((o) => o.status === "DELIVERED" || o.status === "RETURNED" || o.status === "IN_TRANSIT").length, [demo]);

  const [workspace, setWorkspace] = useState<Workspace>("sample");
  const [view, setView] = useState<View>("overview");
  const [preset, setPreset] = useState("30d");
  const [breakEven, setBreakEven] = useBreakEven();
  const [navOpen, setNavOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [modal, setModal] = useState<null | "shopify" | "courier" | "meta">(null);

  // Sample workspace: starts fully connected so the product opens in a working state
  const [shop, setShop] = useState<ShopifyConn | null>({ domain: "demo-fashion.myshopify.com", orders: demo.orders.length });
  const [couriers, setCouriers] = useState<CourierConn[]>([
    { id: "postex", label: "PostEx", method: "api", parcels: Math.round(dispatchedSample * 0.7), matched: Math.round(dispatchedSample * 0.7 * 0.993) },
    { id: "leopards", label: "Leopards", method: "api", parcels: Math.round(dispatchedSample * 0.3), matched: Math.round(dispatchedSample * 0.3 * 0.993) },
  ]);
  const [meta, setMeta] = useState<MetaConn | null>({
    account: "Demo Fashion Co. Ads",
    accountId: "act_1182004211709",
    pixel: "Demo Fashion Pixel (1460229381776540)",
    events: { confirmed: true, delivered: true, returned: true },
  });
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(() => new Date(Date.now() - 12 * 60_000).toISOString());

  // Live event feed for the sample store
  const [events, setEvents] = useState<CapiLogRow[]>(demo.capiLog);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const feedOn = workspace === "sample" && Boolean(shop && meta && couriers.length);
  useInterval(() => {
    const pool = demo.orders.filter((o) => o.utmCampaign && o.status !== "CANCELLED").slice(-500);
    const o = pool[Math.floor(Math.random() * pool.length)];
    if (!o) return;
    const kinds = ["ConfirmedOrder", "ConfirmedOrder", "DeliveredOrder", "DeliveredOrder", "ReturnedOrder"] as const;
    const name = kinds[Math.floor(Math.random() * kinds.length)];
    const id = `live_${seq.current++}`;
    const now = new Date().toISOString();
    setEvents((list) => [
      { id, orderName: o.name, eventName: name, eventTime: now, value: name === "ReturnedOrder" ? null : o.total, status: "SENT", source: "website", error: null, sentAt: now },
      ...list.slice(0, 199),
    ]);
    setFresh(new Set([id]));
  }, feedOn ? 5200 : null);

  // Audit workspace
  const [auditFiles, setAuditFiles] = useState<AuditFiles>(emptyAuditFiles);
  const [audit, setAudit] = useState<AuditData | null>(null);

  const sources =
    workspace === "sample"
      ? { shopify: Boolean(shop), courier: couriers.length > 0, meta: Boolean(meta) }
      : { shopify: Boolean(audit), courier: Boolean(audit) && auditFiles.couriers.length > 0, meta: Boolean(audit) };

  const report = useMemo(() => {
    if (workspace === "sample") {
      if (!shop) return null;
      const range = resolveRange(preset, today);
      return computeReport(demo.orders, meta ? demo.ads : [], { since: range.since, until: range.until, currency: "PKR" });
    }
    return audit ? auditReport(audit, preset, "PKR") : null;
  }, [workspace, shop, meta, preset, today, demo, audit]);

  const courierCoverage =
    workspace === "sample"
      ? Math.min(1, couriers.reduce((n, c) => n + c.matched, 0) / Math.max(1, dispatchedSample))
      : (audit?.stats.dispatchedWithOutcome ?? 0);
  const accuracy = computeAccuracy(report, sources, courierCoverage);
  const connectedCount = [sources.shopify, sources.courier, sources.meta].filter(Boolean).length;

  // Close the mobile drawer and the workspace menu on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setWsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (v: View) => {
    setView(v);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };
  const switchWorkspace = (w: Workspace) => {
    setWorkspace(w);
    setWsOpen(false);
    setNavOpen(false);
    setView(w === "audit" && !audit ? "integrations" : "overview");
    setPreset(w === "audit" ? "all" : "30d");
  };

  const sync = async () => {
    setSyncing(true);
    await sleep(1700);
    setSyncing(false);
    setLastSync(new Date().toISOString());
    toast({ tone: "good", title: "Synced", body: "17 parcel updates from PostEx and Leopards, spend refreshed, 6 events sent to Meta." });
  };

  const storeName = workspace === "sample" ? "Demo Fashion Co." : auditFiles.brand.trim() || "Audit from exports";
  const presets = workspace === "audit" ? [{ id: "all", label: "All dates" }, ...PRESETS] : PRESETS;
  const title = view === "integrations" && workspace === "audit" ? "Exports" : NAV.find((n) => n.id === view)!.label;

  const sampleCards: ConnectionCard[] = [
    {
      key: "shopify",
      title: "Shopify",
      icon: <IconStore size={20} />,
      connected: Boolean(shop),
      lines: shop
        ? [shop.domain, `${int(shop.orders)} orders imported, updates arrive within seconds`, "Checkout pixel active"]
        : ["Orders, cities and UTMs come from here", "One click install, no code"],
      lastSync: shop ? timeAgo(lastSync) : undefined,
      onConnect: () => setModal("shopify"),
      onDisconnect: () => {
        setShop(null);
        toast({ tone: "info", title: "Shopify disconnected" });
      },
      connectLabel: shop ? "Reinstall" : "Connect Shopify",
    },
    {
      key: "courier",
      title: "Couriers",
      icon: <IconTruck size={20} />,
      connected: couriers.length > 0,
      lines: couriers.length
        ? couriers.map((c) => `${c.label}: ${int(c.matched)} parcels matched${c.method === "api" ? ", live API" : ", status file"}`)
        : ["PostEx and Leopards over their APIs", "TCS, Trax, M&P and others from a status export"],
      lastSync: couriers.length ? timeAgo(lastSync) : undefined,
      onConnect: () => setModal("courier"),
      onDisconnect: () => {
        setCouriers([]);
        toast({ tone: "info", title: "Couriers disconnected" });
      },
      connectLabel: couriers.length ? "Add a courier" : "Connect a courier",
    },
    {
      key: "meta",
      title: "Meta Ads",
      icon: <IconTarget size={20} />,
      connected: Boolean(meta),
      lines: meta
        ? [
            `${meta.account} (${meta.accountId})`,
            `Pixel: ${meta.pixel}`,
            `Sending ${[meta.events.confirmed && "ConfirmedOrder", meta.events.delivered && "DeliveredOrder", meta.events.returned && "ReturnedOrder"].filter(Boolean).join(", ") || "no events"}`,
          ]
        : ["Spend and Meta reported purchases per ad, per day", "Sends confirmed and delivered orders back to your pixel"],
      lastSync: meta ? timeAgo(lastSync) : undefined,
      onConnect: () => setModal("meta"),
      onDisconnect: () => {
        setMeta(null);
        toast({ tone: "info", title: "Meta Ads disconnected" });
      },
      connectLabel: meta ? "Change account" : "Connect Meta Ads",
    },
  ];

  return (
    <div className={`sx${navOpen ? " is-nav-open" : ""}`}>
      <aside className="sx-side" aria-label="Main">
        <div className="sx-brand">
          <span className="sx-logo" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Delivered ROAS</strong>
            <small>by Better Sales</small>
          </span>
        </div>

        <div className="sx-ws">
          <button type="button" className="sx-ws-btn" aria-expanded={wsOpen} onClick={() => setWsOpen((o) => !o)}>
            <span className={`sx-ws-dot ${workspace === "sample" ? "is-sample" : "is-audit"}`} aria-hidden="true" />
            <span className="sx-ws-name">
              <strong>{storeName}</strong>
              <small>{workspace === "sample" ? "Sample data" : "Your exports"}</small>
            </span>
            <IconChevronDown size={16} />
          </button>
          {wsOpen ? (
            <div className="sx-ws-menu sx-pop" role="menu">
              <button type="button" role="menuitem" className={workspace === "sample" ? "is-on" : ""} onClick={() => switchWorkspace("sample")}>
                <IconStore size={16} />
                <span>
                  <strong>Demo Fashion Co.</strong>
                  <small>Sample store with live connections</small>
                </span>
              </button>
              <button type="button" role="menuitem" className={workspace === "audit" ? "is-on" : ""} onClick={() => switchWorkspace("audit")}>
                <IconAudit size={16} />
                <span>
                  <strong>Audit from exports</strong>
                  <small>Real numbers from your own files</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <nav className="sx-nav">
          {NAV.map((n) => (
            <button key={n.id} type="button" className={view === n.id ? "is-on" : ""} aria-current={view === n.id ? "page" : undefined} onClick={() => go(n.id)}>
              {n.icon}
              <span>{n.id === "integrations" && workspace === "audit" ? "Exports" : n.label}</span>
              {n.id === "integrations" && connectedCount < 3 ? <em className="sx-badge">{connectedCount}/3</em> : null}
              {n.id === "signals" && feedOn ? <em className="sx-live" aria-label="live" /> : null}
            </button>
          ))}
        </nav>

        <div className="sx-side-foot">
          <div className="sx-side-acc">
            <Ring value={accuracy.score} size={40} stroke={4} label={`Report accuracy ${Math.round(accuracy.score * 100)}`} />
            <span>
              <strong>Report accuracy</strong>
              <small>{connectedCount} of 3 sources</small>
            </span>
          </div>
        </div>
      </aside>
      <button type="button" className="sx-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} tabIndex={navOpen ? 0 : -1} />

      <div className="sx-main">
        <header className="sx-top">
          <button type="button" className="sx-icon-btn sx-menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <IconMenu />
          </button>
          <div className="sx-title">
            <h1>{title}</h1>
            <p>
              {storeName}
              {report && view !== "integrations" ? ` · orders placed ${rangeLabel(report.since, report.until)}` : ""}
            </p>
          </div>
          {view !== "integrations" ? (
            <div className="sx-top-tools">
              <div className="dr-seg" role="group" aria-label="Date range">
                {presets.map((p) => (
                  <button key={p.id} type="button" className={p.id === preset ? "is-on" : ""} aria-pressed={p.id === preset} title={"title" in p ? p.title : undefined} onClick={() => setPreset(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="dr-be" htmlFor="sx-break-even">
                Break even
                <input id="sx-break-even" type="number" min={0.5} max={10} step={0.1} value={breakEven} onChange={(e) => Number(e.target.value) > 0 && setBreakEven(Number(e.target.value))} />
              </label>
            </div>
          ) : null}
          <div className="sx-top-sync">
            {workspace === "sample" ? (
              <>
                <span className="sx-synced">
                  <span className={`sx-pulse${syncing ? " is-busy" : ""}`} aria-hidden="true" />
                  {syncing ? "Syncing" : `Synced ${timeAgo(lastSync)}`}
                </span>
                <button type="button" className="sx-btn" onClick={sync} disabled={syncing || !shop}>
                  {syncing ? <Spinner size={14} /> : <IconSync size={16} />} Sync now
                </button>
              </>
            ) : (
              <button type="button" className="sx-btn" onClick={() => go("integrations")}>
                <IconAudit size={16} /> {audit ? "Change files" : "Add exports"}
              </button>
            )}
            <span className="sx-avatar" aria-hidden="true">BS</span>
          </div>
        </header>

        <main className="sx-view" key={`${workspace}:${view}`}>
          {view === "overview" ? (
            workspace === "audit" && !audit ? (
              <AuditEmpty onOpen={() => go("integrations")} />
            ) : (
              <OverviewView report={report} sources={sources} accuracy={accuracy} breakEven={breakEven} onConnect={() => go("integrations")} go={go} />
            )
          ) : null}
          {view === "campaigns" ? <CampaignsView report={report} sources={sources} breakEven={breakEven} onConnect={() => go("integrations")} /> : null}
          {view === "cities" ? <CitiesView report={report} sources={sources} onConnect={() => go("integrations")} /> : null}
          {view === "signals" ? (
            <SignalsView rows={events} fresh={fresh} sources={sources} currency="PKR" onConnect={() => go("integrations")} live={workspace === "sample"} />
          ) : null}
          {view === "integrations" ? (
            workspace === "sample" ? (
              <IntegrationsView
                cards={sampleCards}
                footer={
                  <p className="sx-note">
                    This is the sample store, so connections run on sample data. Switch to Audit from exports in the menu to get real numbers
                    from a brand&apos;s own files today.
                  </p>
                }
              />
            ) : (
              <AuditSetup
                files={auditFiles}
                setFiles={setAuditFiles}
                today={today}
                onBuilt={(a) => {
                  setAudit(a);
                  setPreset("all");
                  setView("overview");
                  toast({ tone: "good", title: "Report ready", body: `${int(a.stats.orders)} orders, ${int(a.stats.parcelsMatched)} parcels matched.` });
                }}
              />
            )
          ) : null}
        </main>
      </div>

      {modal === "shopify" ? (
        <ShopifyWizard
          orders={demo.orders.length}
          onClose={() => setModal(null)}
          onDone={(c) => {
            setShop(c);
            setModal(null);
            setLastSync(new Date().toISOString());
            toast({ tone: "good", title: "Shopify connected", body: `${int(c.orders)} orders imported.` });
          }}
        />
      ) : null}
      {modal === "courier" ? (
        <CourierWizard
          parcels={dispatchedSample}
          connected={couriers.map((c) => c.id)}
          onClose={() => setModal(null)}
          onDone={(c) => {
            setCouriers((l) => [...l.filter((x) => x.id !== c.id), c]);
            setModal(null);
            setLastSync(new Date().toISOString());
            toast({ tone: "good", title: `${c.label} connected`, body: `${int(c.matched)} parcels matched to orders.` });
          }}
        />
      ) : null}
      {modal === "meta" ? (
        <MetaWizard
          ads={demo.ads.length}
          onClose={() => setModal(null)}
          onDone={(c) => {
            setMeta(c);
            setModal(null);
            setLastSync(new Date().toISOString());
            toast({ tone: "good", title: "Meta Ads connected", body: c.account });
          }}
        />
      ) : null}
    </div>
  );
}

function AuditEmpty({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="sx-card sx-locked sx-rise">
      <span className="sx-locked-icon">
        <IconAudit size={22} />
      </span>
      <div>
        <h3>No exports yet</h3>
        <p>Add the Shopify orders export, a courier status report and the Ads Manager export. The report builds in a few seconds, right here in the browser.</p>
      </div>
      <button type="button" className="sx-btn is-primary" onClick={onOpen}>
        Add exports
      </button>
    </section>
  );
}
