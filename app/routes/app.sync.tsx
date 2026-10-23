import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runShopJobs, type JobName } from "../lib/jobs.server";
import { backfillOrders } from "../lib/sync/orders.server";
import { ensureShop } from "../lib/shop.server";

export const config = { maxDuration: 120 };

// Admin triggered syncs: the first order import in slices, and "Sync now" buttons.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const job = String(form.get("job") ?? "");
  let shop = await db.shop.findUnique({ where: { id: session.shop } });
  if (!shop) shop = await ensureShop(session.shop, admin);

  try {
    if (job === "orders" && !shop.backfillDone) {
      const r = await backfillOrders(shop, admin, 20_000);
      return { done: r.done, orders: r.orders };
    }
    const force = job.split(",").filter((j) => ["orders", "couriers", "meta", "capi"].includes(j)) as JobName[];
    const result = await runShopJobs(shop, { force, budgetMs: 60_000 });
    if (result == null) return { ok: false, error: "A sync is already running for this store. Try again in a minute." };
    return { ok: true, done: true, result };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
};
