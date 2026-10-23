// Courier exports reference Shopify orders in many shapes: "#1042", "1042", "MH1042",
// "Order 1042", "1042-1". These helpers turn both sides into comparable keys.

/** Digits that identify the order number inside a courier reference. */
export function refDigits(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const cleaned = String(ref).trim();
  if (!cleaned) return null;
  // Take the first run of digits; drop split shipment suffixes like 1042-1 or 1042/2
  const m = cleaned.match(/(\d{2,})/);
  if (!m) return null;
  return m[1].replace(/^0+(?=\d)/, "");
}

/** Lower case reference without spaces, #, or punctuation. */
export function refKey(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const k = String(ref).toLowerCase().replace(/[^a-z0-9]/g, "");
  return k || null;
}

export function trackingKey(t: string | null | undefined): string | null {
  if (!t) return null;
  const k = String(t).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k || null;
}

export interface MatchableOrder {
  id: string;
  name: string;
  orderNumber?: number | null;
  trackingNumbers?: string[] | null;
}

/**
 * Builds lookup maps once, then matches each courier row by tracking number first
 * (most reliable), then exact reference, then order number digits.
 */
export function buildOrderMatcher(orders: MatchableOrder[]) {
  const byTracking = new Map<string, string>();
  const byKey = new Map<string, string>();
  const byDigits = new Map<string, string | null>();

  for (const o of orders) {
    for (const t of o.trackingNumbers ?? []) {
      const tk = trackingKey(t);
      if (tk) byTracking.set(tk, o.id);
    }
    const k = refKey(o.name);
    if (k) byKey.set(k, o.id);
    const digits = new Set([o.orderNumber != null ? String(o.orderNumber) : null, refDigits(o.name)].filter(Boolean) as string[]);
    for (const d of digits) {
      // Two orders with the same digits (rare, e.g. after a store migration) make digits ambiguous
      byDigits.set(d, byDigits.has(d) && byDigits.get(d) !== o.id ? null : o.id);
    }
  }

  return function match(row: { trackingNumber?: string | null; orderRef?: string | null }): string | null {
    const tk = trackingKey(row.trackingNumber);
    if (tk && byTracking.has(tk)) return byTracking.get(tk)!;
    const k = refKey(row.orderRef);
    if (k && byKey.has(k)) return byKey.get(k)!;
    const d = refDigits(row.orderRef);
    if (d && byDigits.get(d)) return byDigits.get(d)!;
    return null;
  };
}
