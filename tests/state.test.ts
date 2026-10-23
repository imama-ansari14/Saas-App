import { describe, expect, it } from "vitest";
import { signState, verifyState } from "../app/lib/crypto.server";

describe("signed OAuth state", () => {
  it("round trips and rejects tampering or expiry", () => {
    process.env.SHOPIFY_API_SECRET = "state-test-secret";
    const s = signState({ shop: "a.myshopify.com" });
    expect(verifyState<{ shop: string }>(s)?.shop).toBe("a.myshopify.com");
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ shop: "b.myshopify.com", exp: 9999999999 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.x${sig.slice(1)}`)).toBeNull();
    expect(verifyState(signState({ shop: "a" }, -5))).toBeNull();
  });
});
