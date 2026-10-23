import { describe, expect, it } from "vitest";
import { hashEmail, hashPhone, normalizeCityForMeta, normalizeName, normalizePhonePK, sha256 } from "../app/lib/hash.server";
import { normalizeCity } from "../app/lib/city";
import { buildOrderMatcher, refDigits } from "../app/lib/match";

describe("phone normalization", () => {
  it.each([
    ["0300 1234567", "923001234567"],
    ["+92 300 1234567", "923001234567"],
    ["92-300-1234567", "923001234567"],
    ["00923001234567", "923001234567"],
    ["3001234567", "923001234567"],
    ["+92 0300 1234567", "923001234567"],
  ])("%s", (raw, expected) => {
    expect(normalizePhonePK(raw)).toBe(expected);
  });
  it("hashes the normalized value", () => {
    expect(hashPhone("0300-1234567")).toBe(sha256("923001234567"));
    expect(hashEmail("  Ali@Example.COM ")).toBe(sha256("ali@example.com"));
  });
  it("normalizes names and cities for Meta", () => {
    expect(normalizeName(" Muhammad-Ali ")).toBe("muhammadali");
    expect(normalizeCityForMeta("Rahim Yar Khan")).toBe("rahimyarkhan");
  });
});

describe("city folding", () => {
  it.each([
    ["KHI", "karachi"],
    ["Karachi.", "karachi"],
    ["karachi saddar", "karachi"],
    ["Lahore Cantt", "lahore"],
    ["D.I. Khan", "dera ismail khan"],
    ["Rawalpindi Cantt", "rawalpindi"],
    ["Mian Channu", "mian channu"],
  ])("%s", (raw, expected) => {
    expect(normalizeCity(raw)).toBe(expected);
  });
});

describe("courier to order matching", () => {
  const match = buildOrderMatcher([
    { id: "a", name: "#1042", orderNumber: 1042, trackingNumbers: ["CX123456"] },
    { id: "b", name: "#1043", orderNumber: 1043, trackingNumbers: [] },
  ]);
  it("matches by tracking number first", () => {
    expect(match({ trackingNumber: "cx-123456", orderRef: "9999" })).toBe("a");
  });
  it("matches by reference in its many shapes", () => {
    expect(match({ orderRef: "#1043" })).toBe("b");
    expect(match({ orderRef: "1043" })).toBe("b");
    expect(match({ orderRef: "MH1043" })).toBe("b");
    expect(match({ orderRef: "1043-1" })).toBe("b");
    expect(match({ orderRef: "777" })).toBeNull();
  });
  it("extracts digits", () => {
    expect(refDigits("Order 001042")).toBe("1042");
  });
});
