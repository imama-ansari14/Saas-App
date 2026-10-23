import { useEffect, useState } from "react";
import { int } from "../format";
import { sleep } from "../motion";
import { IconCheck, IconFile, IconShield, IconTarget, IconTruck, IconStore } from "./icons";
import { Bar, CountUp, DoneMark, Modal, Spinner, Steps, type StepState } from "./ui";

// Connection flows for the sample workspace. They walk through exactly what the installed app
// does (install, token test, Meta login, first sync) on sample data, so a brand sees the product.

export interface ShopifyConn { domain: string; orders: number }
export interface CourierConn { id: string; label: string; method: "api" | "file"; parcels: number; matched: number }
export interface MetaConn { account: string; accountId: string; pixel: string; events: { confirmed: boolean; delivered: boolean; returned: boolean } }

type Run = { label: string; detail?: string; ms: number };

function useRunner(runs: Run[], start: boolean) {
  const [states, setStates] = useState<StepState[]>(runs.map(() => "todo"));
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!start) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < runs.length; i++) {
        if (!alive) return;
        setStates((s) => s.map((x, j) => (j === i ? "doing" : x)));
        await sleep(runs[i].ms);
        if (!alive) return;
        setStates((s) => s.map((x, j) => (j === i ? "done" : x)));
      }
      if (alive) setFinished(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  return { items: runs.map((r, i) => ({ label: r.label, detail: r.detail, state: states[i] })), finished, states };
}

/* ---------------- Shopify ---------------- */

