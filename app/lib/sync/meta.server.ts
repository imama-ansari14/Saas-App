import type { Shop } from "@prisma/client";
import db from "../../db.server";
import { fetchAdInsights } from "../meta/insights.server";
import { addDays, dateKey } from "../metrics";
import { metaTokenFor } from "../shop.server";

/**
 * Pulls ad level spend and Meta reported purchases. First run takes 60 days; every run
 * after that re-pulls the last 3 days because Meta keeps restating recent numbers.
 */
export async function syncMetaInsights(shop: Shop, opts: { days?: number } = {}) {
  const token = metaTokenFor(shop);
  if (!token || !shop.metaAdAccountId) return { skipped: "Meta ad account or token not set" };
  const today = dateKey(new Date(), shop.timezone);
  const days = opts.days ?? (shop.metaBackfillDone ? 3 : 60);
  const since = addDays(today, -(days - 1));
  const rows = await fetchAdInsights({ adAccountId: shop.metaAdAccountId, token, since, until: today });

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db.$transaction(
      chunk.map((r) =>
        db.adDaily.upsert({
          where: { shopId_date_adId: { shopId: shop.id, date: r.date, adId: r.adId } },
          create: { shopId: shop.id, ...r },
          update: {
            campaignId: r.campaignId,
            campaignName: r.campaignName,
            adsetId: r.adsetId,
            adsetName: r.adsetName,
            adName: r.adName,
            spend: r.spend,
            purchases: r.purchases,
            purchaseValue: r.purchaseValue,
          },
        }),
      ),
    );
  }

  await db.shop.update({
    where: { id: shop.id },
    data: { lastMetaSyncAt: new Date(), metaBackfillDone: true },
  });
  return { rows: rows.length, since, until: today };
}
