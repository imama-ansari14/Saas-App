import { normalizeCourierStatus } from "../status";
import { parseLooseDate, toNumber, type CourierParcel } from "./types";

// PostEx Merchant API (token in a "token" header).
// List orders:  GET /services/integration/api/order/v1/get-all-order?orderStatusId=0&startDate=&endDate=
// Track order:  GET /services/integration/api/order/v1/track-order/{trackingNumber}
const BASE = process.env.POSTEX_API_BASE || "https://api.postex.pk/services/integration/api";

export class PostExError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

async function call(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { token, Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  const code = body?.statusCode != null ? String(body.statusCode) : String(res.status);
  if (!res.ok || (code !== "200" && code !== "201")) {
    throw new PostExError(body?.statusMessage || `PostEx ${res.status}`, res.status, body);
  }
  return body;
}

/** Maps one PostEx tracking object, whatever wrapper it comes in. */
export function mapPostExParcel(item: any): CourierParcel | null {
  const t = item?.trackingResponse ?? item;
  const trackingNumber = t?.trackingNumber ?? item?.trackingNumber;
  if (!trackingNumber) return null;
  const history: any[] = Array.isArray(t?.transactionStatusHistory) ? t.transactionStatusHistory : [];
  const last = history.length
    ? [...history].sort(
        (a, b) =>
          (parseLooseDate(b?.modifiedDatetime ?? b?.updatedAt)?.getTime() ?? 0) -
          (parseLooseDate(a?.modifiedDatetime ?? a?.updatedAt)?.getTime() ?? 0),
      )[0]
    : null;
  const rawStatus: string | null =
    t?.transactionStatus ?? t?.orderStatus ?? last?.transactionStatusMessage ?? null;
  return {
    courier: "postex",
    trackingNumber: String(trackingNumber),
    orderRef: t?.orderRefNumber != null ? String(t.orderRefNumber) : null,
    rawStatus,
    status: normalizeCourierStatus(rawStatus),
    statusAt:
      parseLooseDate(last?.modifiedDatetime ?? last?.updatedAt) ??
      parseLooseDate(t?.updatedAt ?? t?.orderDeliveryDate ?? t?.transactionDate),
    codAmount: toNumber(t?.invoicePayment ?? t?.codAmount),
    city: t?.cityName ?? t?.deliveryCity ?? null,
  };
}

/** Every parcel booked in a date window, with its current status. One call per window. */
export async function listPostExParcels(token: string, startDate: string, endDate: string): Promise<CourierParcel[]> {
  const q = new URLSearchParams({ orderStatusId: "0", startDate, endDate });
  const body = await call(`/order/v1/get-all-order?${q.toString()}`, token);
  const list: any[] = Array.isArray(body?.dist) ? body.dist : Array.isArray(body?.dist?.orders) ? body.dist.orders : [];
  return list.map(mapPostExParcel).filter((p): p is CourierParcel => p != null);
}

export async function trackPostEx(token: string, trackingNumber: string): Promise<CourierParcel | null> {
  const body = await call(`/order/v1/track-order/${encodeURIComponent(trackingNumber)}`, token);
  return mapPostExParcel(body?.dist ?? body);
}

/** Used by Settings to prove a token works before saving it. */
export async function testPostEx(token: string): Promise<{ ok: boolean; message: string; sample?: unknown }> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const q = new URLSearchParams({ orderStatusId: "0", startDate: fmt(start), endDate: fmt(end) });
    const body = await call(`/order/v1/get-all-order?${q.toString()}`, token);
    const count = Array.isArray(body?.dist) ? body.dist.length : 0;
    return { ok: true, message: `Connected. ${count} parcels booked in the last 7 days.`, sample: body?.dist?.[0] };
  } catch (e: any) {
    return { ok: false, message: e?.message || "PostEx did not accept this token" };
  }
}
