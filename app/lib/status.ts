import type { OrderStatus, ShipmentStatus } from "./types";

/**
 * Maps any courier status text (PostEx, Leopards, TCS, Trax, M&P, or a CSV export)
 * to one normalized parcel status. Order of the rules matters: return checks run
 * before delivery checks because many return labels also contain "deliver".
 */
export function normalizeCourierStatus(raw: string | null | undefined): ShipmentStatus {
  if (!raw) return "UNKNOWN";
  const s = raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "UNKNOWN";

  // Cancelled before dispatch
  if (/\b(cancel+ed|cancel+ation|cancel|void(ed)?|expired)\b/.test(s)) {
    return "CANCELLED";
  }

  // Final return states
  if (
    /\b(returned|rto|return(ed)? to (shipper|origin|sender|merchant|vendor)|return delivered|delivered to (shipper|origin|sender|merchant|vendor)|return received|returned received|rts)\b/.test(
      s,
    )
  ) {
    return "RETURNED";
  }

  // Return on the way back
  if (
    /\b(return(ing)?|being return(ed)?|ready for return|out for return|return in (process|progress|transit)|return requested|return request|refused|rejected|not accepted)\b/.test(
      s,
    )
  ) {
    return "RETURN_IN_TRANSIT";
  }

  // Delivered, while ruling out "undelivered", "not delivered", "delivery under review", "attempted"
  if (/\b(undelivered|not delivered|non delivered|delivery (failed|under review|attempt)|attempted)\b/.test(s)) {
    return "OUT_FOR_DELIVERY";
  }
  if (/\bdeliver(ed|y completed|y done)\b/.test(s) || s === "delivered" || s === "dlvd") {
    return "DELIVERED";
  }

  if (/\b(out for delivery|on route|enroute to customer|assigned to (rider|courier)|with rider|rider assigned)\b/.test(s)) {
    return "OUT_FOR_DELIVERY";
  }

  if (/\b(booked|unbooked|booking|pickup request|pick up request|ready for pickup|pending pickup|consignment booked|order placed|created)\b/.test(s)) {
    return "BOOKED";
  }

  if (
    /\b(transit|picked|pick up|pickup|dispatched|arrived|warehouse|hub|station|en route|enroute|shipped|received at|in process|processing|forwarded|manifest|sorting|departed|on hold|hold|under verification|verification)\b/.test(
      s,
    )
  ) {
    return "IN_TRANSIT";
  }

  return "UNKNOWN";
}

export interface ShipmentLike {
  status: ShipmentStatus | string;
  statusAt?: Date | string | null;
  courier?: string | null;
}

export interface DerivedStatus {
  status: OrderStatus;
  statusAt: Date | null;
  courier: string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One status per order from all its parcels.
 * Delivered wins over returned (exchanges), returned wins over moving parcels,
 * and an order with no parcels is either cancelled or still waiting to be booked.
 */
export function deriveOrderStatus(input: {
  cancelledAt?: Date | string | null;
  hasTracking?: boolean;
  shipments: ShipmentLike[];
}): DerivedStatus {
  const live = input.shipments.filter((s) => s.status !== "CANCELLED");
  const pick = (statuses: string[]) => {
    const hits = live.filter((s) => statuses.includes(s.status));
    if (!hits.length) return null;
    hits.sort((a, b) => (toDate(b.statusAt)?.getTime() ?? 0) - (toDate(a.statusAt)?.getTime() ?? 0));
    return hits[0];
  };

  const delivered = pick(["DELIVERED"]);
  if (delivered) {
    return { status: "DELIVERED", statusAt: toDate(delivered.statusAt), courier: delivered.courier ?? null };
  }
  const returned = pick(["RETURNED", "RETURN_IN_TRANSIT"]);
  if (returned) {
    return { status: "RETURNED", statusAt: toDate(returned.statusAt), courier: returned.courier ?? null };
  }
  const moving = pick(["BOOKED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "UNKNOWN"]);
  if (moving) {
    return { status: "IN_TRANSIT", statusAt: toDate(moving.statusAt), courier: moving.courier ?? null };
  }
  if (toDate(input.cancelledAt)) {
    return { status: "CANCELLED", statusAt: toDate(input.cancelledAt), courier: null };
  }
  if (input.hasTracking) {
    return { status: "IN_TRANSIT", statusAt: null, courier: null };
  }
  return { status: "NOT_DISPATCHED", statusAt: null, courier: null };
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  IN_TRANSIT: "In transit",
  NOT_DISPATCHED: "Not dispatched",
  CANCELLED: "Cancelled",
};
