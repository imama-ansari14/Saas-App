import type { Shop } from "@prisma/client";
import db from "../db.server";
import { addDays, computeReport, dateKey } from "./metrics";
import type { CapiLogRow, OrderStatus, Report, ReportAdDay, ReportOrder } from "./types";

export async function loadReport(shop: Shop, since: string, until: string): Promise<Report> {
  // Pull a day either side in UTC, then cut exactly on the store's local date
  const start = new Date(`${addDays(since, -1)}T00:00:00Z`);
  const end = new Date(`${addDays(until, 2)}T00:00:00Z`);
  const [orders, ads] = await Promise.all([
    db.order.findMany({
      where: { shopId: shop.id, createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        name: true,
        createdAt: true,
        total: true,
        isCod: true,
        status: true,
        city: true,
        cityLabel: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmContent: true,
        fbclid: true,
      },
    }),
    db.adDaily.findMany({
      where: { shopId: shop.id, date: { gte: addDays(since, -90), lte: until } },
      select: {
        date: true,
        campaignId: true,
        campaignName: true,
        adId: true,
        adName: true,
        spend: true,
        purchases: true,
        purchaseValue: true,
      },
    }),
  ]);

  const reportOrders: ReportOrder[] = orders.map((o) => ({
    id: o.id,
    name: o.name,
    date: dateKey(o.createdAt, shop.timezone),
    total: o.total,
    isCod: o.isCod,
    status: o.status as OrderStatus,
    city: o.city,
    cityLabel: o.cityLabel,
    utmSource: o.utmSource,
    utmMedium: o.utmMedium,
    utmCampaign: o.utmCampaign,
    utmContent: o.utmContent,
    hasFbclid: Boolean(o.fbclid),
  }));

  return computeReport(reportOrders, ads as ReportAdDay[], { since, until, currency: shop.currency });
}

export async function loadCapiLog(shopId: string, take = 100): Promise<{ rows: CapiLogRow[]; counts: Record<string, number> }> {
  const [rows, grouped] = await Promise.all([
    db.capiEvent.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take }),
    db.capiEvent.groupBy({
      by: ["eventName", "status"],
      where: { shopId, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      _count: { _all: true },
    }),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[`${g.eventName}:${g.status}`] = g._count._all;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      orderName: r.orderName,
      eventName: r.eventName,
      eventTime: r.eventTime.toISOString(),
      value: r.value,
      status: r.status,
      source: r.source,
      error: r.error,
      sentAt: r.sentAt?.toISOString() ?? null,
    })),
    counts,
  };
}

export async function loadSyncHealth(shop: Shop) {
  const [orders, shipments, unmatched, ads, signals, runs] = await Promise.all([
    db.order.count({ where: { shopId: shop.id } }),
    db.shipment.count({ where: { shopId: shop.id } }),
    db.shipment.count({ where: { shopId: shop.id, orderId: null } }),
    db.adDaily.count({ where: { shopId: shop.id } }),
    db.checkoutSignal.count({ where: { shopId: shop.id } }),
    db.jobRun.findMany({ where: { shopId: shop.id }, orderBy: { startedAt: "desc" }, take: 15 }),
  ]);
  const withUtm = await db.order.count({ where: { shopId: shop.id, utmCampaign: { not: null } } });
  return {
    orders,
    shipments,
    unmatched,
    ads,
    signals,
    utmShare: orders ? withUtm / orders : 0,
    runs: runs.map((r) => ({
      id: r.id,
      job: r.job,
      startedAt: r.startedAt.toISOString(),
      ok: r.ok,
      detail: r.detail,
    })),
  };
}
