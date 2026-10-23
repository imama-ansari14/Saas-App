import { normalizeCity } from "../city";
import { norm } from "../couriers/matrix";
import { parseLooseDate, toNumber } from "../couriers/types";

// Reads Shopify's Orders export (Orders, Export, CSV for Excel or plain CSV). The export has one row
// per line item; only the first row of an order carries its totals, so rows are grouped by Name.
// UTMs are not in the standard export, but they are picked up when present as their own columns,
// inside Note Attributes (many tracking apps write them there), or in a landing page URL column.

export interface ImportedOrder {
  name: string;
  createdAt: Date;
  total: number;
  isCod: boolean;
  financialStatus: string | null;
  fulfilled: boolean;
  cancelledAt: Date | null;
  city: string | null;
  cityLabel: string | null;
  tags: string[];
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  hasFbclid: boolean;
}

export interface ParsedShopifyExport {
  orders: ImportedOrder[];
  columns: Record<string, string>;
  utmShare: number;
  from: Date | null;
  to: Date | null;
  error?: string;
}

const COLS = {
  name: ["name", "ordername", "order", "ordernumber"],
  createdAt: ["createdat", "created", "orderdate", "processedat", "date"],
  total: ["total", "totalprice", "ordertotal", "totalsales"],
  payment: ["paymentmethod", "paymentgateway", "gateway", "paymentgatewaynames"],
  financial: ["financialstatus", "paymentstatus"],
  fulfillment: ["fulfillmentstatus"],
  cancelledAt: ["cancelledat", "canceledat"],
  shipCity: ["shippingcity", "shipcity", "city"],
  billCity: ["billingcity"],
  tags: ["tags"],
  notes: ["noteattributes", "additionaldetails", "attributes"],
  utmSource: ["utmsource"],
  utmMedium: ["utmmedium"],
  utmCampaign: ["utmcampaign"],
  utmContent: ["utmcontent"],
  landing: ["landingsite", "landingpage", "landingpageurl", "landingsiteref"],
} as const;

type Col = keyof typeof COLS;

function locate(headers: unknown[]): Partial<Record<Col, number>> {
  const n = headers.map(norm);
  const out: Partial<Record<Col, number>> = {};
  for (const k of Object.keys(COLS) as Col[]) {
    for (const syn of COLS[k]) {
      const i = n.indexOf(syn);
      if (i >= 0) {
        out[k] = i;
        break;
      }
    }
  }
  return out;
}

/** "2026-10-18 14:22:10 +0500" and the other shapes Shopify and spreadsheets produce. */
export function parseShopifyDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*([+-])(\d{2}):?(\d{2})$/);
  if (m) {
    const sign = m[7] === "-" ? -1 : 1;
    const offsetMin = sign * (Number(m[8]) * 60 + Number(m[9]));
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - offsetMin * 60000);
  }
  return parseLooseDate(v);
}

function utmFromText(text: string, key: string): string | null {
  // Note Attributes look like "utm_campaign: 1202... \n utm_content: 1202..."
  const re = new RegExp(`${key}\\s*[:=]\\s*([^\\n\\r&;,]+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() || null : null;
}

function utmFromUrl(url: string, key: string): string | null {
  try {
    return new URL(url, "https://x.invalid").searchParams.get(key);
  } catch {
    return null;
  }
}

const COD_RE = /cash on delivery|\bcod\b|cash/i;

export function parseShopifyMatrix(matrix: unknown[][]): ParsedShopifyExport {
  let headerIdx = -1;
  let cols: Partial<Record<Col, number>> = {};
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const c = locate(matrix[i] ?? []);
    if (c.name != null && c.total != null && c.createdAt != null) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      orders: [],
      columns: {},
      utmShare: 0,
      from: null,
      to: null,
      error: "This does not look like a Shopify orders export. It needs the Name, Created at and Total columns.",
    };
  }
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? ""));
  const byName = new Map<string, ImportedOrder>();
  const get = (row: unknown[], c: Col) => (cols[c] != null ? row[cols[c]!] : null);
  const str = (v: unknown) => (v == null ? "" : String(v).trim());

  for (const row of matrix.slice(headerIdx + 1)) {
    const name = str(get(row, "name"));
    if (!name) continue;
    const existing = byName.get(name);
    const created = parseShopifyDate(get(row, "createdAt"));
    const totalRaw = str(get(row, "total"));
    // Continuation rows (extra line items) have no total or date: they only add nothing new
    if (existing || !created || totalRaw === "") {
      if (existing) {
        const note = str(get(row, "notes"));
        if (note && !existing.utmCampaign) existing.utmCampaign = utmFromText(note, "utm_campaign");
      }
      continue;
    }
    const notes = str(get(row, "notes"));
    const landing = str(get(row, "landing"));
    const pick = (col: Col, key: string) =>
      str(get(row, col)) || utmFromText(notes, key) || (landing ? utmFromUrl(landing, key) : null) || null;
    const cityRaw = str(get(row, "shipCity")) || str(get(row, "billCity")) || null;
    const payment = str(get(row, "payment"));
    byName.set(name, {
      name,
      createdAt: created,
      total: toNumber(totalRaw) ?? 0,
      isCod: payment ? COD_RE.test(payment) : true,
      financialStatus: str(get(row, "financial")) || null,
      fulfilled: /fulfilled|shipped|partial/i.test(str(get(row, "fulfillment"))) && !/unfulfilled/i.test(str(get(row, "fulfillment"))),
      cancelledAt: parseShopifyDate(get(row, "cancelledAt")),
      city: normalizeCity(cityRaw),
      cityLabel: cityRaw,
      tags: str(get(row, "tags"))
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      utmSource: pick("utmSource", "utm_source"),
      utmMedium: pick("utmMedium", "utm_medium"),
      utmCampaign: pick("utmCampaign", "utm_campaign"),
      utmContent: pick("utmContent", "utm_content"),
      hasFbclid: /fbclid=/i.test(landing) || /fbclid/i.test(notes),
    });
  }

  const orders = [...byName.values()];
  const withUtm = orders.filter((o) => o.utmCampaign).length;
  const times = orders.map((o) => o.createdAt.getTime());
  const columns: Record<string, string> = {};
  for (const [k, v] of Object.entries(cols)) columns[k] = headers[v as number];
  return {
    orders,
    columns,
    utmShare: orders.length ? withUtm / orders.length : 0,
    from: times.length ? new Date(Math.min(...times)) : null,
    to: times.length ? new Date(Math.max(...times)) : null,
    error: orders.length ? undefined : "The export has headers but no orders.",
  };
}
