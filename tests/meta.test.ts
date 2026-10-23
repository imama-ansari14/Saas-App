import { describe, expect, it } from "vitest";
import { buildCapiEvent, type CapiOrder } from "../app/lib/meta/capi.server";
import { mapInsight, pickPurchase } from "../app/lib/meta/insights.server";
import { sha256 } from "../app/lib/hash.server";

const order: CapiOrder = {
  shopifyId: "5512345678901",
  name: "#1042",
  total: 4500,
  currency: "PKR",
  itemCount: 2,
  phoneHash: sha256("923001234567"),
  emailHash: null,
  fnHash: sha256("ali"),
  lnHash: null,
  externalIdHash: sha256("7712345"),
  city: "Karachi",
  countryCode: "pk",
  fbp: "fb.1.1729000000000.123456789",
  fbc: null,
  userAgent: "Mozilla/5.0",
  clientIp: "39.45.10.1",
  sourceUrl: "https://store.pk/checkouts/thank-you",
};
const now = new Date("2026-10-21T12:00:00Z");

describe("Conversions API event builder", () => {
  it("builds a deduplicated website event with hashed keys", () => {
    const r = buildCapiEvent({ eventName: "DeliveredOrder", eventTime: new Date("2026-10-20T08:00:00Z"), order, preferredSource: "website", storeUrl: "https://store.pk", now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.event.payload as any;
    expect(p.event_id).toBe("DeliveredOrder_5512345678901");
    expect(p.action_source).toBe("website");
    expect(p.event_time).toBe(Math.floor(new Date("2026-10-20T08:00:00Z").getTime() / 1000));
    expect(p.user_data.ph).toEqual([sha256("923001234567")]);
    expect(p.user_data.ct).toEqual([sha256("karachi")]);
    expect(p.user_data.country).toEqual([sha256("pk")]);
    expect(p.user_data.fbp).toBe(order.fbp);
    expect(p.user_data.client_ip_address).toBe("39.45.10.1");
    expect(p.custom_data).toMatchObject({ value: 4500, currency: "PKR", order_id: "#1042" });
    expect(p.event_source_url).toBe(order.sourceUrl);
  });
  it("refuses events older than 7 days", () => {
    const r = buildCapiEvent({ eventName: "DeliveredOrder", eventTime: new Date("2026-10-14T11:00:00Z"), order, preferredSource: "website", storeUrl: null, now });
    expect(r).toEqual({ ok: false, reason: "stale" });
  });
  it("falls back to system generated without a browser user agent", () => {
    const r = buildCapiEvent({ eventName: "ConfirmedOrder", eventTime: now, order: { ...order, userAgent: null }, preferredSource: "website", storeUrl: null, now });
    expect(r.ok && r.event.actionSource).toBe("system_generated");
    expect(r.ok && (r.event.payload as any).event_source_url).toBeUndefined();
  });
  it("sends ReturnedOrder without a value and clamps future times", () => {
    const r = buildCapiEvent({ eventName: "ReturnedOrder", eventTime: new Date("2026-10-22T00:00:00Z"), order, preferredSource: "system_generated", storeUrl: null, now });
    expect(r.ok && (r.event.payload as any).custom_data.value).toBeUndefined();
    expect(r.ok && (r.event.payload as any).event_time).toBe(Math.floor(now.getTime() / 1000));
  });
  it("skips orders with nothing to match on", () => {
    const bare = { ...order, phoneHash: null, externalIdHash: null, fbp: null };
    expect(buildCapiEvent({ eventName: "ConfirmedOrder", eventTime: now, order: bare, preferredSource: "website", storeUrl: null, now })).toEqual({ ok: false, reason: "no_match_keys" });
  });
});

describe("Meta insights mapping", () => {
  it("counts a purchase once even when several action types report it", () => {
    expect(
      pickPurchase([
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "7" },
        { action_type: "purchase", value: "7" },
        { action_type: "omni_purchase", value: "7" },
      ]),
    ).toBe(7);
  });
  it("maps an ad day", () => {
    const m = mapInsight({
      date_start: "2026-10-20",
      campaign_id: "1",
      campaign_name: "Sales",
      ad_id: "9",
      ad_name: "Hook",
      spend: "1500.25",
      actions: [{ action_type: "purchase", value: "3" }],
      action_values: [{ action_type: "purchase", value: "12600" }],
    });
    expect(m).toMatchObject({ date: "2026-10-20", campaignId: "1", adId: "9", spend: 1500.25, purchases: 3, purchaseValue: 12600 });
  });
});
