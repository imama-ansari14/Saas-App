import type { Shop } from "@prisma/client";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { sendQueuedEvents } from "./sync/capi.server";
import { syncCouriers } from "./sync/couriers.server";
import { syncMetaInsights } from "./sync/meta.server";
import { backfillOrders, syncRecentOrders } from "./sync/orders.server";

const MIN = 60_000;

export type JobName = "orders" | "couriers" | "meta" | "capi";

/** Postgres row lock with expiry, so overlapping cron calls never process a store twice. */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  // Prisma stores DateTime as UTC wall time, so compare against NOW() in UTC whatever the session zone is
  const seconds = Math.ceil(ttlMs / 1000);
  const rows = await db.$queryRaw<{ name: string }[]>`
    INSERT INTO "JobLock" ("name", "lockedUntil")
    VALUES (${name}, (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${seconds}::int))
    ON CONFLICT ("name") DO UPDATE SET "lockedUntil" = EXCLUDED."lockedUntil"
    WHERE "JobLock"."lockedUntil" < (NOW() AT TIME ZONE 'UTC')
    RETURNING "name"`;
  if (!rows.length) return null;
  try {
    return await fn();
  } finally {
    await db.jobLock.update({ where: { name }, data: { lockedUntil: new Date(0) } }).catch(() => undefined);
  }
}

async function record<T>(shopId: string, job: string, fn: () => Promise<T>): Promise<{ ok: boolean; result?: T; error?: string }> {
  const run = await db.jobRun.create({ data: { shopId, job } });
  try {
    const result = await fn();
    await db.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, detail: JSON.stringify(result).slice(0, 2000) },
    });
    return { ok: true, result };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 2000);
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, detail: error } });
    return { ok: false, error };
  }
}

const due = (last: Date | null, everyMs: number) => !last || Date.now() - last.getTime() >= everyMs;

/**
 * Runs whatever is due for one store: order import, courier status, Meta spend, then
 * the Conversions API sender. `force` runs the named jobs now regardless of schedule.
 */
export async function runShopJobs(shop: Shop, opts: { force?: JobName[]; budgetMs?: number } = {}) {
  const force = new Set(opts.force ?? []);
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const left = () => Math.max(5_000, deadline - Date.now());
  const out: Record<string, unknown> = {};

  return withLock(`shop:${shop.id}`, (opts.budgetMs ?? 120_000) + 60_000, async () => {
    if (!shop.backfillDone || force.has("orders") || due(shop.lastOrderSyncAt, 50 * MIN)) {
      out.orders = await record(shop.id, shop.backfillDone ? "orders" : "orders_backfill", async () => {
        const { admin } = await unauthenticated.admin(shop.id);
        return shop.backfillDone
          ? syncRecentOrders(shop, admin, 3, Math.min(30_000, left() / 3))
          : backfillOrders(shop, admin, Math.min(45_000, left() / 2));
      });
    }

    if ((shop.postexTokenEnc || shop.leopardsKeyEnc) && (force.has("couriers") || due(shop.lastCourierSyncAt, 55 * MIN))) {
      out.couriers = await record(shop.id, "couriers", () => syncCouriers(shop));
    }

    if (shop.metaAdAccountId && (force.has("meta") || !shop.metaBackfillDone || due(shop.lastMetaSyncAt, 350 * MIN))) {
      out.meta = await record(shop.id, "meta", () => syncMetaInsights(shop));
    }

    if (shop.capiEnabled) {
      const fresh = await db.shop.findUniqueOrThrow({ where: { id: shop.id } });
      out.capi = await record(shop.id, "capi", () => sendQueuedEvents(fresh, Math.min(30_000, left())));
    }
    return out;
  });
}

export async function activeShops() {
  return db.shop.findMany({ where: { uninstalledAt: null }, orderBy: { lastStatusRunAt: { sort: "asc", nulls: "first" } } });
}
