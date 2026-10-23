import type { LoaderFunctionArgs } from "react-router";
import { activeShops, runShopJobs, type JobName } from "../lib/jobs.server";
import { safeEqual } from "../lib/crypto.server";

// Vercel Cron calls this every hour (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
// Any outside scheduler can call it the same way. ?shop=x.myshopify.com&force=couriers,meta runs one store now.

export const config = { maxDuration: 300 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const onlyShop = url.searchParams.get("shop");
  const force = (url.searchParams.get("force") ?? "").split(",").filter(Boolean) as JobName[];
  const deadline = Date.now() + 250_000;
  const results: Record<string, unknown> = {};

  for (const shop of await activeShops()) {
    if (onlyShop && shop.id !== onlyShop) continue;
    const left = deadline - Date.now();
    if (left < 20_000) {
      results[shop.id] = "skipped, out of time for this run";
      continue;
    }
    try {
      results[shop.id] = (await runShopJobs(shop, { force, budgetMs: Math.min(left - 10_000, 120_000) })) ?? "busy, another run holds the lock";
    } catch (e: any) {
      results[shop.id] = { error: String(e?.message ?? e) };
    }
  }
  return Response.json({ ok: true, at: new Date().toISOString(), results });
};
