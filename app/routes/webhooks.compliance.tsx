import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory privacy webhooks. The app stores no raw customer data: phone, email and names
// are kept only as SHA256 hashes, and the city. Redaction deletes the order rows themselves.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as any;

  // The library reports topics as CUSTOMERS_REDACT; normalise in case a raw customers/redact comes through
  switch (String(topic).toUpperCase().replace(/\//g, "_")) {
    case "CUSTOMERS_DATA_REQUEST":
      console.log(`[privacy] data request for ${shop}: only hashed identifiers are stored`);
      break;
    case "CUSTOMERS_REDACT": {
      const ids: string[] = (body?.orders_to_redact ?? []).map((id: number | string) => String(id));
      if (ids.length) {
        const orders = await db.order.findMany({ where: { shopId: shop, shopifyId: { in: ids } }, select: { id: true } });
        const orderIds = orders.map((o) => o.id);
        await db.$transaction([
          db.capiEvent.deleteMany({ where: { shopId: shop, orderId: { in: orderIds } } }),
          db.checkoutSignal.deleteMany({ where: { shopId: shop, shopifyId: { in: ids } } }),
          db.order.deleteMany({ where: { id: { in: orderIds } } }),
        ]);
      }
      break;
    }
    case "SHOP_REDACT":
      await db.shop.deleteMany({ where: { id: shop } });
      await db.session.deleteMany({ where: { shop } });
      break;
    default:
      break;
  }
  return new Response();
};
