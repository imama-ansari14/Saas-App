import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { parseCourierMatrix } from "../app/lib/couriers/matrix";
import { auditReport, buildAudit } from "../app/lib/imports/audit";
import { parseMetaMatrix } from "../app/lib/imports/meta-export";
import { buildSampleFiles } from "../app/lib/imports/sample-files";
import { parseShopifyDate, parseShopifyMatrix } from "../app/lib/imports/shopify-csv";

const table = (text: string) => Papa.parse<string[]>(text, { skipEmptyLines: true }).data as unknown[][];

describe("Shopify orders export", () => {
  const exportCsv = [
    "Name,Email,Financial Status,Fulfillment Status,Total,Created at,Lineitem name,Shipping City,Cancelled at,Payment Method,Tags,Note Attributes",
    '#1042,a@x.pk,pending,fulfilled,4500.00,2026-10-18 14:22:10 +0500,Khussa,Karachi Saddar,,Cash on Delivery (COD),"VIP, confirmed","utm_source: facebook\nutm_campaign: 1202\nutm_content: 9901"',
    "#1042,,,,,,Clutch,,,,,",
    "#1043,b@x.pk,voided,unfulfilled,3200.00,2026-10-18 16:00:00 +0500,Khussa,Quetta,2026-10-19 10:00:00 +0500,Cash on Delivery (COD),,",
    "#1044,c@x.pk,paid,fulfilled,5100.00,2026-10-19 09:15:00 +0500,Bag,Lahore,,PayFast,,",
  ].join("\n");

  it("groups line items and reads totals, dates, cities and UTMs", () => {
    const r = parseShopifyMatrix(table(exportCsv));
    expect(r.error).toBeUndefined();
    expect(r.orders).toHaveLength(3);
    const o = r.orders[0];
    expect(o).toMatchObject({ name: "#1042", total: 4500, isCod: true, fulfilled: true, city: "karachi", utmCampaign: "1202", utmContent: "9901", utmSource: "facebook" });
    expect(o.createdAt.toISOString()).toBe("2026-10-18T09:22:10.000Z");
    expect(o.tags).toEqual(["VIP", "confirmed"]);
    expect(r.orders[1].cancelledAt).not.toBeNull();
    expect(r.orders[2].isCod).toBe(false);
    expect(r.utmShare).toBeCloseTo(1 / 3);
  });
  it("reads offsets", () => {
    expect(parseShopifyDate("2026-10-18 14:22:10 -0400")?.toISOString()).toBe("2026-10-18T18:22:10.000Z");
  });
  it("rejects other files", () => {
    expect(parseShopifyMatrix(table("a,b\n1,2")).error).toMatch(/Shopify orders export/);
  });
});

describe("Ads Manager export", () => {
  it("reads ad level daily rows and skips the summary row", () => {
    const csvText = [
      "Reporting starts,Reporting ends,Campaign name,Campaign ID,Ad name,Ad ID,Day,Amount spent (PKR),Purchases,Purchases conversion value",
      "2026-10-01,2026-10-20,,,,,,250000.50,80,320000",
      "2026-10-01,2026-10-20,Sales | ASC,1202,Hook A,9901,2026-10-18,\"4,500.25\",3,12600",
      "2026-10-01,2026-10-20,Sales | ASC,1202,Hook B,9902,2026-10-19,3000,1,4200",
    ].join("\n");
    const r = parseMetaMatrix(table(csvText));
    expect(r.error).toBeUndefined();
    expect(r.currency).toBe("PKR");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-10-18", campaignId: "1202", adId: "9901", spend: 4500.25, purchases: 3, purchaseValue: 12600 });
    expect(r).toMatchObject({ hasDays: true, level: "ad", from: "2026-10-18", to: "2026-10-19" });
    expect(r.warnings).toEqual([]);
  });
  it("accepts a campaign level export without days and warns about it", () => {
    const r = parseMetaMatrix(table("Campaign name,Amount spent (PKR),Results,Reporting starts\nSales,10000,4,2026-10-01"));
    expect(r.rows[0]).toMatchObject({ campaignId: "Sales", adName: "All ads", date: "2026-10-01" });
    expect(r.warnings.length).toBe(3);
  });
});

describe("audit join", () => {
  it("rebuilds the sample store from its three example exports", () => {
    const files = buildSampleFiles("2026-10-21");
    const shop = parseShopifyMatrix(table(files.shopify));
    const courier = parseCourierMatrix(table(files.courier), "postex");
    const meta = parseMetaMatrix(table(files.meta));
    expect(shop.error ?? courier.error ?? meta.error).toBeUndefined();
    expect(courier.columns.status).toBe("Transaction Status");

    const audit = buildAudit({ orders: shop.orders, parcels: courier.parcels, ads: meta.rows });
    expect(audit.campaignJoin).toBe(true);
    expect(audit.stats.parcelsMatched).toBe(courier.parcels.length);
    expect(audit.end).toBe("2026-10-21");

    const report = auditReport(audit, "settled");
    expect(report.campaigns.length).toBe(5);
    expect(report.totals.overstatement!).toBeGreaterThan(1.15);
    const asc = report.campaigns.find((c) => c.name.includes("ASC"))!;
    expect(asc.children!.length).toBe(3);
    expect(asc.rtoPct!).toBeGreaterThan(0.25);
  });
  it("falls back to account level when orders carry no UTMs", () => {
    const files = buildSampleFiles("2026-10-21");
    const shop = parseShopifyMatrix(table(files.shopify));
    for (const o of shop.orders) {
      o.utmCampaign = null;
      o.utmContent = null;
      o.utmSource = null;
    }
    const courier = parseCourierMatrix(table(files.courier), "postex");
    const meta = parseMetaMatrix(table(files.meta));
    const audit = buildAudit({ orders: shop.orders, parcels: courier.parcels, ads: meta.rows });
    expect(audit.campaignJoin).toBe(false);
    const report = auditReport(audit, "all");
    expect(report.campaignJoin).toBe(false);
    expect(report.unattributed.orders).toBe(shop.orders.length);
    expect(report.totals.deliveredRoas!).toBeGreaterThan(0);
  });
});
