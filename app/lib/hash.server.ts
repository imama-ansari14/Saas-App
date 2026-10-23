import { createHash } from "node:crypto";

// Normalization follows Meta's customer information parameter rules:
// trim, lower case, strip formatting, then SHA256 as lower case hex.

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Pakistani mobile numbers in international format without +: 923001234567 */
export function normalizePhonePK(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0092")) d = d.slice(2);
  if (d.startsWith("92") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 11) return `92${d.slice(1)}`;
  if (d.startsWith("3") && d.length === 10) return `92${d}`;
  if (d.startsWith("920") && d.length === 13) return `92${d.slice(3)}`; // +92 0300...
  // Not a PK mobile shape: keep the digits as typed (international customers)
  return d.length >= 8 ? d : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return n || null;
}

/** Meta wants city lower case with no spaces or punctuation: "rahimyarkhan" */
export function normalizeCityForMeta(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  return c || null;
}

export function hashOrNull(value: string | null | undefined): string | null {
  return value ? sha256(value) : null;
}

export const hashPhone = (raw: string | null | undefined) => hashOrNull(normalizePhonePK(raw));
export const hashEmail = (raw: string | null | undefined) => hashOrNull(normalizeEmail(raw));
export const hashName = (raw: string | null | undefined) => hashOrNull(normalizeName(raw));
export const hashCity = (raw: string | null | undefined) => hashOrNull(normalizeCityForMeta(raw));
export const hashCountry = (raw: string | null | undefined) =>
  hashOrNull(raw ? String(raw).trim().toLowerCase().slice(0, 2) : null);
export const hashExternalId = (raw: string | null | undefined) =>
  hashOrNull(raw ? String(raw).trim().toLowerCase() : null);
