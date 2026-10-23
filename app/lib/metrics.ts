import { cityLabel } from "./city";
import type {
  CityRow,
  DailyPoint,
  Report,
  ReportAdDay,
  ReportOrder,
  ReportRow,
} from "./types";

const META_SOURCES = new Set([
  "facebook",
  "fb",
  "ig",
  "instagram",
  "meta",
  "an",
  "audience_network",
  "msg",
  "messenger",
  "threads",
]);

/** Minimum parcels with a final status before a row uses its own delivery rate for Expected ROAS. */
const MIN_FINAL_FOR_OWN_RATE = 20;

export function isMetaOrder(o: Pick<ReportOrder, "utmSource" | "utmMedium" | "hasFbclid">): boolean {
  const src = (o.utmSource ?? "").trim().toLowerCase();
  if (META_SOURCES.has(src)) return true;
  if (src.includes("facebook") || src.includes("instagram")) return true;
  return o.hasFbclid;
}

function emptyRow(key: string, level: ReportRow["level"], id: string, name: string): ReportRow {
  return {
    key,
    level,
    id,
    name,
    spend: 0,
    metaPurchases: 0,
    metaValue: 0,
    orders: 0,
    delivered: 0,
    returned: 0,
    inTransit: 0,
    notDispatched: 0,
    cancelled: 0,
    orderValue: 0,
    deliveredRevenue: 0,
    returnedValue: 0,
    inTransitValue: 0,
    pendingValue: 0,
    metaRoas: null,
    deliveredRoas: null,
    expectedRoas: null,
    overstatement: null,
    rtoPct: null,
    costPerDelivered: null,
  };
}

function addOrder(row: ReportRow, o: ReportOrder, pending = false) {
  row.orders += 1;
  if (pending && o.status === "NOT_DISPATCHED") row.pendingValue += o.total;
  row.orderValue += o.total;
  switch (o.status) {
    case "DELIVERED":
      row.delivered += 1;
      row.deliveredRevenue += o.total;
      break;
    case "RETURNED":
      row.returned += 1;
      row.returnedValue += o.total;
      break;
    case "IN_TRANSIT":
      row.inTransit += 1;
      row.inTransitValue += o.total;
      break;
    case "CANCELLED":
      row.cancelled += 1;
      break;
    default:
      row.notDispatched += 1;
  }
}

