import { describe, expect, it } from "vitest";
import { hasConfirmTag, mapShopifyOrder } from "../app/lib/shopify/orders.server";
import { sha256 } from "../app/lib/hash.server";

const node = {
  id: "gid://shopify/Order/5512345678901",
  legacyResourceId: "5512345678901",
  name: "#1042",
  number: 1042,
  createdAt: "2026-10-18T09:00:00Z",
  cancelledAt: null,
  test: false,
  displayFinancialStatus: "PENDING",
  paymentGatewayNames: ["Cash on Delivery (COD)"],
  tags: ["WhatsApp Confirmed"],
  subtotalLineItemsQuantity: 2,
  currentTotalPriceSet: { shopMoney: { amount: "4500.0", currencyCode: "PKR" } },
  totalPriceSet: { shopMoney: { amount: "4700.0", currencyCode: "PKR" } },
  customer: { id: "gid://shopify/Customer/7712345" },
  fulfillments: [{ trackingInfo: [{ number: "21500012345", company: "PostEx" }] }],
  customerJourneySummary: {
    ready: true,
    lastVisit: {
      occurredAt: "2026-10-18T08:40:00Z",
      landingPage: "https://store.pk/products/khussa?utm_source=facebook&utm_campaign=120231877305120090&fbclid=IwAR0abc",
      utmParameters: { source: "facebook", medium: "paid", campaign: "120231877305120090", content: "120231877305120101", term: null },
    },
    firstVisit: null,
  },
  email: "Ali@Example.com",
  phone: null,
  clientIp: "39.45.10.1",
  shippingAddress: { city: "Karachi Saddar", province: "Sindh", countryCodeV2: "PK", phone: "0300 1234567", firstName: "Ali", lastName: "Khan" },
  billingAddress: null,
};

describe("Shopify order mapping", () => {
  it("maps ids, money, COD and UTMs", () => {
    const m = mapShopifyOrder(node);
    expect(m).toMatchObject({
      shopifyId: "5512345678901",
      name: "#1042",
      orderNumber: 1042,
      total: 4500,
      isCod: true,
      city: "karachi",
      cityLabel: "Karachi Saddar",
      countryCode: "pk",
      utmSource: "facebook",
      utmCampaign: "120231877305120090",
      utmContent: "120231877305120101",
      fbclid: "IwAR0abc",
      trackingNumbers: ["21500012345"],
      trackingCompanies: ["PostEx"],
      clientIp: "39.45.10.1",
    });
    expect(m.fbcFromClick).toBe(`fb.1.${new Date("2026-10-18T08:40:00Z").getTime()}.IwAR0abc`);
    expect(m.phoneHash).toBe(sha256("923001234567"));
    expect(m.emailHash).toBe(sha256("ali@example.com"));
    expect(m.externalIdHash).toBe(sha256("7712345"));
  });
  it("reads UTMs from the landing page when Shopify has none parsed", () => {
    const m = mapShopifyOrder({
      ...node,
      customerJourneySummary: { lastVisit: { landingPage: "https://store.pk/?utm_source=ig&utm_campaign=Bridal&utm_content=Reel%201", utmParameters: null } },
    });
    expect(m).toMatchObject({ utmSource: "ig", utmCampaign: "Bridal", utmContent: "Reel 1" });
  });
  it("treats card gateways as prepaid", () => {
    expect(mapShopifyOrder({ ...node, paymentGatewayNames: ["PayFast"] }).isCod).toBe(false);
  });
  it("matches confirmation tags case insensitively", () => {
    expect(hasConfirmTag(["WhatsApp Confirmed"], "confirmed,whatsapp confirmed")).toBe(true);
    expect(hasConfirmTag(["pending"], "confirmed")).toBe(false);
  });
});
