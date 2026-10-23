import { describe, expect, it } from "vitest";
import { parseCourierCsv } from "../app/lib/couriers/csv.server";
import { mapPostExParcel } from "../app/lib/couriers/postex.server";
import { mapLeopardsParcel } from "../app/lib/couriers/leopards.server";
import { parseLooseDate } from "../app/lib/couriers/types";

describe("courier CSV", () => {
  it("finds the header row below a title and maps columns by name", () => {
    const csv = [
      "TCS Shipment Report,,,,",
      "From 01-Oct-2026 To 20-Oct-2026,,,,",
      "CN Number,Customer Reference No,Consignee City,COD Amount,Current Status,Status Date",
      "779912345678,#1042,Karachi,\"4,500\",Delivered,18/10/2026 3:15 PM",
      "779912345679,1043,Quetta,3200,Returned to Shipper,19/10/2026",
      ",,,,,",
    ].join("\n");
    const r = parseCourierCsv(csv, "tcs");
    expect(r.error).toBeUndefined();
    expect(r.parcels).toHaveLength(2);
    expect(r.parcels[0]).toMatchObject({ trackingNumber: "779912345678", orderRef: "#1042", status: "DELIVERED", codAmount: 4500, city: "Karachi" });
    expect(r.parcels[0].statusAt?.toISOString()).toBe("2026-10-18T10:15:00.000Z");
    expect(r.parcels[1].status).toBe("RETURNED");
    expect(r.columns.status).toBe("Current Status");
  });
  it("explains a file without the needed columns", () => {
    const r = parseCourierCsv("a,b\n1,2", "other");
    expect(r.error).toMatch(/tracking number column/);
  });
});

describe("courier API mapping", () => {
  it("reads a PostEx tracking object", () => {
    const p = mapPostExParcel({
      trackingResponse: {
        trackingNumber: "21500012345",
        orderRefNumber: "1042",
        transactionStatus: "Delivered",
        invoicePayment: 4500,
        cityName: "Lahore",
        transactionStatusHistory: [
          { transactionStatusMessage: "Booked", modifiedDatetime: "2026-10-14 11:00:00" },
          { transactionStatusMessage: "Delivered", modifiedDatetime: "2026-10-17 16:30:00" },
        ],
      },
    });
    expect(p).toMatchObject({ courier: "postex", trackingNumber: "21500012345", orderRef: "1042", status: "DELIVERED", codAmount: 4500 });
    expect(p?.statusAt?.toISOString()).toBe("2026-10-17T11:30:00.000Z");
  });
  it("reads a Leopards packet", () => {
    const p = mapLeopardsParcel({
      track_number: "KI7512345678",
      booked_packet_status: "Being Return",
      booked_packet_order_id: "#1043",
      booked_packet_collect_amount: "3200",
      destination_city_name: "Quetta",
      "Tracking Detail": [{ Status: "Being Return", Activity_Date: "2026-10-19", Activity_Time: "09:10:00" }],
    });
    expect(p).toMatchObject({ courier: "leopards", status: "RETURN_IN_TRANSIT", orderRef: "#1043", codAmount: 3200 });
  });
  it("parses the date shapes couriers use", () => {
    expect(parseLooseDate("2026-10-18 15:15:00")?.toISOString()).toBe("2026-10-18T10:15:00.000Z");
    expect(parseLooseDate("18-Oct-2026")?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(parseLooseDate("2026-10-18T10:00:00Z")?.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(parseLooseDate("not a date")).toBeNull();
  });
});
