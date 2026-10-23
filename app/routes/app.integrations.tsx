import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import "../components/dashboard.css";
import "../components/saas/saas.css";
import { int, timeAgo } from "../components/format";
import { IconStore, IconTarget, IconTruck, IconShield, IconCheck } from "../components/saas/icons";
import { DoneMark, Modal, Spinner, Steps, ToastProvider, useToast } from "../components/saas/ui";
import { IntegrationsView, type ConnectionCard } from "../components/saas/views";
import { getAppUrl } from "../lib/app-url";
import { encrypt, maskSecret, signState } from "../lib/crypto.server";
import { testLeopards } from "../lib/couriers/leopards.server";
import { testPostEx } from "../lib/couriers/postex.server";
import { listAdAccounts, listPixels, metaOAuthReady, whoAmI } from "../lib/meta/oauth.server";
import { ensureShop, getShop, metaTokenFor } from "../lib/shop.server";
import { ensureWebPixel } from "../lib/shopify/pixel.server";
import { syncCouriers } from "../lib/sync/couriers.server";
import { syncMetaInsights } from "../lib/sync/meta.server";

export const config = { maxDuration: 120 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));
  const [orders, shipments, matched, signals, sent7d] = await Promise.all([
    db.order.count({ where: { shopId: shop.id } }),
    db.shipment.count({ where: { shopId: shop.id } }),
    db.shipment.count({ where: { shopId: shop.id, orderId: { not: null } } }),
    db.checkoutSignal.count({ where: { shopId: shop.id } }),
    db.capiEvent.count({ where: { shopId: shop.id, status: "SENT", sentAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
  ]);
  return {
    shop: {
      domain: shop.id,
      name: shop.name ?? shop.id,
      orders,
      backfillDone: shop.backfillDone,
      lastOrderSyncAt: shop.lastOrderSyncAt?.toISOString() ?? null,
      pixelActive: Boolean(shop.webPixelId),
      signals,
    },
    couriers: {
      postex: maskSecret(shop.postexTokenEnc),
      leopards: maskSecret(shop.leopardsKeyEnc),
      shipments,
      matched,
      lastSync: shop.lastCourierSyncAt?.toISOString() ?? null,
    },
    meta: {
      accountId: shop.metaAdAccountId,
      pixelId: shop.metaPixelId,
      tokenMask: maskSecret(shop.metaTokenEnc),
      agencyToken: Boolean(process.env.META_SYSTEM_USER_TOKEN),
      capiEnabled: shop.capiEnabled,
      events: { confirmed: shop.sendConfirmed, delivered: shop.sendDelivered, returned: shop.sendReturned },
      lastSync: shop.lastMetaSyncAt?.toISOString() ?? null,
      sent7d,
    },
    // Signed per page load and opened by a real link click, so the browser never blocks the popup
    metaLoginUrl: metaOAuthReady() ? `${getAppUrl()}/meta/oauth/start?state=${encodeURIComponent(signState({ shop: shop.id }))}` : null,
  };
};

type Result = { ok: boolean; message?: string; [k: string]: unknown };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { session, admin } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  const str = (k: string) => String(f.get(k) ?? "").trim();
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));

  switch (intent) {
    case "connect_postex": {
      const token = str("token");
      const test = await testPostEx(token);
      if (!test.ok) return { ok: false, message: test.message };
      const updated = await db.shop.update({ where: { id: shop.id }, data: { postexTokenEnc: encrypt(token) } });
      try {
        const sync: any = await syncCouriers(updated);
        return { ok: true, message: test.message, parcels: sync.postex?.total ?? 0, matched: sync.postex?.matched ?? 0, changed: sync.postex?.ordersChanged ?? 0 };
      } catch (e: any) {
        return { ok: true, message: `Connected. The first sync will finish in the background: ${e?.message ?? e}` };
      }
    }
    case "connect_leopards": {
      const key = str("key");
      const password = str("password");
      const test = await testLeopards(key, password);
      if (!test.ok) return { ok: false, message: test.message };
      const updated = await db.shop.update({ where: { id: shop.id }, data: { leopardsKeyEnc: encrypt(key), leopardsPassEnc: encrypt(password) } });
      try {
        const sync: any = await syncCouriers(updated);
        return { ok: true, message: test.message, parcels: sync.leopards?.total ?? 0, matched: sync.leopards?.matched ?? 0, changed: sync.leopards?.ordersChanged ?? 0 };
      } catch (e: any) {
        return { ok: true, message: `Connected. The first sync will finish in the background: ${e?.message ?? e}` };
      }
    }
    case "disconnect_couriers":
      await db.shop.update({ where: { id: shop.id }, data: { postexTokenEnc: null, leopardsKeyEnc: null, leopardsPassEnc: null } });
      return { ok: true, message: "Courier APIs disconnected. Parcels already imported stay." };
    case "meta_token": {
      const token = str("token");
      try {
        const me = await whoAmI(token);
        await db.shop.update({ where: { id: shop.id }, data: { metaTokenEnc: encrypt(token) } });
        return { ok: true, message: `Token works for ${me.name}.` };
      } catch (e: any) {
        return { ok: false, message: `Meta did not accept this token: ${e?.message ?? e}` };
      }
    }
    case "meta_accounts": {
      const token = metaTokenFor(shop);
      if (!token) return { ok: false, message: "Sign in with Meta or paste a token first." };
      try {
        return { ok: true, accounts: await listAdAccounts(token) };
      } catch (e: any) {
        return { ok: false, message: `Could not list ad accounts: ${e?.message ?? e}` };
      }
    }
    case "meta_pixels": {
      const token = metaTokenFor(shop);
      if (!token) return { ok: false, message: "Sign in with Meta first." };
      try {
        return { ok: true, pixels: await listPixels(token, str("account")) };
      } catch (e: any) {
        return { ok: false, message: `Could not list pixels: ${e?.message ?? e}` };
      }
    }
    case "meta_save": {
      const account = str("account").replace(/\D/g, "");
      const pixel = str("pixel").replace(/\D/g, "");
      if (!account) return { ok: false, message: "Choose an ad account." };
      const updated = await db.shop.update({
        where: { id: shop.id },
        data: {
          metaAdAccountId: account,
          metaPixelId: pixel || null,
          capiEnabled: Boolean(pixel) && f.get("capi") === "1",
          sendConfirmed: f.get("confirmed") === "1",
          sendDelivered: f.get("delivered") === "1",
          sendReturned: f.get("returned") === "1",
          ...(account !== shop.metaAdAccountId ? { metaBackfillDone: false } : {}),
        },
      });
      try {
        const r: any = await syncMetaInsights(updated);
        return { ok: true, message: "Meta Ads connected.", rows: r.rows ?? 0 };
      } catch (e: any) {
        return { ok: true, message: `Saved. Spend import will retry on the next sync: ${e?.message ?? e}`, rows: 0 };
      }
    }
    case "disconnect_meta":
      await db.shop.update({ where: { id: shop.id }, data: { metaTokenEnc: null, metaAdAccountId: null, capiEnabled: false } });
      return { ok: true, message: "Meta Ads disconnected." };
    case "refresh_pixel": {
      const r = await ensureWebPixel(admin, shop.id);
      if (r.id) await db.shop.update({ where: { id: shop.id }, data: { webPixelId: r.id } });
      return r.error ? { ok: false, message: r.error } : { ok: true, message: "Checkout pixel is active." };
    }
    case "reimport":
      await db.shop.update({ where: { id: shop.id }, data: { backfillDone: false, backfillCursor: null, backfillSince: new Date(Date.now() - 60 * 86400000) } });
      return { ok: true, message: "Re-import queued. Open Delivered ROAS to watch it run." };
    default:
      return { ok: false, message: "Unknown action." };
  }
};

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function IntegrationsPage() {
  return (
    <ToastProvider>
      <Integrations />
    </ToastProvider>
  );
}

