import { normalizeCity } from "../city";
import { hashEmail, hashExternalId, hashName, hashPhone } from "../hash.server";

// Shopify order fields the app reads. Two variants: FULL needs protected customer data
// access (phone, email, name, address); LITE works without it, so a store can still see
// delivered ROAS while that approval is pending.

const JOURNEY = `
  customerJourneySummary {
    ready
    lastVisit { occurredAt landingPage utmParameters { source medium campaign content term } }
    firstVisit { occurredAt landingPage utmParameters { source medium campaign content term } }
  }`;

const BASE_FIELDS = `
  id
  legacyResourceId
  name
  number
  createdAt
  cancelledAt
  test
  displayFinancialStatus
  paymentGatewayNames
  tags
  subtotalLineItemsQuantity
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { id }
  fulfillments(first: 10) { trackingInfo(first: 5) { number company } }
  ${JOURNEY}`;

const PII_FIELDS = `
  email
  phone
  clientIp
  shippingAddress { city province countryCodeV2 phone firstName lastName }
  billingAddress { city countryCodeV2 phone firstName lastName }`;

export const ORDER_FIELDS_FULL = `${BASE_FIELDS}${PII_FIELDS}`;
export const ORDER_FIELDS_LITE = `${BASE_FIELDS}
  shippingAddress { city province countryCodeV2 }`;

export function ordersQuery(full: boolean) {
  return `#graphql
  query DeliveredRoasOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${full ? ORDER_FIELDS_FULL : ORDER_FIELDS_LITE} }
    }
  }`;
}

export function orderByIdQuery(full: boolean) {
  return `#graphql
  query DeliveredRoasOrder($id: ID!) {
    order(id: $id) { ${full ? ORDER_FIELDS_FULL : ORDER_FIELDS_LITE} }
  }`;
}

export interface MappedOrder {
  shopifyId: string;
  name: string;
  orderNumber: number | null;
  createdAt: Date;
  total: number;
  currency: string;
  isCod: boolean;
  financialStatus: string | null;
  cancelledAt: Date | null;
  tags: string[];
  city: string | null;
  cityLabel: string | null;
  countryCode: string | null;
  itemCount: number;
  phoneHash: string | null;
  emailHash: string | null;
  fnHash: string | null;
  lnHash: string | null;
  externalIdHash: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingPage: string | null;
  fbclid: string | null;
  fbcFromClick: string | null;
  clientIp: string | null;
  trackingNumbers: string[];
  trackingCompanies: string[];
  isTest: boolean;
}

const COD_RE = /cash on delivery|\bcod\b|cash/i;

