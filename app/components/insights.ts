import { money, pct, roas } from "./format";
import type { Report, ReportRow } from "../lib/types";

export interface Insight {
  tone: "bad" | "good" | "warn" | "info";
  label: string;
  text: string;
}

/**
 * Plain language findings a brand owner can act on today. Each one only fires when the
 * data has enough volume behind it, so a quiet store gets fewer, not weaker, findings.
 */
export function buildInsights(r: Report): Insight[] {
  const out: Insight[] = [];
  const t = r.totals;
  const cur = r.currency;
  const minSpend = t.spend * 0.05;
  const finals = (x: ReportRow) => x.delivered + x.returned;

  if (t.overstatement != null && t.overstatement > 1.05) {
    out.push({
      tone: "bad",
      label: "Meta overstates",
      text: `Meta reports ${roas(t.metaRoas)} ROAS. Counting only parcels that were delivered and paid, the account makes ${roas(t.deliveredRoas)}, so Meta shows ${pct(t.overstatement - 1)} more than reality.`,
    });
  }

  // Wasted spend: the share of each campaign's spend that bought orders that came back
  const wasted = r.campaigns.reduce((s, c) => (c.orders > 0 ? s + c.spend * (c.returned / c.orders) : s), 0);
  if (wasted > 0 && t.spend > 0) {
    out.push({
      tone: "warn",
      label: "Spend on returns",
      text: `About ${money(wasted, cur, true)} of ad spend in this period bought orders that came back as RTO, before courier return charges.`,
    });
  }

  // Ad that Meta loves and customers refuse
  const ads = r.campaigns.flatMap((c) => (c.children ?? []).map((a) => ({ ...a, parent: c.name })));
  const misleading = ads
    .filter((a) => a.spend >= minSpend * 0.5 && finals(a) >= 15 && a.metaRoas != null && a.deliveredRoas != null)
    .map((a) => ({ a, gap: (a.metaRoas ?? 0) - (a.deliveredRoas ?? 0) }))
    .sort((x, y) => y.gap - x.gap)[0];
  if (misleading && misleading.gap > 0.8) {
    const a = misleading.a;
    out.push({
      tone: "bad",
      label: "Misleading ad",
      text: `"${a.name}" shows ${roas(a.metaRoas)} in Ads Manager but delivers ${roas(a.deliveredRoas)} with ${pct(a.rtoPct)} RTO. Cut it or move it to advance payment.`,
    });
  }

  // Campaign that Meta under ranks
  const ranked = r.campaigns.filter((c) => c.spend >= minSpend && finals(c) >= 20 && c.deliveredRoas != null);
  if (ranked.length >= 3) {
    const byMeta = [...ranked].sort((a, b) => (b.metaRoas ?? 0) - (a.metaRoas ?? 0));
    const byDelivered = [...ranked].sort((a, b) => (b.deliveredRoas ?? 0) - (a.deliveredRoas ?? 0));
    const hidden = byDelivered.find((c, i) => byMeta.indexOf(c) - i >= 1 && c.level === "campaign");
    if (hidden) {
      out.push({
        tone: "good",
        label: "Hidden winner",
        text: `"${hidden.name}" ranks #${byMeta.indexOf(hidden) + 1} by Meta ROAS but #${byDelivered.indexOf(hidden) + 1} on delivered ROAS (${roas(hidden.deliveredRoas)}, ${pct(hidden.rtoPct)} RTO). It deserves more budget.`,
      });
    }
  }

  const avg = t.rtoPct ?? null;
  const worst = r.cities
    .filter((c) => c.delivered + c.returned >= 20 && c.rtoPct != null)
    .sort((a, b) => (b.rtoPct ?? 0) - (a.rtoPct ?? 0))
    .slice(0, 3);
  if (worst.length && avg != null && (worst[0].rtoPct ?? 0) > avg * 1.4) {
    out.push({
      tone: "warn",
      label: "Cities to restrict",
      text: `${worst.map((c) => `${c.label} ${pct(c.rtoPct)}`).join(", ")} return far above the ${pct(avg)} average. Exclude them from prospecting or ask for advance payment there.`,
    });
  }

  if (r.unattributed.orders > 0 && t.orders > 0 && r.unattributed.orders / t.orders > 0.15) {
    out.push({
      tone: "info",
      label: "Tracking gap",
      text: `${pct(r.unattributed.orders / t.orders)} of Meta orders arrive without campaign ids. Add the UTM template to every ad so they can be credited.`,
    });
  }

  return out.slice(0, 5);
}
