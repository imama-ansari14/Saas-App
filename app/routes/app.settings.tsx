import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt, encrypt, maskSecret } from "../lib/crypto.server";
import { testLeopards } from "../lib/couriers/leopards.server";
import { testPostEx } from "../lib/couriers/postex.server";
import { buildCapiEvent, sendCapiBatch } from "../lib/meta/capi.server";
import { fetchAdAccount } from "../lib/meta/insights.server";
import { loadSyncHealth } from "../lib/report.server";
import { capiTokenFor, ensureShop, getShop, metaTokenFor, storeUrl } from "../lib/shop.server";
import { ensureWebPixel } from "../lib/shopify/pixel.server";

export const UTM_TEMPLATE =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));
  const health = await loadSyncHealth(shop);
  return {
    shop: {
      id: shop.id,
      metaAdAccountId: shop.metaAdAccountId ?? "",
      metaToken: maskSecret(shop.metaTokenEnc),
      metaPixelId: shop.metaPixelId ?? "",
      capiToken: maskSecret(shop.capiTokenEnc),
      capiTestCode: shop.capiTestCode ?? "",
      capiEnabled: shop.capiEnabled,
      sendConfirmed: shop.sendConfirmed,
      sendDelivered: shop.sendDelivered,
      sendReturned: shop.sendReturned,
      deliveredSource: shop.deliveredSource,
      confirmTags: shop.confirmTags,
      confirmOnBooking: shop.confirmOnBooking,
      postexToken: maskSecret(shop.postexTokenEnc),
      leopardsKey: maskSecret(shop.leopardsKeyEnc),
      leopardsPass: maskSecret(shop.leopardsPassEnc),
      webPixelId: shop.webPixelId,
      timezone: shop.timezone,
      currency: shop.currency,
    },
    agencyToken: Boolean(process.env.META_SYSTEM_USER_TOKEN),
    health,
  };
};

