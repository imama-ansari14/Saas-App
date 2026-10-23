import { normalizeCourierStatus } from "../status";
import { parseLooseDate, toNumber, type CourierParcel } from "./types";

// Leopards COD Merchant API: api_key and api_password as query params.
// Track: GET /api/trackBookedPacket/format/json/?api_key=&api_password=&track_numbers=A,B,C
const BASE = process.env.LEOPARDS_API_BASE || "https://merchantapi.leopardscourier.com/api";

export function mapLeopardsParcel(p: any): CourierParcel | null {
  const trackingNumber = p?.track_number ?? p?.trackNumber ?? p?.cn_number;
  if (!trackingNumber) return null;
  const details: any[] = Array.isArray(p?.["Tracking Detail"])
    ? p["Tracking Detail"]
    : Array.isArray(p?.tracking_detail)
      ? p.tracking_detail
      : [];
  const stamp = (d: any) =>
    parseLooseDate([d?.Activity_Date ?? d?.activity_date, d?.Activity_Time ?? d?.activity_time].filter(Boolean).join(" "));
  const last = details.length
    ? [...details].sort((a, b) => (stamp(b)?.getTime() ?? 0) - (stamp(a)?.getTime() ?? 0))[0]
    : null;
  const rawStatus: string | null = p?.booked_packet_status ?? last?.Status ?? last?.status ?? null;
  return {
    courier: "leopards",
    trackingNumber: String(trackingNumber),
    orderRef: p?.booked_packet_order_id != null ? String(p.booked_packet_order_id) : null,
    rawStatus,
    status: normalizeCourierStatus(rawStatus),
    statusAt: (last ? stamp(last) : null) ?? parseLooseDate(p?.booking_date),
    codAmount: toNumber(p?.booked_packet_collect_amount),
    city: p?.destination_city_name ?? null,
  };
}

export async function trackLeopards(apiKey: string, apiPassword: string, trackingNumbers: string[]): Promise<CourierParcel[]> {
  const out: CourierParcel[] = [];
  for (let i = 0; i < trackingNumbers.length; i += 50) {
    const batch = trackingNumbers.slice(i, i + 50);
    const q = new URLSearchParams({ api_key: apiKey, api_password: apiPassword, track_numbers: batch.join(",") });
    const res = await fetch(`${BASE}/trackBookedPacket/format/json/?${q.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !(body.status == 1 || body.status === true)) {
      throw new Error(body?.error || `Leopards ${res.status}`);
    }
    for (const p of body.packet_list ?? []) {
      const m = mapLeopardsParcel(p);
      if (m) out.push(m);
    }
  }
  return out;
}

export async function testLeopards(apiKey: string, apiPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    const q = new URLSearchParams({ api_key: apiKey, api_password: apiPassword });
    const res = await fetch(`${BASE}/getAllCities/format/json/?${q.toString()}`, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (body && (body.status == 1 || body.status === true)) return { ok: true, message: "Connected to Leopards." };
    return { ok: false, message: body?.error || `Leopards ${res.status}` };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Leopards did not accept these keys" };
  }
}