export function ShopifyWizard({ onClose, onDone, orders }: { onClose: () => void; onDone: (c: ShopifyConn) => void; orders: number }) {
  const [step, setStep] = useState<"domain" | "consent" | "sync">("domain");
  const [domain, setDomain] = useState("demo-fashion.myshopify.com");
  const valid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain.trim().toLowerCase());
  const runner = useRunner(
    [
      { label: "App installed on your store", ms: 700 },
      { label: "Importing the last 60 days of orders", detail: `${int(orders)} orders, phone and email hashed before storage`, ms: 2200 },
      { label: "Checkout pixel switched on", detail: "captures Meta browser ids at checkout", ms: 900 },
      { label: "Listening for new and updated orders", ms: 700 },
    ],
    step === "sync",
  );
  const importing = runner.states[1];

  return (
    <Modal title="Connect Shopify" subtitle="One click install. Orders sync on their own after that." onClose={onClose}>
      {step === "domain" ? (
        <form
          className="sx-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setStep("consent");
          }}
        >
          <label className="sx-field" htmlFor="sx-shop-domain">
            <span>Store address</span>
            <input id="sx-shop-domain" value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="off" spellCheck={false} />
            <small className={valid ? "" : "is-bad"}>{valid ? "Your myshopify.com address, found under Settings, Domains." : "Use the address that ends in .myshopify.com"}</small>
          </label>
          <div className="sx-actions">
            <button type="submit" className="sx-btn is-primary" disabled={!valid}>
              Continue to Shopify
            </button>
          </div>
        </form>
      ) : null}

      {step === "consent" ? (
        <div className="sx-consent sx-pop">
          <div className="sx-consent-head">
            <span className="sx-app-chip"><IconStore size={16} /> {domain}</span>
            <h3>Install Delivered ROAS</h3>
            <p>Delivered ROAS by Better Sales will be able to:</p>
          </div>
          <ul className="sx-perms">
            <li><IconCheck size={16} /> View orders from the last 60 days and new ones as they come</li>
            <li><IconCheck size={16} /> View customer details, stored only as SHA256 hashes</li>
            <li><IconCheck size={16} /> Add a checkout pixel that reads Meta browser ids</li>
          </ul>
          <p className="sx-fine"><IconShield size={14} /> No raw phone, email or name is ever stored.</p>
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("domain")}>Back</button>
            <button type="button" className="sx-btn is-primary" onClick={() => setStep("sync")}>Install app</button>
          </div>
        </div>
      ) : null}

      {step === "sync" ? (
        <div className="sx-sync sx-pop">
          <Steps items={runner.items} />
          {importing !== "todo" ? (
            <div className="sx-sync-count">
              <span>Orders imported</span>
              <strong>{importing === "done" ? int(orders) : <CountUp value={orders} format={(n) => int(n)} />}</strong>
              <Bar value={importing === "done" ? 1 : 0.62} />
            </div>
          ) : null}
          {runner.finished ? (
            <div className="sx-finish sx-pop">
              <DoneMark />
              <div>
                <strong>{domain} is connected</strong>
                <p>Orders now update within seconds of being placed.</p>
              </div>
              <button type="button" className="sx-btn is-primary" onClick={() => onDone({ domain, orders })}>Done</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/* ---------------- Courier ---------------- */

const COURIERS = [
  { id: "postex", label: "PostEx", method: "api" as const, fields: [{ id: "token", label: "Merchant API token", hint: "PostEx portal, Integration, API token" }] },
  {
    id: "leopards",
    label: "Leopards",
    method: "api" as const,
    fields: [
      { id: "key", label: "API key", hint: "Leopards portal, API Management" },
      { id: "password", label: "API password", hint: "" },
    ],
  },
  { id: "tcs", label: "TCS", method: "file" as const, fields: [] },
  { id: "trax", label: "Trax", method: "file" as const, fields: [] },
  { id: "mnp", label: "M&P", method: "file" as const, fields: [] },
  { id: "callcourier", label: "Call Courier", method: "file" as const, fields: [] },
  { id: "blueex", label: "BlueEx", method: "file" as const, fields: [] },
];

export function CourierWizard({ onClose, onDone, connected, parcels }: { onClose: () => void; onDone: (c: CourierConn) => void; connected: string[]; parcels: number }) {
  const [pick, setPick] = useState<(typeof COURIERS)[number] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"pick" | "creds" | "sync">("pick");
  const share = pick?.id === "postex" ? 0.7 : 0.3;
  const count = Math.round(parcels * share);
  const matched = Math.round(count * 0.993);
  const runner = useRunner(
    pick?.method === "api"
      ? [
          { label: `Checking your ${pick?.label} credentials`, ms: 900 },
          { label: "Pulling parcels booked in the last 45 days", detail: `${int(count)} parcels`, ms: 1800 },
          { label: "Matching parcels to Shopify orders", detail: `${int(matched)} of ${int(count)} matched by order number and tracking`, ms: 1300 },
          { label: "Recalculating delivered ROAS", ms: 800 },
        ]
      : [
          { label: "Reading the status report", ms: 800 },
          { label: "Finding tracking, order and status columns", detail: "CN Number, Customer Reference, Current Status", ms: 900 },
          { label: "Matching parcels to Shopify orders", detail: `${int(matched)} of ${int(count)} matched`, ms: 1300 },
          { label: "Recalculating delivered ROAS", ms: 700 },
        ],
    step === "sync",
  );
  const filled = pick?.fields.every((f) => (values[f.id] ?? "").trim().length >= 4) ?? false;

  return (
    <Modal title="Connect a courier" subtitle="Courier status decides what was delivered, returned or still moving." onClose={onClose} wide={step === "pick"}>
      {step === "pick" ? (
        <div className="sx-courier-grid sx-pop">
          {COURIERS.map((c) => {
            const done = connected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`sx-courier${done ? " is-done" : ""}`}
                disabled={done}
                onClick={() => {
                  setPick(c);
                  setStep("creds");
                }}
              >
                <IconTruck size={20} />
                <strong>{c.label}</strong>
                <span className={`sx-tag ${c.method === "api" ? "is-api" : ""}`}>{done ? "Connected" : c.method === "api" ? "Live API" : "Status file"}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {step === "creds" && pick ? (
        <form
          className="sx-form sx-pop"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick.method === "file" || filled) setStep("sync");
          }}
        >
          {pick.method === "api" ? (
            <>
              {pick.fields.map((f) => (
                <label key={f.id} className="sx-field" htmlFor={`sx-c-${f.id}`}>
                  <span>{pick.label} {f.label}</span>
                  <input
                    id={`sx-c-${f.id}`}
                    type="password"
                    autoComplete="off"
                    value={values[f.id] ?? ""}
                    placeholder="Paste it here"
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                  {f.hint ? <small>{f.hint}</small> : null}
                </label>
              ))}
              <p className="sx-fine"><IconShield size={14} /> Stored encrypted. Statuses refresh every hour.</p>
            </>
          ) : (
            <div className="sx-drop is-static">
              <IconFile size={22} />
              <strong>{pick.label} status report</strong>
              <span>In the live app you upload the portal export as it is, CSV or Excel. Here a sample report is used.</span>
            </div>
          )}
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("pick")}>Back</button>
            <button type="submit" className="sx-btn is-primary" disabled={pick.method === "api" && !filled}>
              {pick.method === "api" ? "Test and connect" : "Use sample report"}
            </button>
          </div>
        </form>
      ) : null}

      {step === "sync" && pick ? (
        <div className="sx-sync sx-pop">
          <Steps items={runner.items} />
          {runner.finished ? (
            <div className="sx-finish sx-pop">
              <DoneMark />
              <div>
                <strong>{pick.label} connected</strong>
                <p>{int(matched)} parcels now carry a delivered, returned or moving status.</p>
              </div>
              <button type="button" className="sx-btn is-primary" onClick={() => onDone({ id: pick.id, label: pick.label, method: pick.method, parcels: count, matched })}>
                Done
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/* ---------------- Meta ---------------- */

const ACCOUNTS = [
  { id: "act_1182004211709", name: "Demo Fashion Co. Ads", currency: "PKR", spend: "Rs 7.6 lakh last 30 days" },
  { id: "act_1182004211788", name: "Demo Fashion Co. Backup", currency: "PKR", spend: "No spend last 30 days" },
];
const PIXELS = [
  { id: "1460229381776540", name: "Demo Fashion Pixel" },
  { id: "1460229381779902", name: "Old Website Pixel" },
];

export function MetaWizard({ onClose, onDone, ads }: { onClose: () => void; onDone: (c: MetaConn) => void; ads: number }) {
  const [step, setStep] = useState<"start" | "token" | "consent" | "account" | "sync">("start");
  const [account, setAccount] = useState(ACCOUNTS[0].id);
  const [pixel, setPixel] = useState(PIXELS[0].id);
  const [token, setToken] = useState("");
  const [events, setEvents] = useState({ confirmed: true, delivered: true, returned: true });
  const acc = ACCOUNTS.find((a) => a.id === account)!;
  const px = PIXELS.find((p) => p.id === pixel)!;
  const runner = useRunner(
    [
      { label: "Importing 60 days of spend at ad level", detail: `${int(ads)} ad days from ${acc.name}`, ms: 1900 },
      { label: "Conversions API connected to your pixel", detail: px.name, ms: 900 },
      { label: "Test event received by Meta", detail: "ConfirmedOrder, visible in Events Manager", ms: 1100 },
    ],
    step === "sync",
  );

  return (
    <Modal title="Connect Meta Ads" subtitle="Spend comes in, confirmed and delivered orders go back to your pixel." onClose={onClose}>
      {step === "start" ? (
        <div className="sx-form sx-pop">
          <div className="sx-meta-hero">
            <IconTarget size={28} />
            <p>Sign in with the Meta account that manages your ad account and pixel. Delivered ROAS reads spend and sends conversion events. It never edits your ads.</p>
          </div>
          <div className="sx-actions is-stack">
            <button type="button" className="sx-btn is-meta" onClick={() => setStep("consent")}>Continue with Meta</button>
            <button type="button" className="sx-link" onClick={() => setStep("token")}>Use a system user token instead</button>
          </div>
        </div>
      ) : null}

      {step === "token" ? (
        <form
          className="sx-form sx-pop"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim().length > 10) setStep("account");
          }}
        >
          <label className="sx-field" htmlFor="sx-meta-token">
            <span>System user access token</span>
            <input id="sx-meta-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG..." autoComplete="off" />
            <small>Business Settings, System users, Generate token with ads_read and ads_management.</small>
          </label>
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("start")}>Back</button>
            <button type="submit" className="sx-btn is-primary" disabled={token.trim().length <= 10}>Check token</button>
          </div>
        </form>
      ) : null}

      {step === "consent" ? (
        <div className="sx-consent sx-pop">
          <div className="sx-consent-head">
            <span className="sx-app-chip"><IconTarget size={16} /> Meta for Business</span>
            <h3>Delivered ROAS is asking to</h3>
          </div>
          <ul className="sx-perms">
            <li><IconCheck size={16} /> Read ad performance for the ad accounts you choose</li>
            <li><IconCheck size={16} /> Send conversion events to the pixel you choose</li>
            <li><IconCheck size={16} /> See which business owns them</li>
          </ul>
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("start")}>Cancel</button>
            <button type="button" className="sx-btn is-meta" onClick={() => setStep("account")}>Allow</button>
          </div>
        </div>
      ) : null}

      {step === "account" ? (
        <form
          className="sx-form sx-pop"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("sync");
          }}
        >
          <fieldset className="sx-radios">
            <legend>Ad account</legend>
            {ACCOUNTS.map((a) => (
              <label key={a.id} htmlFor={`sx-acc-${a.id}`} className={`sx-radio${account === a.id ? " is-on" : ""}`}>
                <input id={`sx-acc-${a.id}`} type="radio" name="sx-account" value={a.id} checked={account === a.id} onChange={() => setAccount(a.id)} />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.id} · {a.currency} · {a.spend}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="sx-field" htmlFor="sx-meta-pixel">
            <span>Pixel that receives delivered orders</span>
            <select id="sx-meta-pixel" value={pixel} onChange={(e) => setPixel(e.target.value)}>
              {PIXELS.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
              ))}
            </select>
          </label>
          <fieldset className="sx-toggles">
            <legend>Events to send</legend>
            {(
              [
                ["confirmed", "ConfirmedOrder", "when WhatsApp or call confirmation tags the order, same day"],
                ["delivered", "DeliveredOrder", "when the courier delivers, with the order value"],
                ["returned", "ReturnedOrder", "when a parcel comes back, to exclude these buyers"],
              ] as const
            ).map(([k, label, hint]) => (
              <label key={k} htmlFor={`sx-ev-${k}`} className="sx-toggle">
                <input id={`sx-ev-${k}`} type="checkbox" checked={events[k]} onChange={(e) => setEvents((v) => ({ ...v, [k]: e.target.checked }))} />
                <span className="sx-switch" aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="sx-actions">
            <button type="submit" className="sx-btn is-primary">Connect {acc.name}</button>
          </div>
        </form>
      ) : null}

      {step === "sync" ? (
        <div className="sx-sync sx-pop">
          <Steps items={runner.items} />
          {runner.finished ? (
            <div className="sx-finish sx-pop">
              <DoneMark />
              <div>
                <strong>Meta Ads connected</strong>
                <p>Spend refreshes every 6 hours. Events go out every hour.</p>
              </div>
              <button type="button" className="sx-btn is-primary" onClick={() => onDone({ account: acc.name, accountId: acc.id, pixel: `${px.name} (${px.id})`, events })}>
                Done
              </button>
            </div>
          ) : (
            <p className="sx-fine"><Spinner size={12} /> Working on it</p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
