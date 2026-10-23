import { useRef, useState } from "react";
import { parseCourierMatrix, type ParsedCourierFile } from "../../lib/couriers/matrix";
import { buildAudit, type AuditData } from "../../lib/imports/audit";
import { parseMetaMatrix, type ParsedMetaExport } from "../../lib/imports/meta-export";
import { readTable } from "../../lib/imports/readers";
import { buildSampleFiles } from "../../lib/imports/sample-files";
import { parseShopifyMatrix, type ParsedShopifyExport } from "../../lib/imports/shopify-csv";
import { int, money, pct } from "../format";
import { sleep } from "../motion";
import { IconClose, IconFile, IconShield, IconStore, IconTarget, IconTruck, IconUpload } from "./icons";
import { Spinner, Steps, StatusPill, type StepState } from "./ui";

// Real audits from three exports, processed entirely in this browser.

export interface AuditFiles {
  brand: string;
  shopify: { name: string; parsed: ParsedShopifyExport } | null;
  couriers: { name: string; courier: string; parsed: ParsedCourierFile }[];
  meta: { name: string; parsed: ParsedMetaExport } | null;
}

export const emptyAuditFiles: AuditFiles = { brand: "", shopify: null, couriers: [], meta: null };

const COURIER_OPTIONS = [
  ["postex", "PostEx"],
  ["leopards", "Leopards"],
  ["tcs", "TCS"],
  ["trax", "Trax"],
  ["mnp", "M&P"],
  ["callcourier", "Call Courier"],
  ["blueex", "BlueEx"],
  ["other", "Other"],
] as const;

function guessCourier(name: string): string {
  const n = name.toLowerCase();
  for (const [id] of COURIER_OPTIONS) if (n.includes(id)) return id;
  if (n.includes("leopard")) return "leopards";
  if (n.includes("m&p") || n.includes("mnp")) return "mnp";
  return "postex";
}

