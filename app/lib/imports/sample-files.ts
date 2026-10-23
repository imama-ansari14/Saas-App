import { buildDemoData } from "../demo";
import { addDays } from "../metrics";

// Example exports in the exact shapes Shopify, PostEx and Ads Manager produce, generated from the
// sample store. The audit's "Try example files" button feeds these through the real parsers.

function csv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

const STATUS_TEXT: Record<string, string[]> = {
  DELIVERED: ["Delivered"],
  RETURNED: ["Returned", "Return Delivered To Shipper"],
  IN_TRANSIT: ["Out For Delivery", "PostEx WareHouse", "En-Route to PostEx warehouse"],
};

export interface SampleFiles {
  shopify: string;
  courier: string;
  meta: string;
}

export function buildSampleFiles(today: string): SampleFiles {
  const d = buildDemoData(today, 45);

  const shop: (string | number | null)[][] = [
    ["Name", "Email", "Financial Status", "Fulfillment Status", "Currency", "Total", "Created at", "Lineitem quantity", "Lineitem name", "Shipping City", "Cancelled at", "Payment Method", "Tags", "Note Attributes"],
  ];
  const courier: (string | number | null)[][] = [
    ["PostEx Order Report", "", "", "", "", ""],
    ["Tracking Number", "Order Ref Number", "Customer City", "Invoice Payment", "Transaction Status", "Last Status Date"],
  ];
  let cn = 21500030000;
  for (const o of d.orders) {
    const created = `${o.date} ${String(10 + (Number(o.id.replace(/\D/g, "")) % 12)).padStart(2, "0")}:${String(Number(o.id.replace(/\D/g, "")) % 60).padStart(2, "0")}:00 +0500`;
    const notes = o.utmCampaign ? `utm_source: ${o.utmSource}\nutm_campaign: ${o.utmCampaign}\nutm_content: ${o.utmContent}` : o.utmSource ? `utm_source: ${o.utmSource}` : "";
    const fulfilled = o.status === "DELIVERED" || o.status === "RETURNED" || o.status === "IN_TRANSIT";
    shop.push([
      o.name,
      "",
      o.status === "DELIVERED" ? "paid" : o.status === "CANCELLED" ? "voided" : "pending",
      fulfilled ? "fulfilled" : "unfulfilled",
      "PKR",
      o.total.toFixed(2),
      created,
      1,
      "Handmade Khussa",
      o.cityLabel,
      o.status === "CANCELLED" ? created : "",
      o.isCod ? "Cash on Delivery (COD)" : "PayFast",
      "",
      notes,
    ]);
    // A second line item row, as Shopify writes it: same Name, no totals
    if (Number(o.id.replace(/\D/g, "")) % 4 === 0) {
      shop.push([o.name, "", "", "", "", "", "", 1, "Matching Clutch", "", "", "", "", ""]);
    }
    const texts = STATUS_TEXT[o.status];
    if (texts) {
      const n = Number(o.id.replace(/\D/g, ""));
      courier.push([
        String(cn++),
        o.name.replace("#", ""),
        o.cityLabel,
        o.total,
        texts[n % texts.length],
        `${addDays(o.date, 3 + (n % 4))} 15:${String(n % 60).padStart(2, "0")}:00`,
      ]);
    }
  }

  const meta: (string | number | null)[][] = [
    ["Reporting starts", "Reporting ends", "Campaign name", "Campaign ID", "Ad name", "Ad ID", "Day", "Amount spent (PKR)", "Purchases", "Purchases conversion value"],
  ];
  for (const a of d.ads) {
    meta.push([a.date, a.date, a.campaignName, a.campaignId, a.adName, a.adId, a.date, a.spend.toFixed(2), a.purchases, a.purchaseValue.toFixed(2)]);
  }

  return { shopify: csv(shop), courier: csv(courier), meta: csv(meta) };
}