function addSpend(row: ReportRow, a: ReportAdDay) {
  row.spend += a.spend;
  row.metaPurchases += a.purchases;
  row.metaValue += a.purchaseValue;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function finalize(row: ReportRow, fallbackRate: number | null, dispatchRate: number | null = null): ReportRow {
  const finals = row.delivered + row.returned;
  const ownRate = finals > 0 ? row.delivered / finals : null;
  const rate = finals >= MIN_FINAL_FOR_OWN_RATE ? ownRate : (fallbackRate ?? ownRate);
  row.metaRoas = ratio(row.metaValue, row.spend);
  row.deliveredRoas = ratio(row.deliveredRevenue, row.spend);
  // Expected: parcels in transit land at the row's delivery rate; orders still waiting to be
  // booked first get booked at the account's dispatch rate, then land at the same delivery rate
  row.expectedRoas =
    row.spend > 0
      ? (row.deliveredRevenue + (row.inTransitValue + row.pendingValue * (dispatchRate ?? 0)) * (rate ?? 0)) / row.spend
      : null;
  row.overstatement =
    row.metaRoas != null && row.deliveredRoas != null && row.deliveredRoas > 0
      ? row.metaRoas / row.deliveredRoas
      : null;
  row.rtoPct = finals > 0 ? row.returned / finals : null;
  row.costPerDelivered = row.delivered > 0 ? row.spend / row.delivered : null;
  return row;
}

function inRange(date: string, since: string, until: string) {
  return date >= since && date <= until;
}

export interface ReportOptions {
  since: string;
  until: string;
  currency?: string;
  now?: Date;
}

/**
 * The whole product in one function: joins Shopify orders (with their courier outcome)
 * to Meta spend by the UTM ids on the order, and returns campaign, ad, city and daily views.
 */
export function computeReport(
  orders: ReportOrder[],
  ads: ReportAdDay[],
  opts: ReportOptions,
): Report {
  const { since, until } = opts;
  // Orders from the last few days of the range may simply not be booked yet
  const pendingFrom = addDays(until, -4);
  let olderDispatched = 0;
  let olderAll = 0;

  // Name and id lookups use every ad we know about, so an order still maps to its
  // campaign when the ad spent outside the selected range.
  const campaignNames = new Map<string, string>();
  const campaignByLowerName = new Map<string, string>();
  const adInfo = new Map<string, { campaignId: string; name: string }>();
  const adByLowerName = new Map<string, string>();
  for (const a of ads) {
    campaignNames.set(a.campaignId, a.campaignName);
    campaignByLowerName.set(a.campaignName.trim().toLowerCase(), a.campaignId);
    adInfo.set(a.adId, { campaignId: a.campaignId, name: a.adName });
    adByLowerName.set(`${a.campaignId}::${a.adName.trim().toLowerCase()}`, a.adId);
  }

  const campaigns = new Map<string, ReportRow>();
  const adsRows = new Map<string, ReportRow>();
  const getCampaign = (id: string) => {
    let r = campaigns.get(id);
    if (!r) {
      r = emptyRow(`c:${id}`, "campaign", id, campaignNames.get(id) ?? `Campaign ${id}`);
      r.children = [];
      campaigns.set(id, r);
    }
    return r;
  };
  const getAd = (adId: string, campaignId: string) => {
    let r = adsRows.get(adId);
    if (!r) {
      r = emptyRow(`a:${adId}`, "ad", adId, adInfo.get(adId)?.name ?? `Ad ${adId}`);
      adsRows.set(adId, r);
      getCampaign(campaignId).children!.push(r);
    }
    return r;
  };

  const daily = new Map<string, DailyPoint & { inTransitValue: number; pendingValue: number }>();
  const getDay = (d: string) => {
    let p = daily.get(d);
    if (!p) {
      p = { date: d, spend: 0, metaValue: 0, deliveredRevenue: 0, expectedRevenue: 0, inTransitValue: 0, pendingValue: 0 };
      daily.set(d, p);
    }
    return p;
  };

  for (const a of ads) {
    if (!inRange(a.date, since, until)) continue;
    addSpend(getCampaign(a.campaignId), a);
    addSpend(getAd(a.adId, a.campaignId), a);
    const p = getDay(a.date);
    p.spend += a.spend;
    p.metaValue += a.purchaseValue;
  }

  const unattributed = emptyRow("unattributed", "unattributed", "unattributed", "Unattributed Meta orders");
  const other = { orders: 0, deliveredRevenue: 0, delivered: 0, returned: 0 };
  const store = { orders: 0, delivered: 0, returned: 0, inTransit: 0, deliveredRevenue: 0, blendedRoas: null as number | null };
  const cityRows = new Map<string, CityRow>();

  for (const o of orders) {
    if (!inRange(o.date, since, until)) continue;
    const pending = o.date >= pendingFrom;
    if (!pending) {
      olderAll += 1;
      if (o.status === "DELIVERED" || o.status === "RETURNED" || o.status === "IN_TRANSIT") olderDispatched += 1;
    }

    store.orders += 1;
    if (o.status === "DELIVERED") {
      store.delivered += 1;
      store.deliveredRevenue += o.total;
    } else if (o.status === "RETURNED") store.returned += 1;
    else if (o.status === "IN_TRANSIT") store.inTransit += 1;

    if (o.city) {
      let c = cityRows.get(o.city);
      if (!c) {
        c = {
          city: o.city,
          label: cityLabel(o.city),
          orders: 0,
          delivered: 0,
          returned: 0,
          inTransit: 0,
          rtoPct: null,
          deliveredRevenue: 0,
          lostValue: 0,
          share: 0,
        };
        cityRows.set(o.city, c);
      }
      c.orders += 1;
      if (o.status === "DELIVERED") {
        c.delivered += 1;
        c.deliveredRevenue += o.total;
      } else if (o.status === "RETURNED") {
        c.returned += 1;
        c.lostValue += o.total;
      } else if (o.status === "IN_TRANSIT") c.inTransit += 1;
    }

    // Attribution: campaign id, then campaign name, then the ad id alone
    const utmCampaign = o.utmCampaign?.trim() || null;
    const utmContent = o.utmContent?.trim() || null;
    let campaignId: string | null = null;
    if (utmCampaign && campaignNames.has(utmCampaign)) campaignId = utmCampaign;
    else if (utmCampaign && campaignByLowerName.has(utmCampaign.toLowerCase()))
      campaignId = campaignByLowerName.get(utmCampaign.toLowerCase())!;
    else if (utmContent && adInfo.has(utmContent)) campaignId = adInfo.get(utmContent)!.campaignId;

    const meta = campaignId != null || isMetaOrder(o);
    if (!meta) {
      other.orders += 1;
      if (o.status === "DELIVERED") {
        other.delivered += 1;
        other.deliveredRevenue += o.total;
      } else if (o.status === "RETURNED") other.returned += 1;
      continue;
    }

    const p = getDay(o.date);
    if (o.status === "DELIVERED") p.deliveredRevenue += o.total;
    if (o.status === "IN_TRANSIT") p.inTransitValue += o.total;
    if (o.status === "NOT_DISPATCHED" && pending) p.pendingValue += o.total;

    if (!campaignId) {
      addOrder(unattributed, o, pending);
      continue;
    }
    addOrder(getCampaign(campaignId), o, pending);
    let adId: string | null = null;
    if (utmContent && adInfo.get(utmContent)?.campaignId === campaignId) adId = utmContent;
    else if (utmContent && adByLowerName.has(`${campaignId}::${utmContent.toLowerCase()}`))
      adId = adByLowerName.get(`${campaignId}::${utmContent.toLowerCase()}`)!;
    if (adId) addOrder(getAd(adId, campaignId), o, pending);
  }

  // Account level = every Meta sourced order against every rupee of spend
  const totals = emptyRow("account", "account", "account", "All Meta campaigns");
  for (const c of campaigns.values()) {
    for (const k of [
      "spend",
      "metaPurchases",
      "metaValue",
      "orders",
      "delivered",
      "returned",
      "inTransit",
      "notDispatched",
      "cancelled",
      "orderValue",
      "deliveredRevenue",
      "returnedValue",
      "inTransitValue",
      "pendingValue",
    ] as const) {
      totals[k] += c[k];
    }
  }
  for (const k of [
    "orders",
    "delivered",
    "returned",
    "inTransit",
    "notDispatched",
    "cancelled",
    "orderValue",
    "deliveredRevenue",
    "returnedValue",
    "inTransitValue",
    "pendingValue",
  ] as const) {
    totals[k] += unattributed[k];
  }

  const accountFinals = totals.delivered + totals.returned;
  const deliveryRate = accountFinals > 0 ? totals.delivered / accountFinals : null;
  const dispatchRate = olderAll >= 20 ? olderDispatched / olderAll : 0.9;

  finalize(totals, deliveryRate, dispatchRate);
  finalize(unattributed, deliveryRate, dispatchRate);
  const campaignList = [...campaigns.values()]
    .map((c) => {
      const cRate =
        c.delivered + c.returned >= MIN_FINAL_FOR_OWN_RATE ? c.delivered / (c.delivered + c.returned) : deliveryRate;
      c.children = (c.children ?? []).map((a) => finalize(a, cRate, dispatchRate)).sort((x, y) => y.spend - x.spend || y.orders - x.orders);
      return finalize(c, deliveryRate, dispatchRate);
    })
    .sort((x, y) => y.spend - x.spend || y.orders - x.orders);

  store.blendedRoas = totals.spend > 0 ? store.deliveredRevenue / totals.spend : null;

  const cities = [...cityRows.values()]
    .map((c) => {
      const finals = c.delivered + c.returned;
      c.rtoPct = finals > 0 ? c.returned / finals : null;
      c.share = store.orders > 0 ? c.orders / store.orders : 0;
      return c;
    })
    .sort((a, b) => b.orders - a.orders);

  const dailyList: DailyPoint[] = [...daily.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(({ inTransitValue, pendingValue, ...p }) => ({
      ...p,
      expectedRevenue: p.deliveredRevenue + (inTransitValue + pendingValue * dispatchRate) * (deliveryRate ?? 0),
    }));

  return {
    since,
    until,
    currency: opts.currency ?? "PKR",
    totals,
    campaigns: campaignList,
    unattributed,
    other,
    store,
    cities,
    daily: dailyList,
    deliveryRate,
    dispatchRate,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** YYYY-MM-DD for a moment in a given IANA time zone. */
export function dateKey(d: Date, timeZone = "Asia/Karachi"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const RANGE_PRESETS = [
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "60d", label: "Last 60 days" },
  { id: "settled", label: "Settled window (40 to 10 days ago)" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

export function resolveRange(preset: string | null | undefined, today: string): { since: string; until: string; preset: RangePreset } {
  switch (preset) {
    case "7d":
      return { since: addDays(today, -6), until: today, preset: "7d" };
    case "14d":
      return { since: addDays(today, -13), until: today, preset: "14d" };
    case "60d":
      return { since: addDays(today, -59), until: today, preset: "60d" };
    case "settled":
      return { since: addDays(today, -40), until: addDays(today, -10), preset: "settled" };
    default:
      return { since: addDays(today, -29), until: today, preset: "30d" };
  }
}
