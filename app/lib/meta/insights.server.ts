import { graphGet } from "./graph.server";

export interface InsightRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  adId: string;
  adName: string;
  spend: number;
  purchases: number;
  purchaseValue: number;
}

// Meta reports the same purchase under several action types. Take the first one present,
// in this order, so a purchase is never counted twice.
const PURCHASE_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "onsite_web_app_purchase",
];

type ActionStat = { action_type: string; value: string };

export function pickPurchase(list: ActionStat[] | undefined): number {
  if (!list?.length) return 0;
  for (const t of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function mapInsight(r: any): InsightRow | null {
  if (!r?.ad_id || !r?.campaign_id || !r?.date_start) return null;
  return {
    date: r.date_start,
    campaignId: String(r.campaign_id),
    campaignName: r.campaign_name ?? String(r.campaign_id),
    adsetId: r.adset_id ? String(r.adset_id) : null,
    adsetName: r.adset_name ?? null,
    adId: String(r.ad_id),
    adName: r.ad_name ?? String(r.ad_id),
    spend: Number(r.spend) || 0,
    purchases: pickPurchase(r.actions),
    purchaseValue: pickPurchase(r.action_values),
  };
}

/**
 * Ad level, one row per ad per day, using the ad account's own attribution setting
 * (no action_attribution_windows override), so numbers match Ads Manager.
 */
export async function fetchAdInsights(opts: {
  adAccountId: string;
  token: string;
  since: string;
  until: string;
  maxPages?: number;
}): Promise<InsightRow[]> {
  const account = opts.adAccountId.replace(/^act_/, "");
  const rows: InsightRow[] = [];
  let next: string | null = `act_${account}/insights`;
  let params: Record<string, string> = {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions,action_values",
    limit: "500",
  };
  let pages = 0;
  while (next && pages < (opts.maxPages ?? 40)) {
    const body: any = await graphGet(next, params, opts.token);
    for (const r of body?.data ?? []) {
      const m = mapInsight(r);
      if (m) rows.push(m);
    }
    next = body?.paging?.next ?? null;
    params = {}; // the next URL already carries every parameter
    pages += 1;
  }
  return rows;
}

export async function fetchAdAccount(adAccountId: string, token: string) {
  const account = adAccountId.replace(/^act_/, "");
  return graphGet<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }>(
    `act_${account}`,
    { fields: "id,name,currency,timezone_name,account_status" },
    token,
  );
}
