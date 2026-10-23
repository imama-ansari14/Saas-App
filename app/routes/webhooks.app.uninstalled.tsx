import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can arrive more than once and after the app is gone, so every step is idempotent
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  await db.shop.updateMany({ where: { id: shop }, data: { uninstalledAt: new Date(), capiEnabled: false } });

  return new Response();
};
