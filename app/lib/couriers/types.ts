import type { ShipmentStatus } from "../types";

export interface CourierParcel {
  courier: string;
  trackingNumber: string;
  orderRef: string | null;
  rawStatus: string | null;
  status: ShipmentStatus;
  statusAt: Date | null;
  codAmount: number | null;
  city: string | null;
}

/**
 * Loose date parser for courier data. Accepts ISO, "2026-10-20 14:33:00", "20/10/2026 2:33 PM",
 * "20-Oct-2026" and Excel serial numbers. Times without a zone are read as Pakistan time.
 */
export function parseLooseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30)
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000) - 5 * 3600 * 1000);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return pkt(+m[1], +m[2], +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    let h = +(m[4] ?? 12);
    if (m[7]) h = (h % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
    return pkt(+m[3], +m[2], +m[1], h, +(m[5] ?? 0), +(m[6] ?? 0));
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    const mon = months.indexOf(m[2].toLowerCase()) + 1;
    if (mon > 0) {
      let h = +(m[4] ?? 12);
      if (m[7]) h = (h % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
      return pkt(+m[3], mon, +m[1], h, +(m[5] ?? 0), +(m[6] ?? 0));
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pkt(y: number, mo: number, d: number, h = 12, mi = 0, s = 0): Date | null {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi, s));
}

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
