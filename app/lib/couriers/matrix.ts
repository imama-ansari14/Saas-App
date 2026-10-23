import { normalizeCourierStatus } from "../status";
import { parseLooseDate, toNumber, type CourierParcel } from "./types";

// Pure courier export reader shared by the server upload and the in browser audit.
// Columns are found by name, so merchants can upload the file exactly as the portal gives it.

const SYNONYMS = {
  tracking: [
    "trackingnumber", "trackingno", "tracking", "trackingid", "cn", "cnno", "cnnumber", "consignmentno",
    "consignmentnumber", "consignment", "awb", "awbno", "awbnumber", "trackno", "tracknumber", "bookingnumber",
    "cnnum", "shipmentno", "shipmentnumber", "parcelno",
  ],
  orderRef: [
    "orderref", "orderreference", "orderrefnumber", "orderrefno", "orderid", "ordernumber", "orderno", "reference",
    "referenceno", "referencenumber", "refno", "ref", "customerreference", "customerreferenceno", "shipperreference",
    "invoiceno", "invoicenumber", "bookedpacketorderid", "merchantorderid", "order",
  ],
  status: [
    "status", "currentstatus", "orderstatus", "shipmentstatus", "deliverystatus", "bookedpacketstatus",
    "laststatus", "transactionstatus", "parcelstatus", "cnstatus", "consignmentstatus",
  ],
  cod: [
    "cod", "codamount", "codvalue", "amount", "collectamount", "invoicepayment", "codamountpkr", "bookedpacketcollectamount",
    "collectableamount", "cashtocollect", "orderamount", "totalamount",
  ],
  city: ["city", "destination", "destinationcity", "consigneecity", "deliverycity", "destinationcityname", "tocity", "customercity"],
  date: [
    "statusdate", "lastupdated", "lastupdate", "updatedat", "deliverydate", "deliveredon", "returndate",
    "lastactivitydate", "activitydate", "date", "bookingdate", "bookeddate", "transactiondate",
  ],
} as const;

type Field = keyof typeof SYNONYMS;

export const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function detectColumns(headers: unknown[]): Partial<Record<Field, number>> {
  const normalized = headers.map(norm);
  const out: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    const list = SYNONYMS[field] as readonly string[];
    // Exact synonym first, in synonym priority order
    for (const syn of list) {
      const i = normalized.indexOf(syn);
      if (i >= 0 && !Object.values(out).includes(i)) {
        out[field] = i;
        break;
      }
    }
    if (out[field] == null) {
      // Then a header that contains a synonym, e.g. "Tracking Number (CN)"
      for (const syn of list) {
        if (syn.length < 4) continue;
        const i = normalized.findIndex((h, idx) => h.includes(syn) && !Object.values(out).includes(idx));
        if (i >= 0) {
          out[field] = i;
          break;
        }
      }
    }
  }
  return out;
}

export interface ParsedCourierFile {
  parcels: CourierParcel[];
  headers: string[];
  columns: Partial<Record<Field, string>>;
  rows: number;
  skipped: number;
  error?: string;
}

export function parseCourierMatrix(matrix: unknown[][], courier: string): ParsedCourierFile {
  // Portals often put a title or date range above the header row: find the real header
  let headerIdx = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const c = detectColumns(matrix[i] ?? []);
    if (c.tracking != null && (c.status != null || c.orderRef != null)) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      parcels: [],
      headers: (matrix[0] ?? []).map(String),
      columns: {},
      rows: Math.max(0, matrix.length - 1),
      skipped: 0,
      error:
        "Could not find a tracking number column and a status column. Check the file has headers like Tracking Number, Order Ref and Status.",
    };
  }
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? ""));
  const parcels: CourierParcel[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const row of matrix.slice(headerIdx + 1)) {
    const get = (f: Field) => (cols[f] != null ? row[cols[f]!] : null);
    const tracking = get("tracking");
    const trackingNumber = tracking == null ? "" : String(tracking).trim();
    if (!trackingNumber) {
      skipped += 1;
      continue;
    }
    if (seen.has(trackingNumber)) continue; // repeated rows for status history: keep the first (latest) one
    seen.add(trackingNumber);
    const rawStatus = get("status") == null ? null : String(get("status")).trim() || null;
    const ref = get("orderRef");
    parcels.push({
      courier,
      trackingNumber,
      orderRef: ref == null || ref === "" ? null : String(ref).trim(),
      rawStatus,
      status: normalizeCourierStatus(rawStatus),
      statusAt: parseLooseDate(get("date")),
      codAmount: toNumber(get("cod")),
      city: get("city") == null ? null : String(get("city")).trim() || null,
    });
  }
  const columns: Partial<Record<Field, string>> = {};
  for (const [k, v] of Object.entries(cols)) columns[k as Field] = headers[v as number];
  return { parcels, headers, columns, rows: matrix.length - headerIdx - 1, skipped };
}