function gidTail(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

function readParams(url: string | null | undefined): URLSearchParams | null {
  if (!url) return null;
  try {
    return new URL(url, "https://store.invalid").searchParams;
  } catch {
    return null;
  }
}

function clickTime(visit: any, fallback: Date): number {
  const t = visit?.occurredAt ? new Date(visit.occurredAt).getTime() : NaN;
  return Number.isFinite(t) ? t : fallback.getTime();
}

/** Pure mapper from a GraphQL order node to what the database stores. */
export function mapShopifyOrder(node: any): MappedOrder {
  const shopifyId = String(node.legacyResourceId ?? gidTail(node.id));
  const money = node.currentTotalPriceSet?.shopMoney ?? node.totalPriceSet?.shopMoney ?? {};
  const ship = node.shippingAddress ?? {};
  const bill = node.billingAddress ?? {};

  const last = node.customerJourneySummary?.lastVisit ?? null;
  const first = node.customerJourneySummary?.firstVisit ?? null;
  const visit = last?.utmParameters ? last : first?.utmParameters ? first : last ?? first;
  const utm = visit?.utmParameters ?? {};
  const landing: string | null = visit?.landingPage ?? last?.landingPage ?? first?.landingPage ?? null;
  const qs = readParams(landing);
  const fbclid = qs?.get("fbclid") ?? readParams(first?.landingPage)?.get("fbclid") ?? null;

  const pick = (k: string, fromUtm: unknown) => {
    const v = (fromUtm as string | null | undefined) ?? qs?.get(`utm_${k}`) ?? null;
    return v ? String(v).trim() || null : null;
  };

  const cityRaw: string | null = ship.city ?? bill.city ?? null;
  const tracking: string[] = [];
  const companies: string[] = [];
  for (const f of node.fulfillments ?? []) {
    for (const t of f?.trackingInfo ?? []) {
      if (t?.number) tracking.push(String(t.number).trim());
      if (t?.company) companies.push(String(t.company));
    }
  }
  const createdAt = new Date(node.createdAt);

  return {
    shopifyId,
    name: String(node.name),
    orderNumber: Number(node.number) || Number(String(node.name).replace(/\D/g, "")) || null,
    createdAt,
    total: Number(money.amount ?? 0),
    currency: String(money.currencyCode ?? "PKR"),
    isCod: (node.paymentGatewayNames ?? []).some((g: string) => COD_RE.test(g)) || !(node.paymentGatewayNames ?? []).length,
    financialStatus: node.displayFinancialStatus ?? null,
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    tags: (node.tags ?? []).map((t: string) => String(t)),
    city: normalizeCity(cityRaw),
    cityLabel: cityRaw ? String(cityRaw).trim() : null,
    countryCode: (ship.countryCodeV2 ?? bill.countryCodeV2 ?? "PK").toLowerCase(),
    itemCount: Number(node.subtotalLineItemsQuantity ?? 1) || 1,
    phoneHash: hashPhone(node.phone ?? ship.phone ?? bill.phone),
    emailHash: hashEmail(node.email),
    fnHash: hashName(ship.firstName ?? bill.firstName),
    lnHash: hashName(ship.lastName ?? bill.lastName),
    externalIdHash: hashExternalId(gidTail(node.customer?.id)),
    utmSource: pick("source", utm.source),
    utmMedium: pick("medium", utm.medium),
    utmCampaign: pick("campaign", utm.campaign),
    utmContent: pick("content", utm.content),
    utmTerm: pick("term", utm.term),
    landingPage: landing ? landing.slice(0, 1000) : null,
    fbclid,
    fbcFromClick: fbclid ? `fb.1.${clickTime(visit, createdAt)}.${fbclid}` : null,
    clientIp: node.clientIp ? String(node.clientIp) : null,
    trackingNumbers: [...new Set(tracking)],
    trackingCompanies: [...new Set(companies)],
    isTest: Boolean(node.test),
  };
}

export function hasConfirmTag(tags: string[], confirmTags: string): boolean {
  const wanted = confirmTags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return false;
  return tags.some((t) => wanted.includes(t.trim().toLowerCase()));
}

type AdminLike = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

function isAccessError(json: any): boolean {
  const msg = JSON.stringify(json?.errors ?? "").toLowerCase();
  return msg.includes("access denied") || msg.includes("not approved") || msg.includes("protected customer data") || msg.includes("access_denied");
}

async function run(admin: AdminLike, query: string, variables: Record<string, unknown>) {
  const res = await admin.graphql(query, { variables });
  const json: any = await res.json();
  return json;
}

/** Tries the full field set first and falls back to LITE when customer data access is not approved yet. */
export async function fetchOrdersPage(
  admin: AdminLike,
  args: { after?: string | null; query?: string; first?: number; preferFull?: boolean },
) {
  const variables = { first: args.first ?? 100, after: args.after ?? null, query: args.query ?? null };
  let full = args.preferFull !== false;
  let json = await run(admin, ordersQuery(full), variables);
  if (json?.errors && full && isAccessError(json)) {
    full = false;
    json = await run(admin, ordersQuery(false), variables);
  }
  if (json?.errors) throw new Error(`Shopify orders query failed: ${JSON.stringify(json.errors).slice(0, 500)}`);
  const conn = json?.data?.orders;
  return {
    nodes: (conn?.nodes ?? []) as any[],
    hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
    endCursor: (conn?.pageInfo?.endCursor ?? null) as string | null,
    full,
  };
}

export async function fetchOrderById(admin: AdminLike, gid: string) {
  let json = await run(admin, orderByIdQuery(true), { id: gid });
  if (json?.errors && isAccessError(json)) json = await run(admin, orderByIdQuery(false), { id: gid });
  if (json?.errors) throw new Error(`Shopify order query failed: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json?.data?.order ?? null;
}

export const SHOP_QUERY = `#graphql
  query DeliveredRoasShop {
    shop { name currencyCode ianaTimezone myshopifyDomain primaryDomain { url host } }
  }`;
