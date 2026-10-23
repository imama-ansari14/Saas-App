import type { Prisma, Shop } from "@prisma/client";
import db from "../../db.server";
import { fetchOrderById, fetchOrdersPage, mapShopifyOrder, type MappedOrder } from "../shopify/orders.server";
import { recomputeOrders } from "./status.server";

type AdminLike = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

function toRow(shopId: string, m: MappedOrder, signal?: { fbp: string | null; fbc: string | null; userAgent: string | null; pageUrl: string | null } | null) {
  const data = {
    name: m.name,
    orderNumber: m.orderNumber,
    createdAt: m.createdAt,
    total: m.total,
    currency: m.currency,
    isCod: m.isCod,
    financialStatus: m.financialStatus,
    cancelledAt: m.cancelledAt,
    tags: m.tags,
    city: m.city,
    cityLabel: m.cityLabel,
    countryCode: m.countryCode,
    itemCount: m.itemCount,
    phoneHash: m.phoneHash,
    emailHash: m.emailHash,
    fnHash: m.fnHash,
    lnHash: m.lnHash,
    externalIdHash: m.externalIdHash,
    utmSource: m.utmSource,
    utmMedium: m.utmMedium,
    utmCampaign: m.utmCampaign,
    utmContent: m.utmContent,
    utmTerm: m.utmTerm,
    landingPage: m.landingPage,
    fbclid: m.fbclid,
    clientIp: m.clientIp,
    trackingNumbers: m.trackingNumbers,
    trackingCompany: m.trackingCompanies[0] ?? null,
  } satisfies Partial<Prisma.OrderUncheckedCreateInput>;
  // Cookie values from the checkout pixel beat a click id rebuilt from the landing page
  const browser = {
    fbp: signal?.fbp ?? undefined,
    fbc: signal?.fbc ?? m.fbcFromClick ?? undefined,
    userAgent: signal?.userAgent ?? undefined,
    sourceUrl: signal?.pageUrl ?? undefined,
  };
  return { data, browser };
}

/** Writes a batch of mapped Shopify orders, merging any checkout pixel data already received. */
export async function upsertOrders(shopId: string, mapped: MappedOrder[]): Promise<string[]> {
  const real = mapped.filter((m) => !m.isTest);
  if (!real.length) return [];
  const signals = await db.checkoutSignal.findMany({
    where: { shopId, shopifyId: { in: real.map((m) => m.shopifyId) } },
  });
  const bySignal = new Map(signals.map((s) => [s.shopifyId, s]));
  const ids: string[] = [];
  // Small batches in one transaction keep round trips low on the pooled connection
  for (let i = 0; i < real.length; i += 25) {
    const chunk = real.slice(i, i + 25);
    const results = await db.$transaction(
      chunk.map((m) => {
        const { data, browser } = toRow(shopId, m, bySignal.get(m.shopifyId));
        const browserSet = Object.fromEntries(Object.entries(browser).filter(([, v]) => v !== undefined));
        return db.order.upsert({
          where: { shopId_shopifyId: { shopId, shopifyId: m.shopifyId } },
          create: { shopId, shopifyId: m.shopifyId, ...data, ...browserSet },
          update: { ...data, ...browserSet },
          select: { id: true },
        });
      }),
    );
    ids.push(...results.map((r) => r.id));
  }
  return ids;
}

/**
 * One slice of the 60 day backfill. Stops when the time budget runs out and keeps the
 * cursor on the Shop row, so the next cron tick or admin visit continues where it left off.
 */
export async function backfillOrders(shop: Shop, admin: AdminLike, budgetMs = 20_000) {
  if (shop.backfillDone) return { pages: 0, orders: 0, done: true };
  const started = Date.now();
  const since = shop.backfillSince ?? new Date(Date.now() - 60 * 86400000);
  const query = `created_at:>=${since.toISOString().slice(0, 10)}`;
  let cursor = shop.backfillCursor;
  let pages = 0;
  let orders = 0;
  let done = false;
  while (Date.now() - started < budgetMs) {
    const page = await fetchOrdersPage(admin, { after: cursor, query, first: 100 });
    const ids = await upsertOrders(shop.id, page.nodes.map(mapShopifyOrder));
    await recomputeOrders(shop.id, ids, { historical: true });
    orders += page.nodes.length;
    pages += 1;
    cursor = page.endCursor;
    if (!page.hasNextPage) {
      done = true;
      break;
    }
  }
  await db.shop.update({
    where: { id: shop.id },
    data: {
      backfillCursor: done ? null : cursor,
      backfillDone: done,
      lastOrderSyncAt: new Date(),
    },
  });
  return { pages, orders, done };
}

/** Safety net next to webhooks: pulls every order updated in the last few hours. */
export async function syncRecentOrders(shop: Shop, admin: AdminLike, hours = 3, budgetMs = 15_000) {
  const started = Date.now();
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  let cursor: string | null = null;
  let count = 0;
  while (Date.now() - started < budgetMs) {
    const page = await fetchOrdersPage(admin, { after: cursor, query: `updated_at:>=${since}`, first: 100 });
    const ids = await upsertOrders(shop.id, page.nodes.map(mapShopifyOrder));
    await recomputeOrders(shop.id, ids);
    count += page.nodes.length;
    if (!page.hasNextPage) break;
    cursor = page.endCursor;
  }
  await db.shop.update({ where: { id: shop.id }, data: { lastOrderSyncAt: new Date() } });
  return { orders: count };
}

/** Webhook path: refetch the order through GraphQL so every entry point maps orders the same way. */
export async function syncOneOrder(shopId: string, admin: AdminLike, gid: string) {
  const node = await fetchOrderById(admin, gid);
  if (!node) return null;
  const ids = await upsertOrders(shopId, [mapShopifyOrder(node)]);
  await recomputeOrders(shopId, ids);
  return ids[0] ?? null;
}