type ActionResult = { ok: boolean; message: string; section: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const bool = (f: FormData, k: string) => f.get(k) != null && f.get(k) !== "" && f.get(k) !== "false";

/** A secret field: a new value replaces it, the clear box removes it, empty keeps what is stored. */
function secretUpdate(f: FormData, field: string, clearField: string): string | null | undefined {
  if (bool(f, clearField)) return null;
  const v = str(f, field);
  return v ? encrypt(v) : undefined;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, admin } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = str(f, "intent");
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));

  switch (intent) {
    case "save_meta": {
      const account = str(f, "metaAdAccountId").replace(/^act_/i, "").replace(/\D/g, "");
      const pixel = str(f, "metaPixelId").replace(/\D/g, "");
      const metaTokenEnc = secretUpdate(f, "metaToken", "clearMetaToken");
      const capiTokenEnc = secretUpdate(f, "capiToken", "clearCapiToken");
      const accountChanged = account !== (shop.metaAdAccountId ?? "");
      await db.shop.update({
        where: { id: shop.id },
        data: {
          metaAdAccountId: account || null,
          metaPixelId: pixel || null,
          capiTestCode: str(f, "capiTestCode") || null,
          capiEnabled: bool(f, "capiEnabled"),
          sendConfirmed: bool(f, "sendConfirmed"),
          sendDelivered: bool(f, "sendDelivered"),
          sendReturned: bool(f, "sendReturned"),
          deliveredSource: str(f, "deliveredSource") === "system_generated" ? "system_generated" : "website",
          ...(metaTokenEnc !== undefined ? { metaTokenEnc } : {}),
          ...(capiTokenEnc !== undefined ? { capiTokenEnc } : {}),
          ...(accountChanged ? { metaBackfillDone: false } : {}),
        },
      });
      return { ok: true, section: "meta", message: accountChanged && account ? "Saved. Spend for the last 60 days will import on the next sync." : "Meta settings saved." };
    }
    case "test_meta": {
      const token = metaTokenFor(shop);
      if (!shop.metaAdAccountId || !token) return { ok: false, section: "meta", message: "Save an ad account id first, and a token if the agency token is not set on the server." };
      try {
        const acc = await fetchAdAccount(shop.metaAdAccountId, token);
        const mismatch = acc.currency && acc.currency !== shop.currency ? ` Note: the ad account bills in ${acc.currency} while the store sells in ${shop.currency}.` : "";
        return { ok: true, section: "meta", message: `Connected to "${acc.name}" (${acc.currency}, ${acc.timezone_name}).${mismatch}` };
      } catch (e: any) {
        return { ok: false, section: "meta", message: `Meta refused the request: ${e?.message ?? e}` };
      }
    }
    case "send_test_event": {
      const token = capiTokenFor(shop);
      if (!shop.metaPixelId || !token) return { ok: false, section: "meta", message: "Save the pixel id and a Conversions API token first." };
      if (!shop.capiTestCode) return { ok: false, section: "meta", message: "Add the test event code from Events Manager, Test events tab, so this does not count as a real conversion." };
      const order = await db.order.findFirst({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" } });
      if (!order) return { ok: false, section: "meta", message: "No orders imported yet. Wait for the first import to finish." };
      const built = buildCapiEvent({
        eventName: "ConfirmedOrder",
        eventTime: new Date(),
        order: { ...order, city: order.cityLabel ?? order.city, sourceUrl: order.sourceUrl },
        preferredSource: shop.deliveredSource === "system_generated" ? "system_generated" : "website",
        storeUrl: storeUrl(shop),
      });
      if (!built.ok) return { ok: false, section: "meta", message: `The latest order (${order.name}) has nothing to match on: ${built.reason}.` };
      const payload = { ...built.event.payload, event_id: `test_${Date.now()}` };
      const res = await sendCapiBatch(shop.metaPixelId, token, [payload], shop.capiTestCode);
      return res.ok
        ? { ok: true, section: "meta", message: `Meta received ${res.body?.events_received ?? 1} test event from order ${order.name}. Check the Test events tab in Events Manager.` }
        : { ok: false, section: "meta", message: `Meta rejected the test event: ${res.body?.error?.message ?? `HTTP ${res.status}`}` };
    }
    case "save_rules": {
      await db.shop.update({
        where: { id: shop.id },
        data: { confirmTags: str(f, "confirmTags"), confirmOnBooking: bool(f, "confirmOnBooking") },
      });
      return { ok: true, section: "rules", message: "Confirmation rules saved. They apply to orders from now on." };
    }
    case "save_couriers": {
      const postexTokenEnc = secretUpdate(f, "postexToken", "clearPostex");
      const leopardsKeyEnc = secretUpdate(f, "leopardsKey", "clearLeopards");
      const leopardsPassEnc = bool(f, "clearLeopards") ? null : secretUpdate(f, "leopardsPass", "clearLeopards");
      await db.shop.update({
        where: { id: shop.id },
        data: {
          ...(postexTokenEnc !== undefined ? { postexTokenEnc } : {}),
          ...(leopardsKeyEnc !== undefined ? { leopardsKeyEnc } : {}),
          ...(leopardsPassEnc !== undefined ? { leopardsPassEnc } : {}),
        },
      });
      return { ok: true, section: "couriers", message: "Courier settings saved. Status sync runs every hour, or use Sync now on the Couriers page." };
    }
    case "test_postex": {
      const token = decrypt(shop.postexTokenEnc);
      if (!token) return { ok: false, section: "couriers", message: "Save the PostEx API token first, then test it." };
      const r = await testPostEx(token);
      return { ok: r.ok, section: "couriers", message: r.message };
    }
    case "test_leopards": {
      const key = decrypt(shop.leopardsKeyEnc);
      const pass = decrypt(shop.leopardsPassEnc);
      if (!key || !pass) return { ok: false, section: "couriers", message: "Save the Leopards API key and password first, then test them." };
      const r = await testLeopards(key, pass);
      return { ok: r.ok, section: "couriers", message: r.message };
    }
    case "reconnect_pixel": {
      const r = await ensureWebPixel(admin, shop.id);
      if (r.id) await db.shop.update({ where: { id: shop.id }, data: { webPixelId: r.id } });
      return r.error
        ? { ok: false, section: "pixel", message: `Shopify did not activate the pixel: ${r.error}` }
        : { ok: true, section: "pixel", message: "Checkout pixel is active." };
    }
    default:
      return { ok: false, section: "none", message: "Unknown action." };
  }
};

function Result({ result, section }: { result: ActionResult | undefined; section: string }) {
  if (!result || result.section !== section) return null;
  return (
    <s-banner tone={result.ok ? "success" : "critical"}>
      {result.message}
    </s-banner>
  );
}

function ActionButton({ intent, label }: { intent: string; label: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <s-button type="submit">{label}</s-button>
    </Form>
  );
}

export default function Settings() {
  const { shop, agencyToken, health } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <s-page heading="Settings" inlineSize="base">
      <s-section heading="Meta ad account and Conversions API">
        <Form method="post">
          <s-stack gap="base">
            <Result result={result} section="meta" />
            <s-text-field
              name="metaAdAccountId"
              label="Ad account id"
              details="Digits from Ads Manager, with or without act_"
              defaultValue={shop.metaAdAccountId}
              autocomplete="off"
            />
            <s-password-field
              name="metaToken"
              label="Ads read token for this store (optional)"
              details={
                shop.metaToken
                  ? `Saved (${shop.metaToken}). Leave empty to keep it.`
                  : agencyToken
                    ? "Empty uses the Better Sales system user token set on the server."
                    : "No agency token on the server, so this store needs its own system user token with ads_read."
              }
              autocomplete="off"
            />
            {shop.metaToken ? <s-checkbox name="clearMetaToken" value="1" label="Remove the saved store token" /> : null}
            <s-text-field name="metaPixelId" label="Pixel (dataset) id" defaultValue={shop.metaPixelId} autocomplete="off" />
            <s-password-field
              name="capiToken"
              label="Conversions API access token"
              details={shop.capiToken ? `Saved (${shop.capiToken}). Leave empty to keep it.` : "Events Manager, your pixel, Settings, Generate access token."}
              autocomplete="off"
            />
            {shop.capiToken ? <s-checkbox name="clearCapiToken" value="1" label="Remove the saved Conversions API token" /> : null}
            <s-text-field
              name="capiTestCode"
              label="Test event code"
              details="While this is filled, every event goes to Test events only. Clear it to go live."
              defaultValue={shop.capiTestCode}
              autocomplete="off"
            />
            <s-select name="deliveredSource" label="Send events as" value={shop.deliveredSource}>
              <s-option value="website">Website events (needed to optimize a website sales campaign on them)</s-option>
              <s-option value="system_generated">System generated events</s-option>
            </s-select>
            <s-stack gap="small-200">
              <s-checkbox name="sendConfirmed" value="1" label="Send ConfirmedOrder when an order is confirmed" defaultChecked={shop.sendConfirmed || undefined} />
              <s-checkbox name="sendDelivered" value="1" label="Send DeliveredOrder when the courier delivers" defaultChecked={shop.sendDelivered || undefined} />
              <s-checkbox name="sendReturned" value="1" label="Send ReturnedOrder when a parcel comes back" defaultChecked={shop.sendReturned || undefined} />
              <s-checkbox name="capiEnabled" value="1" label="Conversions API is on" defaultChecked={shop.capiEnabled || undefined} />
            </s-stack>
            <input type="hidden" name="intent" value="save_meta" />
            <s-button type="submit" variant="primary" loading={busy || undefined}>Save Meta settings</s-button>
          </s-stack>
        </Form>
        <s-stack direction="inline" gap="base">
          <ActionButton intent="test_meta" label="Test ad account" />
          <ActionButton intent="send_test_event" label="Send a test event" />
        </s-stack>
      </s-section>

      <s-section heading="UTM template for every ad">
        <s-stack gap="small-200">
          <s-paragraph>
            Paste this into URL parameters on every ad. It is how an order is credited to its campaign and ad.
            Right now {Math.round(health.utmShare * 100)}% of imported orders carry a campaign id.
          </s-paragraph>
          <pre className="dr-code">{UTM_TEMPLATE}</pre>
        </s-stack>
      </s-section>

      <s-section heading="When is an order confirmed">
        <Form method="post">
          <s-stack gap="base">
            <Result result={result} section="rules" />
            <s-text-field
              name="confirmTags"
              label="Confirmation tags"
              details="Comma separated. When your WhatsApp or call confirmation app adds one of these tags, a ConfirmedOrder is sent."
              defaultValue={shop.confirmTags}
            />
            <s-checkbox
              name="confirmOnBooking"
              value="1"
              label="Also treat an order as confirmed once a parcel is booked with a courier"
              defaultChecked={shop.confirmOnBooking || undefined}
            />
            <input type="hidden" name="intent" value="save_rules" />
            <s-button type="submit" loading={busy || undefined}>Save rules</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Couriers">
        <Form method="post">
          <s-stack gap="base">
            <Result result={result} section="couriers" />
            <s-password-field
              name="postexToken"
              label="PostEx merchant API token"
              details={shop.postexToken ? `Saved (${shop.postexToken}). Leave empty to keep it.` : "PostEx merchant portal, Integration, API token."}
              autocomplete="off"
            />
            {shop.postexToken ? <s-checkbox name="clearPostex" value="1" label="Disconnect PostEx" /> : null}
            <s-password-field
              name="leopardsKey"
              label="Leopards API key"
              details={shop.leopardsKey ? `Saved (${shop.leopardsKey}). Leave empty to keep it.` : "Leopards merchant portal, API Management."}
              autocomplete="off"
            />
            <s-password-field
              name="leopardsPass"
              label="Leopards API password"
              details={shop.leopardsPass ? `Saved (${shop.leopardsPass}).` : undefined}
              autocomplete="off"
            />
            {shop.leopardsKey ? <s-checkbox name="clearLeopards" value="1" label="Disconnect Leopards" /> : null}
            <s-paragraph>TCS, Trax, M&amp;P and any other courier: upload their status export on the Couriers page.</s-paragraph>
            <input type="hidden" name="intent" value="save_couriers" />
            <s-button type="submit" variant="primary" loading={busy || undefined}>Save couriers</s-button>
          </s-stack>
        </Form>
        <s-stack direction="inline" gap="base">
          <ActionButton intent="test_postex" label="Test saved PostEx token" />
          <ActionButton intent="test_leopards" label="Test saved Leopards keys" />
        </s-stack>
      </s-section>

      <s-section heading="Checkout pixel">
        <Form method="post">
          <s-stack gap="base">
            <Result result={result} section="pixel" />
            <s-paragraph>
              {shop.webPixelId
                ? `Active. ${health.signals} checkouts have sent their Meta browser ids (fbp, fbc) so far.`
                : "Not active yet. The pixel captures the Meta browser ids at checkout so delivered events match the right person."}
            </s-paragraph>
            <input type="hidden" name="intent" value="reconnect_pixel" />
            <s-button type="submit">{shop.webPixelId ? "Refresh pixel settings" : "Activate checkout pixel"}</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Data health">
        <s-stack gap="small-200">
          <s-paragraph>
            {health.orders} orders, {health.shipments} courier parcels ({health.unmatched} not matched to an order), {health.ads} ad days of spend.
            Store time zone {shop.timezone}, currency {shop.currency}.
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>Job</s-table-header>
              <s-table-header>Started</s-table-header>
              <s-table-header>Result</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {health.runs.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.job}</s-table-cell>
                  <s-table-cell>{new Date(r.startedAt).toLocaleString("en-GB", { timeZone: shop.timezone })}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.ok ? "success" : r.ok === false ? "critical" : "info"}>{r.ok ? "ok" : r.ok === false ? "failed" : "running"}</s-badge>{" "}
                    <span className="dr-detail">{(r.detail ?? "").slice(0, 160)}</span>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>
      <style>{`.dr-code{white-space:pre-wrap;word-break:break-all;font:12.5px/1.5 "IBM Plex Mono",ui-monospace,monospace;background:#f4f6fa;border:1px solid #e1e6ee;border-radius:8px;padding:10px 12px;margin:0}.dr-detail{color:#5a6678;font-size:12px}`}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
