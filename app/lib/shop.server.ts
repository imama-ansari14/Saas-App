import type { Shop } from "@prisma/client";
import db from "../db.server";
import { decrypt } from "./crypto.server";
import { SHOP_QUERY } from "./shopify/orders.server";

type AdminLike = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

/** Creates or refreshes the Shop row from Shopify's own shop settings. */
export async function ensureShop(shopDomain: string, admin?: AdminLike): Promise<Shop> {
  let info: any = null;
  if (admin) {
    try {
      const res = await admin.graphql(SHOP_QUERY);
      info = (await res.json())?.data?.shop ?? null;
    } catch {
      info = null;
    }
  }
  const data = {
    name: info?.name ?? undefined,
    currency: info?.currencyCode ?? undefined,
    timezone: info?.ianaTimezone ?? undefined,
    primaryDomain: info?.primaryDomain?.url ?? undefined,
  };
  return db.shop.upsert({
    where: { id: shopDomain },
    create: { id: shopDomain, ...data, backfillSince: new Date(Date.now() - 60 * 86400000) },
    update: { ...data, uninstalledAt: null },
  });
}

export async function getShop(shopDomain: string) {
  return db.shop.findUnique({ where: { id: shopDomain } });
}

export function storeUrl(shop: Pick<Shop, "id" | "primaryDomain">): string {
  return (shop.primaryDomain || `https://${shop.id}`).replace(/\/$/, "");
}

/** The shop's own token if one was saved, otherwise the agency system user token. */
export function metaTokenFor(shop: Pick<Shop, "metaTokenEnc">): string | null {
  return decrypt(shop.metaTokenEnc) || process.env.META_SYSTEM_USER_TOKEN || null;
}

/** A pixel token if one was saved, else the store's Meta login token, else the agency token. */
export function capiTokenFor(shop: Pick<Shop, "capiTokenEnc" | "metaTokenEnc">): string | null {
  return decrypt(shop.capiTokenEnc) || decrypt(shop.metaTokenEnc) || process.env.META_SYSTEM_USER_TOKEN || null;
}
