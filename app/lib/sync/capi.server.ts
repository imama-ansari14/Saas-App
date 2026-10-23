import type { CapiEvent, Order, Shop } from "@prisma/client";
import db from "../../db.server";
import { BATCH_SIZE, buildCapiEvent, sendCapiBatch, type CapiOrder } from "../meta/capi.server";
import { capiTokenFor, storeUrl } from "../shop.server";
import type { CapiEventName } from "../types";

const MAX_ATTEMPTS = 3;

function toCapiOrder(o: Order): CapiOrder {
  return {
    shopifyId: o.shopifyId,
    name: o.name,
    total: o.total,
    currency: o.currency,
    itemCount: o.itemCount,
    phoneHash: o.phoneHash,
    emailHash: o.emailHash,
    fnHash: o.fnHash,
    lnHash: o.lnHash,
    externalIdHash: o.externalIdHash,
    city: o.cityLabel ?? o.city,
    countryCode: o.countryCode,
    fbp: o.fbp,
    fbc: o.fbc,
    userAgent: o.userAgent,
    clientIp: o.clientIp,
    sourceUrl: o.sourceUrl,
  };
}

function errorText(body: any, status: number): string {
  const e = body?.error;
  if (!e) return `HTTP ${status}`;
  return [e.message, e.error_user_msg, e.fbtrace_id ? `trace ${e.fbtrace_id}` : null].filter(Boolean).join(" | ").slice(0, 900);
}

/**
 * Sends queued ConfirmedOrder, DeliveredOrder and ReturnedOrder events to the store's pixel.
 * Stale events are marked and never sent, because one stale event fails a whole request.
 */
export async function sendQueuedEvents(shop: Shop, budgetMs = 20_000) {
  const token = capiTokenFor(shop);
  if (!shop.capiEnabled || !shop.metaPixelId || !token) {
    return { skipped: "Conversions API is off or the pixel id or token is missing" };
  }
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let stale = 0;
  let skipped = 0;
  const seen: string[] = []; // each event is tried at most once per run

  while (Date.now() - started < budgetMs) {
    const queued = await db.capiEvent.findMany({
      where: {
        shopId: shop.id,
        id: seen.length ? { notIn: seen } : undefined,
        OR: [{ status: "QUEUED" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }],
      },
      orderBy: { eventTime: "asc" },
      take: 200,
    });
    if (!queued.length) break;
    seen.push(...queued.map((q) => q.id));
    const orders = await db.order.findMany({ where: { id: { in: [...new Set(queued.map((q) => q.orderId))] } } });
    const byId = new Map(orders.map((o) => [o.id, o]));

    const ready: { ev: CapiEvent; payload: Record<string, unknown>; source: string }[] = [];
    const now = new Date();
    for (const ev of queued) {
      const order = byId.get(ev.orderId);
      if (!order) {
        await db.capiEvent.update({ where: { id: ev.id }, data: { status: "SKIPPED", error: "order no longer exists" } });
        skipped += 1;
        continue;
      }
      const built = buildCapiEvent({
        eventName: ev.eventName as CapiEventName,
        eventTime: ev.eventTime,
        order: toCapiOrder(order),
        preferredSource: shop.deliveredSource === "system_generated" ? "system_generated" : "website",
        storeUrl: storeUrl(shop),
        now,
      });
      if (!built.ok) {
        const isStale = built.reason === "stale";
        await db.capiEvent.update({
          where: { id: ev.id },
          data: {
            status: isStale ? "STALE" : "SKIPPED",
            error: isStale ? "older than 7 days, Meta would reject it" : "no phone, email, customer id or browser id to match on",
          },
        });
        if (isStale) stale += 1;
        else skipped += 1;
        continue;
      }
      ready.push({ ev, payload: built.event.payload, source: built.event.actionSource });
    }

    for (let i = 0; i < ready.length; i += BATCH_SIZE) {
      const batch = ready.slice(i, i + BATCH_SIZE);
      const res = await sendCapiBatch(shop.metaPixelId, token, batch.map((b) => b.payload), shop.capiTestCode);
      if (res.ok) {
        await db.$transaction(
          batch.map((b) =>
            db.capiEvent.update({
              where: { id: b.ev.id },
              data: {
                status: "SENT",
                sentAt: new Date(),
                attempts: { increment: 1 },
                source: b.source,
                error: null,
                response: { events_received: res.body?.events_received ?? null, fbtrace_id: res.body?.fbtrace_id ?? null, test: Boolean(shop.capiTestCode) },
              },
            }),
          ),
        );
        sent += batch.length;
        continue;
      }
      // A rejected batch: send one by one so a single bad event cannot block the rest
      for (const b of batch) {
        const single = batch.length === 1 ? res : await sendCapiBatch(shop.metaPixelId, token, [b.payload], shop.capiTestCode);
        await db.capiEvent.update({
          where: { id: b.ev.id },
          data: single.ok
            ? {
                status: "SENT",
                sentAt: new Date(),
                attempts: { increment: 1 },
                source: b.source,
                error: null,
                response: { events_received: single.body?.events_received ?? null, fbtrace_id: single.body?.fbtrace_id ?? null, test: Boolean(shop.capiTestCode) },
              }
            : { status: "FAILED", attempts: { increment: 1 }, source: b.source, error: errorText(single.body, single.status), response: single.body ?? undefined },
        });
        if (single.ok) sent += 1;
        else failed += 1;
      }
    }
    if (queued.length < 200) break;
  }

  await db.shop.update({ where: { id: shop.id }, data: { lastCapiRunAt: new Date() } });
  return { sent, failed, stale, skipped };
}
