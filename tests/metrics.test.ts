import { describe, expect, it } from "vitest";
import { computeReport, resolveRange } from "../app/lib/metrics";
import { buildDemoData } from "../app/lib/demo";
import { buildInsights } from "../app/components/insights";
import type { ReportAdDay, ReportOrder } from "../app/lib/types";

const ad = (date: string, campaignId: string, adId: string, spend: number, value: number): ReportAdDay => ({
  date,
  campaignId,
  campaignName: `Campaign ${campaignId}`,
  adId,
  adName: `Ad ${adId}`,
  spend,
  purchases: Math.round(value / 1000),
  purchaseValue: value,
});
let n = 0;
const order = (o: Partial<ReportOrder>): ReportOrder => ({
  id: `o${++n}`,
  name: `#${n}`,
  date: "2026-10-10",
  total: 1000,
  isCod: true,
  status: "DELIVERED",
  city: "karachi",
  cityLabel: "Karachi",
  utmSource: "facebook",
  utmMedium: "paid",
  utmCampaign: "C1",
  utmContent: "A1",
  hasFbclid: false,
  ...o,
});

describe("computeReport", () => {
  const ads = [ad("2026-10-10", "C1", "A1", 1000, 4000), ad("2026-10-10", "C1", "A2", 1000, 2000), ad("2026-10-10", "C2", "B1", 500, 1500)];
  const orders = [
    order({}),
    order({ total: 2000 }),
    order({ status: "RETURNED" }),
    order({ status: "IN_TRANSIT", total: 3000 }),
    order({ utmContent: "A2" }),
    order({ utmCampaign: "C2", utmContent: "B1", status: "RETURNED" }),
    order({ utmCampaign: "Campaign C2", utmContent: null }), // campaign name instead of id
    order({ utmCampaign: null, utmContent: null, utmSource: "ig" }), // unattributed Meta
    order({ utmCampaign: null, utmContent: null, utmSource: "google", status: "DELIVERED", total: 5000 }), // other channel
    order({ date: "2026-09-01" }), // outside range
  ];
  const r = computeReport(orders, ads, { since: "2026-10-01", until: "2026-10-15" });

  it("attributes by campaign id, campaign name and ad id", () => {
    const c1 = r.campaigns.find((c) => c.id === "C1")!;
    const c2 = r.campaigns.find((c) => c.id === "C2")!;
    expect(c1.orders).toBe(5);
    expect(c1.delivered).toBe(3);
    expect(c1.deliveredRevenue).toBe(4000);
    expect(c1.spend).toBe(2000);
    expect(c1.metaRoas).toBe(3);
    expect(c1.deliveredRoas).toBe(2);
    expect(c1.rtoPct).toBeCloseTo(1 / 4);
    expect(c1.children!.find((a) => a.id === "A2")!.delivered).toBe(1);
    expect(c2.orders).toBe(2);
    expect(c2.returned).toBe(1);
  });
  it("keeps unattributed and other channel orders out of campaigns", () => {
    expect(r.unattributed.orders).toBe(1);
    expect(r.other.orders).toBe(1);
    expect(r.store.orders).toBe(9);
    expect(r.totals.orders).toBe(8);
    expect(r.totals.spend).toBe(2500);
    expect(r.totals.deliveredRevenue).toBe(1000 + 2000 + 1000 + 1000 + 1000);
  });
  it("projects in transit parcels at the delivery rate", () => {
    const c1 = r.campaigns.find((c) => c.id === "C1")!;
    // account rate 5 delivered of 7 final, C1 has under 20 finals so it uses the account rate
    const rate = r.deliveryRate!;
    expect(rate).toBeCloseTo(5 / 7);
    expect(c1.expectedRoas).toBeCloseTo((4000 + 3000 * rate) / 2000);
  });
  it("overstatement compares Meta and delivered", () => {
    expect(r.totals.overstatement).toBeCloseTo(r.totals.metaRoas! / r.totals.deliveredRoas!);
  });
});

describe("ranges and the demo", () => {
  it("resolves presets", () => {
    expect(resolveRange("7d", "2026-10-21")).toMatchObject({ since: "2026-10-15", until: "2026-10-21" });
    expect(resolveRange("settled", "2026-10-21")).toMatchObject({ since: "2026-09-11", until: "2026-10-11" });
    expect(resolveRange("nonsense", "2026-10-21").preset).toBe("30d");
  });
  it("demo data tells the story the pitch needs", () => {
    const d = buildDemoData("2026-10-21");
    const { since, until } = resolveRange("settled", "2026-10-21");
    const r = computeReport(d.orders, d.ads, { since, until });
    expect(r.totals.overstatement!).toBeGreaterThan(1.2);
    const asc = r.campaigns.find((c) => c.name.includes("ASC"))!;
    const khussa = r.campaigns.find((c) => c.name.includes("Khussa"))!;
    expect(asc.metaRoas!).toBeGreaterThan(khussa.metaRoas!);
    expect(khussa.deliveredRoas!).toBeGreaterThan(asc.deliveredRoas!);
    const labels = buildInsights(r).map((i) => i.label);
    expect(labels).toContain("Meta overstates");
    expect(labels).toContain("Hidden winner");
    expect(labels).toContain("Cities to restrict");
    // totals equal the sum of campaigns plus unattributed
    const sum = r.campaigns.reduce((s, c) => s + c.orders, 0) + r.unattributed.orders;
    expect(sum).toBe(r.totals.orders);
  });
});
