import { describe, expect, it } from "vitest";
import { deriveOrderStatus, normalizeCourierStatus } from "../app/lib/status";

describe("normalizeCourierStatus", () => {
  const cases: [string, string][] = [
    // PostEx
    ["Delivered", "DELIVERED"],
    ["Returned", "RETURNED"],
    ["Out For Delivery", "OUT_FOR_DELIVERY"],
    ["Delivery Under Review", "OUT_FOR_DELIVERY"],
    ["Attempted", "OUT_FOR_DELIVERY"],
    ["PostEx WareHouse", "IN_TRANSIT"],
    ["Picked By PostEx", "IN_TRANSIT"],
    ["En-Route to PostEx warehouse", "IN_TRANSIT"],
    ["Unbooked", "BOOKED"],
    ["Booked", "BOOKED"],
    ["Out For Return", "RETURN_IN_TRANSIT"],
    ["Expired", "CANCELLED"],
    ["Cancelled", "CANCELLED"],
    // Leopards
    ["Pickup Request not Send", "BOOKED"],
    ["Consignment Booked", "BOOKED"],
    ["Dispatched", "IN_TRANSIT"],
    ["Arrived at Station", "IN_TRANSIT"],
    ["Assigned to Courier", "OUT_FOR_DELIVERY"],
    ["Being Return", "RETURN_IN_TRANSIT"],
    ["Ready for Return", "RETURN_IN_TRANSIT"],
    ["Returned to shipper", "RETURNED"],
    // TCS and Trax
    ["Return to Origin", "RETURNED"],
    ["Shipment - In Transit", "IN_TRANSIT"],
    ["Shipment - Arrived at Destination", "IN_TRANSIT"],
    ["Return in Progress", "RETURN_IN_TRANSIT"],
    ["Undelivered", "OUT_FOR_DELIVERY"],
    ["Refused by consignee", "RETURN_IN_TRANSIT"],
    ["DELIVERED TO SHIPPER", "RETURNED"],
    ["", "UNKNOWN"],
    ["Something new", "UNKNOWN"],
  ];
  it.each(cases)("%s maps to %s", (raw, expected) => {
    expect(normalizeCourierStatus(raw)).toBe(expected);
  });
});

describe("deriveOrderStatus", () => {
  it("delivered wins over a returned exchange parcel", () => {
    const r = deriveOrderStatus({
      shipments: [
        { status: "RETURNED", statusAt: "2026-10-10T10:00:00Z" },
        { status: "DELIVERED", statusAt: "2026-10-12T10:00:00Z", courier: "postex" },
      ],
    });
    expect(r.status).toBe("DELIVERED");
    expect(r.courier).toBe("postex");
  });
  it("a return on its way back already counts as returned", () => {
    expect(deriveOrderStatus({ shipments: [{ status: "RETURN_IN_TRANSIT" }] }).status).toBe("RETURNED");
  });
  it("cancelled parcels are ignored", () => {
    expect(deriveOrderStatus({ shipments: [{ status: "CANCELLED" }], cancelledAt: "2026-10-01" }).status).toBe("CANCELLED");
    expect(deriveOrderStatus({ shipments: [{ status: "CANCELLED" }] }).status).toBe("NOT_DISPATCHED");
  });
  it("tracking with no courier data reads as in transit", () => {
    expect(deriveOrderStatus({ shipments: [], hasTracking: true }).status).toBe("IN_TRANSIT");
  });
});