function fmtDay(d: Date | string | null) {
  if (!d) return "n/a";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function DropZone({ id, label, accept, multiple, onFiles, busy }: { id: string; label: string; accept: string; multiple?: boolean; onFiles: (f: File[]) => void; busy?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      htmlFor={id}
      className={`sx-drop${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      {busy ? <Spinner size={20} /> : <IconUpload size={22} />}
      <strong>{label}</strong>
      <span>Drop the file here or choose it. CSV or Excel (.xlsx).</span>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sx-visually-hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          if (input.current) input.current.value = "";
        }}
      />
    </label>
  );
}

const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function AuditSetup({
  files,
  setFiles,
  onBuilt,
  today,
}: {
  files: AuditFiles;
  setFiles: (f: AuditFiles | ((f: AuditFiles) => AuditFiles)) => void;
  onBuilt: (a: AuditData) => void;
  today: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState<StepState[] | null>(null);

  const read = async (key: string, f: File) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      return await readTable(f);
    } catch (e: any) {
      setErrors((x) => ({ ...x, [key]: e?.message ?? "Could not read this file." }));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onShopify = async (list: File[]) => {
    const f = list[0];
    const m = await read("shopify", f);
    if (!m) return;
    const parsed = parseShopifyMatrix(m);
    if (parsed.error) setErrors((x) => ({ ...x, shopify: parsed.error! }));
    else setFiles((s) => ({ ...s, shopify: { name: f.name, parsed } }));
  };
  const onCourier = async (list: File[]) => {
    for (const f of list) {
      const m = await read("courier", f);
      if (!m) continue;
      const courier = guessCourier(f.name);
      const parsed = parseCourierMatrix(m, courier);
      if (parsed.error) setErrors((x) => ({ ...x, courier: `${f.name}: ${parsed.error}` }));
      else setFiles((s) => ({ ...s, couriers: [...s.couriers.filter((c) => c.name !== f.name), { name: f.name, courier, parsed }] }));
    }
  };
  const onMeta = async (list: File[]) => {
    const f = list[0];
    const m = await read("meta", f);
    if (!m) return;
    const parsed = parseMetaMatrix(m);
    if (parsed.error) setErrors((x) => ({ ...x, meta: parsed.error! }));
    else setFiles((s) => ({ ...s, meta: { name: f.name, parsed } }));
  };

  const loadExamples = async () => {
    const ex = buildSampleFiles(today);
    const mk = (text: string, name: string) => new File([text], name, { type: "text/csv" });
    setFiles({ ...emptyAuditFiles, brand: "Example brand" });
    await onShopify([mk(ex.shopify, "orders_export.csv")]);
    await onCourier([mk(ex.courier, "postex_order_report.csv")]);
    await onMeta([mk(ex.meta, "Ads_Manager_export.csv")]);
  };

  const setCourierType = (name: string, courier: string) =>
    setFiles((s) => ({
      ...s,
      couriers: s.couriers.map((c) => (c.name === name ? { ...c, courier, parsed: { ...c.parsed, parcels: c.parsed.parcels.map((p) => ({ ...p, courier })) } } : c)),
    }));

  const canBuild = Boolean(files.shopify && files.meta);
  const build = async () => {
    if (!files.shopify || !files.meta) return;
    const st: StepState[] = ["doing", "todo", "todo", "todo"];
    setBuilding([...st]);
    const parcels = files.couriers.flatMap((c) => c.parsed.parcels);
    for (let i = 0; i < st.length; i++) {
      st[i] = "doing";
      setBuilding([...st]);
      await sleep(550 + i * 120);
      st[i] = "done";
      setBuilding([...st]);
    }
    const audit = buildAudit({ orders: files.shopify.parsed.orders, parcels, ads: files.meta.parsed.rows });
    await sleep(250);
    setBuilding(null);
    onBuilt(audit);
  };

  const s = files.shopify?.parsed;
  const m = files.meta?.parsed;
  const parcels = files.couriers.reduce((n, c) => n + c.parsed.parcels.length, 0);

  return (
    <div className="sx-audit">
      <section className="sx-audit-intro sx-card sx-rise">
        <div>
          <h2>Audit a brand from three exports</h2>
          <p>
            Drop the Shopify orders export, the courier status report and the Ads Manager export for the same dates. Everything is
            processed inside this browser tab. No file is uploaded anywhere.
          </p>
          <p className="sx-fine"><IconShield size={14} /> Use orders placed 40 to 10 days ago, so almost every parcel already has a final status.</p>
        </div>
        <div className="sx-audit-brand">
          <label className="sx-field" htmlFor="sx-brand">
            <span>Brand name for this audit</span>
            <input id="sx-brand" value={files.brand} placeholder="As it should appear on the report" onChange={(e) => setFiles((f) => ({ ...f, brand: e.target.value }))} />
          </label>
          <button type="button" className="sx-btn" onClick={loadExamples} disabled={busy != null}>Try example files</button>
        </div>
      </section>

      <div className="sx-source-grid">
        <section className="sx-card sx-source sx-rise" style={{ animationDelay: "60ms" }}>
          <header>
            <span className="sx-source-icon"><IconStore size={20} /></span>
            <div>
              <h3>Shopify orders</h3>
              <p>Orders, Export, the date range, CSV.</p>
            </div>
            {s ? <StatusPill state="on">Added</StatusPill> : <StatusPill state="off">Needed</StatusPill>}
          </header>
          {s && files.shopify ? (
            <div className="sx-parsed sx-pop">
              <FileChip name={files.shopify.name} onRemove={() => setFiles((f) => ({ ...f, shopify: null }))} />
              <dl>
                <div><dt>Orders</dt><dd>{int(s.orders.length)}</dd></div>
                <div><dt>Dates</dt><dd>{fmtDay(s.from)} to {fmtDay(s.to)}</dd></div>
                <div><dt>COD share</dt><dd>{pct(s.orders.filter((o) => o.isCod).length / Math.max(1, s.orders.length))}</dd></div>
                <div><dt>With campaign ids</dt><dd>{pct(s.utmShare)}</dd></div>
              </dl>
              {s.utmShare < 0.2 ? (
                <p className="sx-note">No UTMs in this export, so the audit compares all orders against Meta spend at account level. The live app reads UTMs per order and splits by campaign and ad.</p>
              ) : null}
            </div>
          ) : (
            <DropZone id="sx-drop-shopify" label="Shopify orders export" accept={ACCEPT} onFiles={onShopify} busy={busy === "shopify"} />
          )}
          {errors.shopify ? <p className="sx-err">{errors.shopify}</p> : null}
        </section>

        <section className="sx-card sx-source sx-rise" style={{ animationDelay: "120ms" }}>
          <header>
            <span className="sx-source-icon"><IconTruck size={20} /></span>
            <div>
              <h3>Courier status reports</h3>
              <p>PostEx, Leopards, TCS, Trax or any portal export. Add one per courier.</p>
            </div>
            {files.couriers.length ? <StatusPill state="on">{files.couriers.length} added</StatusPill> : <StatusPill state="warn">Recommended</StatusPill>}
          </header>
          {files.couriers.map((c) => (
            <div key={c.name} className="sx-parsed sx-pop">
              <FileChip name={c.name} onRemove={() => setFiles((f) => ({ ...f, couriers: f.couriers.filter((x) => x.name !== c.name) }))} />
              <div className="sx-row">
                <label className="sx-field is-inline" htmlFor={`sx-courier-${c.name}`}>
                  <span>Courier</span>
                  <select id={`sx-courier-${c.name}`} value={c.courier} onChange={(e) => setCourierType(c.name, e.target.value)}>
                    {COURIER_OPTIONS.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </label>
                <span className="sx-fine">{int(c.parsed.parcels.length)} parcels, status read from the {c.parsed.columns.status ?? "status"} column</span>
              </div>
            </div>
          ))}
          <DropZone id="sx-drop-courier" label={files.couriers.length ? "Add another courier report" : "Courier status report"} accept={ACCEPT} multiple onFiles={onCourier} busy={busy === "courier"} />
          {errors.courier ? <p className="sx-err">{errors.courier}</p> : null}
        </section>

        <section className="sx-card sx-source sx-rise" style={{ animationDelay: "180ms" }}>
          <header>
            <span className="sx-source-icon"><IconTarget size={20} /></span>
            <div>
              <h3>Ads Manager export</h3>
              <p>Ads tab, Breakdown by Day, add Campaign ID, Ad ID, Purchases and Purchases conversion value, then Export.</p>
            </div>
            {m ? <StatusPill state="on">Added</StatusPill> : <StatusPill state="off">Needed</StatusPill>}
          </header>
          {m && files.meta ? (
            <div className="sx-parsed sx-pop">
              <FileChip name={files.meta.name} onRemove={() => setFiles((f) => ({ ...f, meta: null }))} />
              <dl>
                <div><dt>Spend</dt><dd>{money(m.rows.reduce((n, r) => n + r.spend, 0), m.currency ?? "PKR")}</dd></div>
                <div><dt>Campaigns</dt><dd>{int(new Set(m.rows.map((r) => r.campaignId)).size)}</dd></div>
                <div><dt>Ads</dt><dd>{m.level === "ad" ? int(new Set(m.rows.map((r) => r.adId)).size) : "campaign level"}</dd></div>
                <div><dt>Dates</dt><dd>{fmtDay(m.from)} to {fmtDay(m.to)}</dd></div>
              </dl>
              {m.warnings.map((w) => (
                <p key={w} className="sx-note">{w}</p>
              ))}
            </div>
          ) : (
            <DropZone id="sx-drop-meta" label="Ads Manager export" accept={ACCEPT} onFiles={onMeta} busy={busy === "meta"} />
          )}
          {errors.meta ? <p className="sx-err">{errors.meta}</p> : null}
        </section>
      </div>

      <section className="sx-card sx-build sx-rise" style={{ animationDelay: "240ms" }}>
        {building ? (
          <Steps
            items={[
              { label: "Grouping Shopify line items into orders", state: building[0], detail: s ? `${int(s.orders.length)} orders` : undefined },
              { label: "Matching courier parcels to orders", state: building[1], detail: parcels ? `${int(parcels)} parcels` : "no courier file, statuses from Shopify only" },
              { label: "Joining Meta spend to campaigns and ads", state: building[2] },
              { label: "Calculating delivered ROAS, RTO and expected ROAS", state: building[3] },
            ]}
          />
        ) : (
          <>
            <div>
              <h3>{canBuild ? "Ready to build the report" : "Add the Shopify and Ads Manager exports to continue"}</h3>
              <p className="sx-fine">
                {files.couriers.length
                  ? "Courier outcomes decide delivered and returned."
                  : "Without a courier report, delivered and returned cannot be told apart, so the result is far less accurate."}
              </p>
            </div>
            <button type="button" className="sx-btn is-primary is-big" disabled={!canBuild} onClick={build}>
              Build delivered ROAS report
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="sx-file">
      <IconFile size={16} />
      <span>{name}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
        <IconClose size={14} />
      </button>
    </span>
  );
}
