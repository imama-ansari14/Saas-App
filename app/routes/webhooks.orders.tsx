import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncOneOrder } from "../lib/sync/orders.server";

// orders/create, orders/updated and orders/cancelled all land here. The payload is only
// used for the order id; the order is re-read through GraphQL so every path maps it the same way.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response(); // app uninstalled, nothing to do

  const shopRow = await db.shop.findUnique({ where: { id: shop } });
  if (!shopRow || shopRow.uninstalledAt) return new Response();

  const gid = (payload as any)?.admin_graphql_api_id ?? ((payload as any)?.id ? `gid://shopify/Order/${(payload as any).id}` : null);
  if (!gid) return new Response();

  try {
    await syncOneOrder(shop, admin, gid);
  } catch (e) {
    console.error(`[webhook ${topic}] ${shop} ${gid}`, e);
    // 500 makes Shopify retry later, which is what we want for a transient failure
    return new Response("retry", { status: 500 });
  }
  return new Response();
};
