export function money(n: number | null | undefined, currency = "PKR", compact = false): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const prefix = currency === "PKR" ? "Rs " : `${currency} `;
  if (compact) {
    const abs = Math.abs(n);
    // Pakistani readers think in lakh and crore
    if (abs >= 1e7) return `${prefix}${(n / 1e7).toFixed(2)} cr`;
    if (abs >= 1e5) return `${prefix}${(n / 1e5).toFixed(2)} lakh`;
  }
  return `${prefix}${Math.round(n).toLocaleString("en-US")}`;
}

export function roas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}x`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

export function int(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function rangeLabel(since: string, until: string): string {
  return `${shortDate(since)} to ${shortDate(until)}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Tone for a delivered ROAS value against the account's own break even. */
export function roasTone(n: number | null | undefined, breakEven = 2): "good" | "warn" | "bad" | "none" {
  if (n == null) return "none";
  if (n >= breakEven * 1.25) return "good";
  if (n >= breakEven) return "warn";
  return "bad";
}

export function rtoTone(n: number | null | undefined, average: number | null): "good" | "warn" | "bad" | "none" {
  if (n == null) return "none";
  const base = average ?? 0.2;
  if (n >= Math.max(0.3, base * 1.4)) return "bad";
  if (n >= base * 1.1) return "warn";
  return "good";
}
