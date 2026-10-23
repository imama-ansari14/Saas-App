import type { CourierParcel } from "../couriers/types";
import { buildOrderMatcher, refDigits } from "../match";
import { addDays, computeReport, dateKey, resolveRange } from "../metrics";
import { deriveOrderStatus } from "../status";
import type { OrderStatus, Report, ReportAdDay, ReportOrder } from "../types";
import type { ImportedOrder } from "./shopify-csv";

// Joins the three exports the way the live app joins its three connections:
// Shopify orders, courier outcomes matched by order reference, and Meta spend.

export interface AuditInput {
  orders: ImportedOrder[];
  parcels: CourierParcel[];
  ads: ReportAdDay[];
  timeZone?: string;
  currency?: string;
}

export interface AuditData {
  orders: ReportOrder[];
  ads: ReportAdDay[];
  /** Last day with data: ranges are counted back from here */
  end: string;
  start: string;
  campaignJoin: boolean;
  stats: {
    orders: number;
    parcels: number;
    parcelsMatched: number;
    ordersWithParcel: number;
    dispatchedWithOutcome: number;
    utmShare: number;
    spend: number;
  };
}

export function buildAudit(input: AuditInput): AuditData {
  const tz = input.timeZone ?? "Asia/Karachi";
  const ids = input.orders.map((o, i) => ({ ...o, id: `f${i}` }));
  const match = buildOrderMatcher(ids.map((o) => ({ id: o.id, name: o.name, orderNumber: Number(refDigits(o.name)) || null })));
  const byOrder = new Map<string, CourierParcel[]>();
  let parcelsMatched = 0;
  for (const p of input.parcels) {
    const id = match(p);
    if (!id) continue;
    parcelsMatched += 1;
    const list = byOrder.get(id) ?? [];
    list.push(p);
    byOrder.set(id, list);
  }

  const withUtm = ids.filter((o) => o.utmCampaign).length;
  const utmShare = ids.length ? withUtm / ids.length : 0;
  // A plain Shopify export has no UTMs. Then every order is compared against Meta spend at
  // account level, which is how the manual audit in the playbook works.
  const campaignJoin = utmShare >= 0.2;

  let dispatched = 0;
  let withOutcome = 0;
  const orders: ReportOrder[] = ids.map((o) => {
    const parcels = byOrder.get(o.id) ?? [];
    const derived = deriveOrderStatus({ cancelledAt: o.cancelledAt, hasTracking: o.fulfilled && !o.cancelledAt, shipments: parcels });
    if (derived.status !== "CANCELLED" && derived.status !== "NOT_DISPATCHED") {
      dispatched += 1;
      if (derived.status !== "IN_TRANSIT" || parcels.length) withOutcome += 1;
    }
    return {
      id: o.id,
      name: o.name,
      date: dateKey(o.createdAt, tz),
      total: o.total,
      isCod: o.isCod,
      status: derived.status as OrderStatus,
      city: o.city,
      cityLabel: o.cityLabel,
      utmSource: campaignJoin ? o.utmSource : o.utmSource || "facebook",
      utmMedium: o.utmMedium,
      utmCampaign: campaignJoin ? o.utmCampaign : null,
      utmContent: campaignJoin ? o.utmContent : null,
      hasFbclid: o.hasFbclid,
    };
  });

  const dates = [...orders.map((o) => o.date), ...input.ads.map((a) => a.date)].sort();
  return {
    orders,
    ads: input.ads,
    start: dates[0] ?? dateKey(new Date(), tz),
    end: dates[dates.length - 1] ?? dateKey(new Date(), tz),
    campaignJoin,
    stats: {
      orders: orders.length,
      parcels: input.parcels.length,
      parcelsMatched,
      ordersWithParcel: byOrder.size,
      dispatchedWithOutcome: dispatched ? withOutcome / dispatched : 0,
      utmShare,
      spend: input.ads.reduce((s, a) => s + a.spend, 0),
    },
  };
}

/** Report for an audit, with ranges counted back from the last day in the files. */
export function auditReport(a: AuditData, preset: string, currency = "PKR"): Report {
  const range =
    preset === "all" ? { since: a.start, until: a.end } : resolveRange(preset, a.end);
  const since = range.since < a.start ? a.start : range.since;
  const report = computeReport(a.orders, a.ads, { since, until: range.until, currency });
  report.campaignJoin = a.campaignJoin;
  return report;
}

export function daysBetween(a: string, b: string): number {
  let n = 0;
  let d = a;
  while (d < b && n < 4000) {
    d = addDays(d, 1);
    n += 1;
  }
  return n + 1;
}
