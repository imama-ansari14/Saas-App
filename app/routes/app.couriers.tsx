import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseCourierFile } from "../lib/couriers/csv.server";
import { ingestParcels, type IngestResult } from "../lib/sync/couriers.server";
import { ensureShop, getShop } from "../lib/shop.server";

const COURIERS = [
  { id: "tcs", label: "TCS" },
  { id: "trax", label: "Trax" },
  { id: "mnp", label: "M&P" },
  { id: "postex", label: "PostEx" },
  { id: "leopards", label: "Leopards" },
  { id: "callcourier", label: "Call Courier" },
  { id: "blueex", label: "BlueEx" },
  { id: "other", label: "Other" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));
  const [recent, byStatus, unmatched] = await Promise.all([
    db.shipment.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { order: { select: { name: true } } },
    }),
    db.shipment.groupBy({ by: ["courier", "status"], where: { shopId: shop.id }, _count: { _all: true } }),
    db.shipment.count({ where: { shopId: shop.id, orderId: null } }),
  ]);
  return {
    connected: { postex: Boolean(shop.postexTokenEnc), leopards: Boolean(shop.leopardsKeyEnc) },
    lastCourierSyncAt: shop.lastCourierSyncAt?.toISOString() ?? null,
    timezone: shop.timezone,
    unmatched,
    summary: byStatus.map((g) => ({ courier: g.courier, status: g.status, count: g._count._all })),
    recent: recent.map((s) => ({
      id: s.id,
      courier: s.courier,
      trackingNumber: s.trackingNumber,
      orderName: s.order?.name ?? null,
      orderRef: s.orderRef,
      rawStatus: s.rawStatus,
      status: s.status,
      updatedAt: s.updatedAt.toISOString(),
    })),
  };
};

type UploadResult = { ok: boolean; message: string; result?: IngestResult; columns?: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<UploadResult> => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const file = form.get("file");
  const courier = String(form.get("courier") ?? "other");
  if (!file || typeof file === "string" || !(file as File).size) {
    return { ok: false, message: "Choose the courier's status export first (.csv or .xlsx)." };
  }
  const f = file as File;
  if (f.size > 4 * 1024 * 1024) return { ok: false, message: "That file is over 4 MB. Export a shorter date range and upload it in parts." };
  const parsed = await parseCourierFile(Buffer.from(await f.arrayBuffer()), f.name, courier);
  if (parsed.error) return { ok: false, message: parsed.error };
  if (!parsed.parcels.length) return { ok: false, message: "The file has headers but no parcel rows." };
  const result = await ingestParcels(session.shop, parsed.parcels, "csv");
  return {
    ok: true,
    message: `Read ${parsed.parcels.length} parcels. ${result.matched} matched to Shopify orders, ${result.unmatched} did not, ${result.ordersChanged} orders changed status, ${result.eventsQueued} Meta events queued.`,
    result,
    columns: parsed.columns as Record<string, string>,
  };
};

const STATUS_TONE: Record<string, "success" | "critical" | "info" | "warning" | "neutral"> = {
  DELIVERED: "success",
  RETURNED: "critical",
  RETURN_IN_TRANSIT: "warning",
  CANCELLED: "neutral",
};

export default function Couriers() {
  const data = useLoaderData<typeof loader>();
  const upload = useActionData<typeof action>();
  const nav = useNavigation();
  const sync = useFetcher<{ ok?: boolean; error?: string }>();
  const uploading = nav.state === "submitting";
  const anyApi = data.connected.postex || data.connected.leopards;

  return (
    <s-page heading="Couriers" inlineSize="large">
      <s-section heading="Upload a courier status export">
        <Form method="post" encType="multipart/form-data">
          <s-stack gap="base">
            {upload ? <s-banner tone={upload.ok ? "success" : "critical"}>{upload.message}</s-banner> : null}
            {upload?.columns ? (
              <s-paragraph>
                Columns used: {Object.entries(upload.columns).map(([k, v]) => `${k} = "${v}"`).join(", ")}
              </s-paragraph>
            ) : null}
            <s-paragraph>
              Download the shipment report from the courier portal for the last 45 days and upload it as it is. The app finds the tracking number,
              order reference and status columns by name.
            </s-paragraph>
            <s-select name="courier" label="Courier" value="tcs">
              {COURIERS.map((c) => (
                <s-option key={c.id} value={c.id}>{c.label}</s-option>
              ))}
            </s-select>
            <label className="dr-file">
              <span>File (.csv or .xlsx)</span>
              <input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
            </label>
            <s-button type="submit" variant="primary" loading={uploading || undefined}>Upload and match</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Courier APIs">
        <s-stack gap="base">
          <s-paragraph>
            PostEx {data.connected.postex ? "connected" : "not connected"}, Leopards {data.connected.leopards ? "connected" : "not connected"}.
            {data.lastCourierSyncAt ? ` Last sync ${new Date(data.lastCourierSyncAt).toLocaleString("en-GB", { timeZone: data.timezone })}.` : ""}
            {" "}{data.unmatched} parcels could not be matched to an order yet.
          </s-paragraph>
          {sync.data?.error ? <s-banner tone="critical">{sync.data.error}</s-banner> : null}
          {sync.data?.ok ? <s-banner tone="success">Courier sync finished.</s-banner> : null}
          {anyApi ? (
            <sync.Form method="post" action="/app/sync">
              <input type="hidden" name="job" value="couriers" />
              <s-button type="submit" loading={sync.state !== "idle" || undefined}>Sync couriers now</s-button>
            </sync.Form>
          ) : (
            <s-link href="/app/settings">Connect PostEx or Leopards in Settings</s-link>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Parcel status by courier">
        <s-table>
          <s-table-header-row>
            <s-table-header>Courier</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header format="numeric">Parcels</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.summary.map((g) => (
              <s-table-row key={`${g.courier}:${g.status}`}>
                <s-table-cell>{g.courier}</s-table-cell>
                <s-table-cell><s-badge tone={STATUS_TONE[g.status] ?? "info"}>{g.status.replace(/_/g, " ").toLowerCase()}</s-badge></s-table-cell>
                <s-table-cell>{g.count}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Latest parcel updates">
        <s-table>
          <s-table-header-row>
            <s-table-header>Tracking</s-table-header>
            <s-table-header>Order</s-table-header>
            <s-table-header>Courier status</s-table-header>
            <s-table-header>Read as</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.recent.map((s) => (
              <s-table-row key={s.id}>
                <s-table-cell>{s.courier} {s.trackingNumber}</s-table-cell>
                <s-table-cell>{s.orderName ?? (s.orderRef ? `${s.orderRef} (no match)` : "no match")}</s-table-cell>
                <s-table-cell>{s.rawStatus ?? ""}</s-table-cell>
                <s-table-cell><s-badge tone={STATUS_TONE[s.status] ?? "info"}>{s.status.replace(/_/g, " ").toLowerCase()}</s-badge></s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <style>{`.dr-file{display:grid;gap:6px;font-size:13px}.dr-file input{font:inherit}`}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
