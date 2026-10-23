// End to end pipeline against a real Postgres (PGlite, in memory) using the shipped migration:
// orders in, pixel signals merged, courier statuses matched, Meta events queued and sent,
// spend imported, report computed. Network calls to Meta and PostEx are stubbed.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = 55432;
const SHOP = "pipeline-test.myshopify.com";
let pg: PGlite;
let server: PGLiteSocketServer;
let m: Record<string, any> = {};

const H = 3600_000;
const now = Date.now();

function node(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `gid://shopify/Order/90000${n}`,
    legacyResourceId: `90000${n}`,
    name: `#10${n}`,
    number: 100 + n,
    createdAt: new Date(now - 72 * H).toISOString(),
    cancelledAt: null,
    test: false,
    displayFinancialStatus: "PENDING",
    paymentGatewayNames: ["Cash on Delivery (COD)"],
    tags: [],
    subtotalLineItemsQuantity: 1,
    currentTotalPriceSet: { shopMoney: { amount: String(1000 * n), currencyCode: "PKR" } },
    customer: { id: `gid://shopify/Customer/${n}` },
    fulfillments: [],
    customerJourneySummary: {
      lastVisit: {
        occurredAt: new Date(now - 73 * H).toISOString(),
        landingPage: "https://store.pk/?fbclid=abc",
        utmParameters: { source: "facebook", medium: "paid", campaign: "C1", content: "A1", term: null },
      },
    },
    email: `buyer${n}@example.com`,
    phone: `0300123456${n}`,
    clientIp: "39.45.10.1",
    shippingAddress: { city: n === 2 ? "Quetta" : "Karachi", countryCodeV2: "PK", firstName: "Buyer", lastName: `No${n}` },
    ...extra,
  };
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(readFileSync("prisma/migrations/20261021000000_init/migration.sql", "utf8"));
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`,
    DATABASE_POOL_MAX: "1",
    ENCRYPTION_KEY: "test-encryption-key-0123456789",
    SHOPIFY_API_KEY: "test-key",
    SHOPIFY_API_SECRET: "test-secret",
    SHOPIFY_APP_URL: "https://delivered-roas.test",
    NODE_ENV: "test",
  });
  m = {
    db: (await import("../app/db.server")).default,
    crypto: await import("../app/lib/crypto.server"),
    orders: await import("../app/lib/sync/orders.server"),
    status: await import("../app/lib/sync/status.server"),
    couriers: await import("../app/lib/sync/couriers.server"),
    capi: await import("../app/lib/sync/capi.server"),
    meta: await import("../app/lib/sync/meta.server"),
    report: await import("../app/lib/report.server"),
    jobs: await import("../app/lib/jobs.server"),
    shopify: await import("../app/lib/shopify/orders.server"),
    metrics: await import("../app/lib/metrics"),
  };
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await m.db?.$disconnect();
  await server?.stop();
  await pg?.close();
});

describe("pipeline", () => {
  it("creates the store", async () => {
    const { db, crypto } = m;
    await db.shop.create({
      data: {
        id: SHOP,
        name: "Pipeline Test",
        metaAdAccountId: "123456",
        metaTokenEnc: crypto.encrypt("meta-token"),
        metaPixelId: "999000",
        capiTokenEnc: crypto.encrypt("capi-token"),
        capiEnabled: true,
        postexTokenEnc: crypto.encrypt("postex-token"),
        confirmTags: "confirmed",
      },
    });
    expect(crypto.decrypt((await db.shop.findUnique({ where: { id: SHOP } })).postexTokenEnc)).toBe("postex-token");
  });

  it("imports orders and merges the checkout pixel signal", async () => {
    const { db, orders, shopify } = m;
    await db.checkoutSignal.create({ data: { shopId: SHOP, shopifyId: "900001", fbp: "fb.1.1.111", userAgent: "Mozilla/5.0 Test" } });
    const mapped = [1, 2, 3, 4].map((n) => shopify.mapShopifyOrder(node(n, n === 4 ? { tags: ["Confirmed"] } : {})));
    const ids = await orders.upsertOrders(SHOP, mapped);
    expect(ids).toHaveLength(4);
    const o1 = await db.order.findFirst({ where: { shopId: SHOP, shopifyId: "900001" } });
    expect(o1.fbp).toBe("fb.1.1.111");
    expect(o1.userAgent).toBe("Mozilla/5.0 Test");
    expect(o1.fbc).toMatch(/^fb\.1\.\d+\.abc$/);
    expect(o1.phoneHash).toHaveLength(64);
    // upsert again changes nothing structural
    expect(await orders.upsertOrders(SHOP, mapped)).toHaveLength(4);
    expect(await db.order.count({ where: { shopId: SHOP } })).toBe(4);
  });

  it("queues ConfirmedOrder for a tagged order", async () => {
    const { db, status } = m;
    const all = await db.order.findMany({ where: { shopId: SHOP }, select: { id: true } });
    const r = await status.recomputeOrders(SHOP, all.map((o: any) => o.id));
    expect(r.queued).toBe(1);
    const ev = await db.capiEvent.findFirst({ where: { shopId: SHOP } });
    expect(ev).toMatchObject({ eventName: "ConfirmedOrder", eventId: "ConfirmedOrder_900004", status: "QUEUED" });
  });

  it("matches courier parcels and queues delivered and returned events once", async () => {
    const { db, couriers } = m;
    const parcels = [
      { courier: "postex", trackingNumber: "PX1", orderRef: "101", rawStatus: "Delivered", status: "DELIVERED", statusAt: new Date(now - 1 * H), codAmount: 1000, city: "Karachi" },
      { courier: "postex", trackingNumber: "PX2", orderRef: "#102", rawStatus: "Returned", status: "RETURNED", statusAt: new Date(now - 2 * H), codAmount: 2000, city: "Quetta" },
      { courier: "postex", trackingNumber: "PX3", orderRef: "MH103", rawStatus: "Out For Delivery", status: "OUT_FOR_DELIVERY", statusAt: new Date(now - 3 * H), codAmount: 3000, city: "Karachi" },
      { courier: "postex", trackingNumber: "PX9", orderRef: "555", rawStatus: "Delivered", status: "DELIVERED", statusAt: new Date(), codAmount: 10, city: null },
    ];
    const r = await couriers.ingestParcels(SHOP, parcels, "api");
    expect(r).toMatchObject({ total: 4, matched: 3, unmatched: 1, updated: 4 });
    // confirmed by booking for 1, 2, 3 plus delivered 1 and returned 2
    expect(r.eventsQueued).toBe(5);
    const byName = Object.fromEntries((await db.order.findMany({ where: { shopId: SHOP } })).map((o: any) => [o.name, o.status]));
    expect(byName).toMatchObject({ "#101": "DELIVERED", "#102": "RETURNED", "#103": "IN_TRANSIT", "#104": "NOT_DISPATCHED" });

    const again = await couriers.ingestParcels(SHOP, parcels, "api");
    expect(again).toMatchObject({ updated: 0, eventsQueued: 0 });
    expect(await db.capiEvent.count({ where: { shopId: SHOP } })).toBe(6);
  });

  it("pulls PostEx through the API client", async () => {
    const { couriers, db } = m;
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push(String(url));
      expect(init.headers.token).toBe("postex-token");
      return new Response(
        JSON.stringify({
          statusCode: "200",
          dist: [{ trackingResponse: { trackingNumber: "PX3", orderRefNumber: "103", transactionStatus: "Delivered", transactionStatusHistory: [{ transactionStatusMessage: "Delivered", modifiedDatetime: new Date(now - 0.5 * H).toISOString() }] } }],
        }),
        { status: 200 },
      );
    });
    const shop = await db.shop.findUnique({ where: { id: SHOP } });
    const r = await couriers.syncCouriers(shop, { days: 30 });
    expect(calls.length).toBe(2); // two 15 day windows
    expect(calls[0]).toContain("/order/v1/get-all-order?orderStatusId=0");
    expect((r.postex as any).ordersChanged).toBe(1);
    expect((await db.order.findFirst({ where: { shopId: SHOP, name: "#103" } })).status).toBe("DELIVERED");
    vi.unstubAllGlobals();
  });

  it("imports Meta spend", async () => {
    const { meta, db } = m;
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v26.0/act_123456/insights");
      expect(u.searchParams.get("access_token")).toBe("meta-token");
      const day = m.metrics.dateKey(new Date(now - 72 * H));
      return new Response(
        JSON.stringify({
          data: [
            { date_start: day, campaign_id: "C1", campaign_name: "Sales | Test", ad_id: "A1", ad_name: "Hook 1", spend: "4000", actions: [{ action_type: "purchase", value: "4" }], action_values: [{ action_type: "purchase", value: "10000" }] },
          ],
        }),
        { status: 200 },
      );
    });
    const r = await meta.syncMetaInsights(await db.shop.findUnique({ where: { id: SHOP } }));
    expect(r.rows).toBe(1);
    vi.unstubAllGlobals();
  });

  it("sends queued events to the pixel and marks them sent", async () => {
    const { capi, db } = m;
    const sentBodies: any[] = [];
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      expect(String(url)).toBe("https://graph.facebook.com/v26.0/999000/events");
      const body = JSON.parse(init.body);
      expect(body.access_token).toBe("capi-token");
      sentBodies.push(body);
      return new Response(JSON.stringify({ events_received: body.data.length, fbtrace_id: "trace" }), { status: 200 });
    });
    const r = await capi.sendQueuedEvents(await db.shop.findUnique({ where: { id: SHOP } }));
    expect(r).toMatchObject({ sent: 7, failed: 0 });
    const events = sentBodies.flatMap((b) => b.data);
    const delivered = events.find((e: any) => e.event_id === "DeliveredOrder_900001");
    expect(delivered.action_source).toBe("website");
    expect(delivered.user_data.fbp).toBe("fb.1.1.111");
    expect(delivered.user_data.client_user_agent).toBe("Mozilla/5.0 Test");
    const returned = events.find((e: any) => e.event_name === "ReturnedOrder");
    expect(returned.custom_data.value).toBeUndefined();
    // order 2 has no pixel signal, so it goes as system generated
    expect(returned.action_source).toBe("system_generated");
    expect(await db.capiEvent.count({ where: { shopId: SHOP, status: "SENT" } })).toBe(7);
    // a second run sends nothing
    expect(await capi.sendQueuedEvents(await db.shop.findUnique({ where: { id: SHOP } }))).toMatchObject({ sent: 0 });
    vi.unstubAllGlobals();
  });

  it("computes the report from the database", async () => {
    const { report, db, metrics } = m;
    const today = metrics.dateKey(new Date());
    const rep = await report.loadReport(await db.shop.findUnique({ where: { id: SHOP } }), metrics.addDays(today, -6), today);
    const c1 = rep.campaigns.find((c: any) => c.id === "C1");
    expect(c1).toMatchObject({ name: "Sales | Test", spend: 4000, orders: 4, delivered: 2, returned: 1, deliveredRevenue: 4000 });
    expect(c1.deliveredRoas).toBe(1);
    expect(c1.metaRoas).toBe(2.5);
    expect(rep.cities.find((c: any) => c.city === "quetta").rtoPct).toBe(1);
    const log = await report.loadCapiLog(SHOP);
    expect(log.rows.length).toBe(7);
    expect(log.counts["DeliveredOrder:SENT"]).toBe(2);
    const health = await report.loadSyncHealth(await db.shop.findUnique({ where: { id: SHOP } }));
    expect(health).toMatchObject({ orders: 4, shipments: 4, unmatched: 1, signals: 1, utmShare: 1 });
  });

  it("locks a store so overlapping runs skip", async () => {
    const { jobs } = m;
    let inner: unknown = "not run";
    const outer = await jobs.withLock("shop:test", 60_000, async () => {
      inner = await jobs.withLock("shop:test", 60_000, async () => "second");
      return "first";
    });
    expect(outer).toBe("first");
    expect(inner).toBeNull();
    expect(await jobs.withLock("shop:test", 60_000, async () => "after release")).toBe("after release");
  });

  it("redacts and cascades", async () => {
    const { db } = m;
    await db.shop.delete({ where: { id: SHOP } });
    expect(await db.order.count()).toBe(0);
    expect(await db.capiEvent.count()).toBe(0);
  });
});
