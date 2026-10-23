import type { Shop } from "@prisma/client";
import db from "../../db.server";
import { listPostExParcels } from "../couriers/postex.server";
import { trackLeopards } from "../couriers/leopards.server";
import type { CourierParcel } from "../couriers/types";
import { decrypt } from "../crypto.server";
import { buildOrderMatcher } from "../match";
import { recomputeOrders } from "./status.server";

const DAY = 86_400_000;
const FINAL = ["DELIVERED", "RETURNED", "CANCELLED"];

export interface IngestResult {
  total: number;
  matched: number;
  unmatched: number;
  updated: number;
  ordersChanged: number;
  eventsQueued: number;
}

/** Saves courier parcels, links them to Shopify orders, and recomputes those orders. */
export async function ingestParcels(shopId: string, parcels: CourierParcel[], source: "api" | "csv"): Promise<IngestResult> {
  if (!parcels.length) return { total: 0, matched: 0, unmatched: 0, updated: 0, ordersChanged: 0, eventsQueued: 0 };

  const orders = await db.order.findMany({
    where: { shopId, createdAt: { gte: new Date(Date.now() - 120 * DAY) } },
    select: { id: true, name: true, orderNumber: true, trackingNumbers: true },
  });
  const match = buildOrderMatcher(orders);

  const existing = await db.shipment.findMany({
    where: { shopId, trackingNumber: { in: parcels.map((p) => p.trackingNumber) } },
    select: { id: true, courier: true, trackingNumber: true, status: true, rawStatus: true, orderId: true, statusAt: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.courier}::${e.trackingNumber}`, e]));

  let matched = 0;
  let updated = 0;
  const touchedOrders = new Set<string>();
  const writes = [];

  for (const p of parcels) {
    const orderId = match(p);
    if (orderId) matched += 1;
    const prev = byKey.get(`${p.courier}::${p.trackingNumber}`);
    const finalOrderId = orderId ?? prev?.orderId ?? null;
    const same =
      prev &&
      prev.status === p.status &&
      prev.rawStatus === p.rawStatus &&
      prev.orderId === finalOrderId &&
      (prev.statusAt?.getTime() ?? 0) === (p.statusAt?.getTime() ?? 0);
    if (same) continue;
    updated += 1;
    if (finalOrderId) touchedOrders.add(finalOrderId);
    if (prev?.orderId && prev.orderId !== finalOrderId) touchedOrders.add(prev.orderId);
    const data = {
      orderId: finalOrderId,
      orderRef: p.orderRef,
      rawStatus: p.rawStatus,
      status: p.status,
      statusAt: p.statusAt,
      codAmount: p.codAmount,
      city: p.city,
      source,
    };
    writes.push(
      db.shipment.upsert({
        where: { shopId_courier_trackingNumber: { shopId, courier: p.courier, trackingNumber: p.trackingNumber } },
        create: { shopId, courier: p.courier, trackingNumber: p.trackingNumber, ...data },
        update: data,
      }),
    );
  }

  for (let i = 0; i < writes.length; i += 50) {
    await db.$transaction(writes.slice(i, i + 50));
  }

  const recompute = await recomputeOrders(shopId, [...touchedOrders]);
  return {
    total: parcels.length,
    matched,
    unmatched: parcels.length - matched,
    updated,
    ordersChanged: recompute.changed,
    eventsQueued: recompute.queued,
  };
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Pulls every connected courier API for one store. */
export async function syncCouriers(shop: Shop, opts: { days?: number } = {}) {
  const days = opts.days ?? 45;
  const summary: Record<string, unknown> = {};

  const postexToken = decrypt(shop.postexTokenEnc);
  if (postexToken) {
    const parcels: CourierParcel[] = [];
    const end = new Date();
    // 15 day windows keep each response small
    for (let offset = 0; offset < days; offset += 15) {
      const windowEnd = new Date(end.getTime() - offset * DAY);
      const windowStart = new Date(end.getTime() - Math.min(days, offset + 15) * DAY);
      parcels.push(...(await listPostExParcels(postexToken, fmt(windowStart), fmt(windowEnd))));
    }
    summary.postex = await ingestParcels(shop.id, dedupe(parcels), "api");
  }

  const lKey = decrypt(shop.leopardsKeyEnc);
  const lPass = decrypt(shop.leopardsPassEnc);
  if (lKey && lPass) {
    const since = new Date(Date.now() - days * DAY);
    const [fromOrders, fromShipments] = await Promise.all([
      db.order.findMany({
        where: { shopId: shop.id, createdAt: { gte: since }, status: { notIn: FINAL }, trackingCompany: { contains: "eopard", mode: "insensitive" } },
        select: { trackingNumbers: true },
      }),
      db.shipment.findMany({
        where: { shopId: shop.id, courier: "leopards", status: { notIn: FINAL }, createdAt: { gte: since } },
        select: { trackingNumber: true },
      }),
    ]);
    const numbers = [...new Set([...fromOrders.flatMap((o) => o.trackingNumbers), ...fromShipments.map((s) => s.trackingNumber)])];
    summary.leopards = numbers.length
      ? await ingestParcels(shop.id, await trackLeopards(lKey, lPass, numbers), "api")
      : { total: 0, note: "no open Leopards parcels" };
  }

  await db.shop.update({ where: { id: shop.id }, data: { lastCourierSyncAt: new Date() } });
  return summary;
}

function dedupe(parcels: CourierParcel[]): CourierParcel[] {
  const m = new Map<string, CourierParcel>();
  for (const p of parcels) m.set(`${p.courier}::${p.trackingNumber}`, p);
  return [...m.values()];
}
