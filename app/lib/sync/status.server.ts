import type { Prisma } from "@prisma/client";
import db from "../../db.server";
import { MAX_EVENT_AGE_MS, eventIdFor } from "../meta/capi.server";
import { hasConfirmTag } from "../shopify/orders.server";
import { deriveOrderStatus } from "../status";
import type { CapiEventName } from "../types";

const DAY = 86_400_000;

/**
 * Recomputes status and confirmation for the given orders and queues the Meta events
 * their transitions earn. Safe to run any number of times: event ids are unique per order.
 * `historical` is used during the first import so old orders do not look freshly confirmed.
 */
export async function recomputeOrders(shopId: string, orderIds: string[], opts: { historical?: boolean } = {}) {
  if (!orderIds.length) return { changed: 0, queued: 0 };
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { changed: 0, queued: 0 };
  const now = new Date();
  let changed = 0;
  let queued = 0;

  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const orders = await db.order.findMany({
      where: { id: { in: chunk }, shopId },
      include: { shipments: { select: { status: true, statusAt: true, courier: true } } },
    });
    const events: Prisma.CapiEventCreateManyInput[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const o of orders) {
      const derived = deriveOrderStatus({
        cancelledAt: o.cancelledAt,
        hasTracking: o.trackingNumbers.length > 0 && !o.cancelledAt,
        shipments: o.shipments,
      });

      let confirmedAt = o.confirmedAt;
      if (!confirmedAt && !o.cancelledAt) {
        const tagged = hasConfirmTag(o.tags, shop.confirmTags);
        const dispatched = shop.confirmOnBooking && (o.shipments.some((s) => s.status !== "CANCELLED") || ["DELIVERED", "RETURNED", "IN_TRANSIT"].includes(derived.status));
        if (tagged || dispatched) {
          const age = now.getTime() - o.createdAt.getTime();
          confirmedAt = opts.historical && age > 3 * DAY ? o.createdAt : now;
        }
      }

      const queue = (name: CapiEventName, at: Date | null, value: number | null) => {
        if (!at) return;
        if (now.getTime() - at.getTime() > MAX_EVENT_AGE_MS) return;
        events.push({
          shopId,
          orderId: o.id,
          orderName: o.name,
          eventName: name,
          eventId: eventIdFor(name, o.shopifyId),
          eventTime: at > now ? now : at,
          value,
        });
      };

      if (confirmedAt && !o.confirmedAt && shop.sendConfirmed && !o.cancelledAt) {
        queue("ConfirmedOrder", confirmedAt, o.total);
      }
      if (derived.status !== o.status) {
        // A parcel with no status time only counts as fresh if the order itself is recent
        const at = derived.statusAt ?? (now.getTime() - o.createdAt.getTime() < 12 * DAY ? now : null);
        if (derived.status === "DELIVERED" && shop.sendDelivered) queue("DeliveredOrder", at, o.total);
        if (derived.status === "RETURNED" && shop.sendReturned) queue("ReturnedOrder", at, null);
      }

      const statusChanged = derived.status !== o.status;
      if (statusChanged || confirmedAt?.getTime() !== o.confirmedAt?.getTime() || derived.courier !== o.courier) {
        changed += 1;
        updates.push(
          db.order.update({
            where: { id: o.id },
            data: {
              status: derived.status,
              statusAt: derived.statusAt ?? (statusChanged ? now : o.statusAt),
              courier: derived.courier ?? o.courier,
              confirmedAt,
            },
          }),
        );
      }
    }

    if (updates.length) await db.$transaction(updates);
    if (events.length) {
      const res = await db.capiEvent.createMany({ data: events, skipDuplicates: true });
      queued += res.count;
    }
  }

  await db.shop.update({ where: { id: shopId }, data: { lastStatusRunAt: now } });
  return { changed, queued };
}