function Integrations() {
  const data = useLoaderData<typeof loader>();
  const quick = useFetcher<Result>();
  const toast = useToast();
  const [modal, setModal] = useState<null | "courier" | "meta">(null);

  useEffect(() => {
    if (quick.state === "idle" && quick.data?.message) toast({ tone: quick.data.ok ? "good" : "bad", title: quick.data.message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick.state, quick.data]);

  const run = (intent: string) => quick.submit({ intent }, { method: "post" });
  const s = data.shop;
  const c = data.couriers;
  const m = data.meta;
  const courierOn = Boolean(c.postex || c.leopards || c.shipments);

  const cards: ConnectionCard[] = [
    {
      key: "shopify",
      title: "Shopify",
      icon: <IconStore size={20} />,
      connected: true,
      lines: [
        s.domain,
        s.backfillDone ? `${int(s.orders)} orders imported, new ones arrive by webhook` : `Importing the last 60 days: ${int(s.orders)} orders so far`,
        s.pixelActive ? `Checkout pixel active, ${int(s.signals)} checkouts captured` : "Checkout pixel not active yet",
      ],
      lastSync: s.lastOrderSyncAt ? timeAgo(s.lastOrderSyncAt) : undefined,
      onConnect: () => run("refresh_pixel"),
      connectLabel: s.pixelActive ? "Refresh pixel" : "Activate pixel",
      extraAction: (
        <button type="button" className="sx-btn is-ghost" onClick={() => run("reimport")}>
          Re-import 60 days
        </button>
      ),
    },
    {
      key: "courier",
      title: "Couriers",
      icon: <IconTruck size={20} />,
      connected: courierOn,
      lines: [
        c.postex ? `PostEx live API (${c.postex})` : "PostEx not connected",
        c.leopards ? `Leopards live API (${c.leopards})` : "Leopards not connected",
        `${int(c.matched)} of ${int(c.shipments)} parcels matched to orders`,
      ],
      lastSync: c.lastSync ? timeAgo(c.lastSync) : undefined,
      onConnect: () => setModal("courier"),
      onDisconnect: c.postex || c.leopards ? () => run("disconnect_couriers") : undefined,
      connectLabel: courierOn ? "Add a courier" : "Connect a courier",
      extraAction: (
        <Link className="sx-btn is-ghost" to="/app/couriers">Upload a status file</Link>
      ),
    },
    {
      key: "meta",
      title: "Meta Ads",
      icon: <IconTarget size={20} />,
      connected: Boolean(m.accountId),
      lines: m.accountId
        ? [
            `Ad account act_${m.accountId}`,
            m.pixelId ? `Pixel ${m.pixelId}, Conversions API ${m.capiEnabled ? "on" : "off"}` : "No pixel chosen, events are not sent",
            `${int(m.sent7d)} events sent to Meta in the last 7 days`,
          ]
        : ["Spend and Meta reported purchases per ad, per day", "Sends confirmed and delivered orders back to your pixel"],
      lastSync: m.lastSync ? timeAgo(m.lastSync) : undefined,
      onConnect: () => setModal("meta"),
      onDisconnect: m.accountId ? () => run("disconnect_meta") : undefined,
      connectLabel: m.accountId ? "Change account" : "Connect Meta Ads",
    },
  ];

  return (
    <s-page heading="Integrations" inlineSize="large">
      <div className="sx-embed">
        <IntegrationsView
          cards={cards}
          footer={
            <p className="sx-fine">
              <IconShield size={14} /> Tokens are stored encrypted. Customer phone, email and names are kept only as SHA256 hashes.
            </p>
          }
        />
      </div>
      {modal === "courier" ? <CourierModal onClose={() => setModal(null)} connected={{ postex: Boolean(c.postex), leopards: Boolean(c.leopards) }} /> : null}
      {modal === "meta" ? <MetaModal onClose={() => setModal(null)} data={data} /> : null}
    </s-page>
  );
}

function CourierModal({ onClose, connected }: { onClose: () => void; connected: { postex: boolean; leopards: boolean } }) {
  const fx = useFetcher<Result>();
  const revalidator = useRevalidator();
  const [pick, setPick] = useState<"postex" | "leopards" | null>(null);
  const busy = fx.state !== "idle";
  const res = fx.data;
  useEffect(() => {
    if (fx.state === "idle" && res?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx.state, res?.ok]);

  return (
    <Modal title="Connect a courier" subtitle="Courier status decides what was delivered, returned or still moving." onClose={onClose}>
      {!pick ? (
        <div className="sx-courier-grid sx-pop">
          {(["postex", "leopards"] as const).map((id) => (
            <button key={id} type="button" className={`sx-courier${connected[id] ? " is-done" : ""}`} onClick={() => setPick(id)}>
              <IconTruck size={20} />
              <strong>{id === "postex" ? "PostEx" : "Leopards"}</strong>
              <span className="sx-tag is-api">{connected[id] ? "Connected, update keys" : "Live API"}</span>
            </button>
          ))}
          <Link className="sx-courier" to="/app/couriers">
            <IconTruck size={20} />
            <strong>TCS, Trax, M&amp;P and others</strong>
            <span className="sx-tag">Status file</span>
          </Link>
        </div>
      ) : res?.ok ? (
        <div className="sx-sync sx-pop">
          <Steps
            items={[
              { label: "Credentials accepted", state: "done", detail: res.message },
              { label: "Parcels pulled from the last 45 days", state: "done", detail: res.parcels != null ? `${int(Number(res.parcels))} parcels` : undefined },
              { label: "Matched to Shopify orders", state: "done", detail: res.matched != null ? `${int(Number(res.matched))} matched, ${int(Number(res.changed ?? 0))} orders changed status` : undefined },
            ]}
          />
          <div className="sx-finish">
            <DoneMark />
            <div>
              <strong>{pick === "postex" ? "PostEx" : "Leopards"} connected</strong>
              <p>Statuses refresh every hour from now on.</p>
            </div>
            <button type="button" className="sx-btn is-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <fx.Form method="post" className="sx-form sx-pop">
          <input type="hidden" name="intent" value={pick === "postex" ? "connect_postex" : "connect_leopards"} />
          {pick === "postex" ? (
            <label className="sx-field" htmlFor="lv-postex">
              <span>PostEx merchant API token</span>
              <input id="lv-postex" name="token" type="password" autoComplete="off" required minLength={8} />
              <small>PostEx portal, Integration, API token.</small>
            </label>
          ) : (
            <>
              <label className="sx-field" htmlFor="lv-lkey">
                <span>Leopards API key</span>
                <input id="lv-lkey" name="key" type="password" autoComplete="off" required minLength={6} />
                <small>Leopards portal, API Management.</small>
              </label>
              <label className="sx-field" htmlFor="lv-lpass">
                <span>Leopards API password</span>
                <input id="lv-lpass" name="password" type="password" autoComplete="off" required minLength={4} />
              </label>
            </>
          )}
          {busy ? (
            <Steps
              items={[
                { label: "Checking credentials", state: "doing" },
                { label: "Pulling parcels and matching them to orders", state: "todo" },
              ]}
            />
          ) : null}
          {res && !res.ok ? <p className="sx-err">{res.message}</p> : null}
          <p className="sx-fine"><IconShield size={14} /> Stored encrypted. Nothing is saved unless the courier accepts the keys.</p>
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setPick(null)} disabled={busy}>Back</button>
            <button type="submit" className="sx-btn is-primary" disabled={busy}>
              {busy ? <Spinner size={14} /> : null} Test and connect
            </button>
          </div>
        </fx.Form>
      )}
    </Modal>
  );
}

function MetaModal({ onClose, data }: { onClose: () => void; data: LoaderData }) {
  const revalidator = useRevalidator();
  const tokenFx = useFetcher<Result>();
  const accountsFx = useFetcher<Result & { accounts?: { id: string; name: string; currency: string; timezone: string; active: boolean }[] }>();
  const pixelsFx = useFetcher<Result & { pixels?: { id: string; name: string; lastFired: string | null }[] }>();
  const saveFx = useFetcher<Result>();
  const hasToken = Boolean(data.meta.tokenMask || data.meta.agencyToken);
  const [step, setStep] = useState<"start" | "waiting" | "token" | "account">(hasToken ? "account" : "start");
  const startMask = useRef(data.meta.tokenMask);
  const [account, setAccount] = useState(data.meta.accountId ?? "");
  const [pixel, setPixel] = useState(data.meta.pixelId ?? "");

  // While the Meta window is open, poll until the new token lands
  useEffect(() => {
    if (step !== "waiting") return;
    if (data.meta.tokenMask && data.meta.tokenMask !== startMask.current) {
      setStep("account");
      return;
    }
    const id = window.setInterval(() => revalidator.revalidate(), 2000);
    return () => window.clearInterval(id);
  }, [step, data.meta.tokenMask, revalidator]);

  useEffect(() => {
    if (tokenFx.state === "idle" && tokenFx.data?.ok) setStep("account");
  }, [tokenFx.state, tokenFx.data]);

  useEffect(() => {
    if (step === "account" && accountsFx.state === "idle" && !accountsFx.data) accountsFx.submit({ intent: "meta_accounts" }, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (account) pixelsFx.submit({ intent: "meta_pixels", account }, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    if (saveFx.state === "idle" && saveFx.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFx.state, saveFx.data?.ok]);

  const accounts = accountsFx.data?.accounts ?? [];
  const pixels = pixelsFx.data?.pixels ?? [];

  return (
    <Modal title="Connect Meta Ads" subtitle="Spend comes in, confirmed and delivered orders go back to your pixel." onClose={onClose}>
      {step === "start" ? (
        <div className="sx-form sx-pop">
          <div className="sx-meta-hero">
            <IconTarget size={28} />
            <p>Sign in with the Meta account that manages your ad account and pixel. Delivered ROAS reads spend and sends conversion events. It never edits your ads.</p>
          </div>
          <div className="sx-actions is-stack">
            {data.metaLoginUrl ? (
              <a className="sx-btn is-meta" href={data.metaLoginUrl} target="_blank" rel="noreferrer" onClick={() => setStep("waiting")}>
                Continue with Meta
              </a>
            ) : (
              <p className="sx-note">Meta login switches on once META_APP_ID and META_APP_SECRET are set on the server. A system user token works today.</p>
            )}
            <button type="button" className="sx-link" onClick={() => setStep("token")}>Use a system user token instead</button>
          </div>
        </div>
      ) : null}

      {step === "waiting" ? (
        <div className="sx-sync sx-pop">
          <Steps items={[{ label: "Waiting for you to finish signing in to Meta in the new window", state: "doing" }]} />
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("start")}>Back</button>
          </div>
        </div>
      ) : null}

      {step === "token" ? (
        <tokenFx.Form method="post" className="sx-form sx-pop">
          <input type="hidden" name="intent" value="meta_token" />
          <label className="sx-field" htmlFor="lv-meta-token">
            <span>System user access token</span>
            <input id="lv-meta-token" name="token" type="password" autoComplete="off" required minLength={20} placeholder="EAAG..." />
            <small>Business Settings, System users, Generate token with ads_read and ads_management.</small>
          </label>
          {tokenFx.data && !tokenFx.data.ok ? <p className="sx-err">{tokenFx.data.message}</p> : null}
          <div className="sx-actions">
            <button type="button" className="sx-btn" onClick={() => setStep("start")}>Back</button>
            <button type="submit" className="sx-btn is-primary" disabled={tokenFx.state !== "idle"}>
              {tokenFx.state !== "idle" ? <Spinner size={14} /> : null} Check token
            </button>
          </div>
        </tokenFx.Form>
      ) : null}

      {step === "account" ? (
        saveFx.data?.ok ? (
          <div className="sx-finish sx-pop">
            <DoneMark />
            <div>
              <strong>{saveFx.data.message}</strong>
              <p>{int(Number(saveFx.data.rows ?? 0))} ad days of spend imported. Events go out every hour.</p>
            </div>
            <button type="button" className="sx-btn is-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <saveFx.Form method="post" className="sx-form sx-pop">
            <input type="hidden" name="intent" value="meta_save" />
            {accountsFx.state !== "idle" ? (
              <p className="sx-fine"><Spinner size={12} /> Loading your ad accounts</p>
            ) : accountsFx.data && !accountsFx.data.ok ? (
              <p className="sx-err">{accountsFx.data.message}</p>
            ) : (
              <fieldset className="sx-radios">
                <legend>Ad account</legend>
                {accounts.map((a) => (
                  <label key={a.id} htmlFor={`lv-acc-${a.id}`} className={`sx-radio${account === a.id ? " is-on" : ""}`}>
                    <input id={`lv-acc-${a.id}`} type="radio" name="account" value={a.id} checked={account === a.id} onChange={() => setAccount(a.id)} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>act_{a.id} · {a.currency} · {a.timezone}{a.active ? "" : " · not active"}</small>
                    </span>
                  </label>
                ))}
                {!accounts.length ? <p className="sx-fine">No ad accounts found for this login.</p> : null}
              </fieldset>
            )}
            {account ? (
              <label className="sx-field" htmlFor="lv-pixel">
                <span>Pixel that receives delivered orders</span>
                <select id="lv-pixel" name="pixel" value={pixel} onChange={(e) => setPixel(e.target.value)}>
                  <option value="">{pixelsFx.state !== "idle" ? "Loading pixels" : "Choose a pixel"}</option>
                  {pixels.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </select>
              </label>
            ) : null}
            <fieldset className="sx-toggles">
              <legend>Events to send</legend>
              {(
                [
                  ["capi", "Conversions API on", "events go to the pixel every hour", data.meta.capiEnabled || !data.meta.accountId],
                  ["confirmed", "ConfirmedOrder", "same day, when the order is confirmed", data.meta.events.confirmed],
                  ["delivered", "DeliveredOrder", "when the courier delivers, with the value", data.meta.events.delivered],
                  ["returned", "ReturnedOrder", "when a parcel comes back", data.meta.events.returned],
                ] as const
              ).map(([k, label, hint, on]) => (
                <label key={k} htmlFor={`lv-ev-${k}`} className="sx-toggle">
                  <input id={`lv-ev-${k}`} type="checkbox" name={k} value="1" defaultChecked={on} />
                  <span className="sx-switch" aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {saveFx.data && !saveFx.data.ok ? <p className="sx-err">{saveFx.data.message}</p> : null}
            {saveFx.state !== "idle" ? (
              <Steps
                items={[
                  { label: "Saving the account and pixel", state: "done" },
                  { label: "Importing 60 days of spend at ad level", state: "doing" },
                ]}
              />
            ) : null}
            <div className="sx-actions">
              {data.metaLoginUrl ? (
                <a className="sx-btn is-ghost" href={data.metaLoginUrl} target="_blank" rel="noreferrer" onClick={() => { startMask.current = data.meta.tokenMask; setStep("waiting"); }}>
                  Sign in again
                </a>
              ) : null}
              <button type="submit" className="sx-btn is-primary" disabled={!account || saveFx.state !== "idle"}>
                {saveFx.state !== "idle" ? <Spinner size={14} /> : <IconCheck size={16} />} Connect
              </button>
            </div>
          </saveFx.Form>
        )
      ) : null}
    </Modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
