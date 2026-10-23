import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyPixelKey } from "../lib/crypto.server";

// Receives browser ids from the checkout pixel (see extensions/delivered-roas-pixel).
// The pixel posts text/plain so the browser sends it without a CORS preflight.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const text = await request.text();
  if (text.length > 8000) return new Response(null, { status: 413, headers: CORS });

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: CORS });
  }

  const shop = clean(body?.shop, 120)?.toLowerCase() ?? "";
  if (!SHOP_RE.test(shop) || !verifyPixelKey(shop, clean(body?.key, 64))) {
    return new Response(null, { status: 403, headers: CORS });
  }
  const orderId = String(body?.orderId ?? "").match(/(\d+)(?:\?.*)?$/)?.[1];
  if (!orderId) return new Response(null, { status: 204, headers: CORS });

  const known = await db.shop.findUnique({ where: { id: shop }, select: { id: true } });
  if (!known) return new Response(null, { status: 204, headers: CORS });

  const data = {
    fbp: clean(body?.fbp, 200),
    fbc: clean(body?.fbc, 400),
    userAgent: clean(body?.userAgent, 500),
    pageUrl: clean(body?.pageUrl, 1000),
    clientId: clean(body?.clientId, 120),
  };
  await db.checkoutSignal.upsert({
    where: { shopId_shopifyId: { shopId: shop, shopifyId: orderId } },
    create: { shopId: shop, shopifyId: orderId, ...data },
    update: data,
  });
  // If the order webhook already arrived, copy the browser ids onto the order now
  await db.order.updateMany({
    where: { shopId: shop, shopifyId: orderId },
    data: {
      ...(data.fbp ? { fbp: data.fbp } : {}),
      ...(data.fbc ? { fbc: data.fbc } : {}),
      ...(data.userAgent ? { userAgent: data.userAgent } : {}),
      ...(data.pageUrl ? { sourceUrl: data.pageUrl } : {}),
    },
  });
  return new Response(null, { status: 204, headers: CORS });
};
