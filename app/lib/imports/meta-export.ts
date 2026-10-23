import { norm } from "../couriers/matrix";
import { parseLooseDate, toNumber } from "../couriers/types";
import { dateKey } from "../metrics";
import type { ReportAdDay } from "../types";

// Reads an Ads Manager export (Reports or the campaigns table, CSV or XLSX). Best results come from
// ad level rows broken down by Day, with Campaign ID and Ad ID columns added, but campaign level
// rows and exports without a Day column work too.

export interface ParsedMetaExport {
  rows: ReportAdDay[];
  hasDays: boolean;
  level: "ad" | "campaign";
  currency: string | null;
  columns: Record<string, string>;
  from: string | null;
  to: string | null;
  warnings: string[];
  error?: string;
}

const COLS = {
  campaignName: ["campaignname", "campaign"],
  campaignId: ["campaignid"],
  adName: ["adname", "ad"],
  adId: ["adid"],
  day: ["day", "date"],
  start: ["reportingstarts", "reportingstart", "startdate"],
  end: ["reportingends", "reportingend", "enddate"],
  purchases: ["purchases", "websitepurchases", "purchase", "omnipurchases"],
  value: [
    "purchasesconversionvalue",
    "websitepurchasesconversionvalue",
    "purchaseconversionvalue",
    "purchasesvalue",
    "conversionvalue",
  ],
} as const;

type Col = keyof typeof COLS;

export function parseMetaMatrix(matrix: unknown[][], timeZone = "Asia/Karachi"): ParsedMetaExport {
  let headerIdx = -1;
  const cols: Partial<Record<Col, number>> = {};
  let spendIdx = -1;
  let currency: string | null = null;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const raw = (matrix[i] ?? []).map((h) => String(h ?? ""));
    const n = raw.map(norm);
    const spend = n.findIndex((h) => h.startsWith("amountspent") || h === "spend");
    const campaign = COLS.campaignName.map((s) => n.indexOf(s)).find((x) => x >= 0);
    if (spend >= 0 && campaign != null) {
      headerIdx = i;
      spendIdx = spend;
      currency = raw[spend].match(/\(([A-Z]{3})\)/)?.[1] ?? null;
      for (const k of Object.keys(COLS) as Col[]) {
        const hit = COLS[k].map((s) => n.indexOf(s)).find((x) => x >= 0);
        if (hit != null) cols[k] = hit;
      }
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      rows: [],
      hasDays: false,
      level: "campaign",
      currency: null,
      columns: {},
      from: null,
      to: null,
      warnings: [],
      error: "This does not look like an Ads Manager export. It needs Campaign name and Amount spent columns.",
    };
  }

  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? ""));
  const get = (row: unknown[], c: Col) => (cols[c] != null ? row[cols[c]!] : null);
  const str = (v: unknown) => (v == null ? "" : String(v).trim());
  const toKey = (v: unknown): string | null => {
    if (v == null || v === "") return null;
    if (v instanceof Date) return dateKey(v, "UTC");
    const s = str(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = parseLooseDate(s);
    return d ? dateKey(d, timeZone) : null;
  };

  const rows: ReportAdDay[] = [];
  const hasAds = cols.adName != null || cols.adId != null;
  for (const row of matrix.slice(headerIdx + 1)) {
    const campaignName = str(get(row, "campaignName"));
    if (!campaignName) continue; // summary rows have no campaign
    const date = toKey(get(row, "day")) ?? toKey(get(row, "start"));
    if (!date) continue;
    const campaignId = str(get(row, "campaignId")) || campaignName;
    const adName = hasAds ? str(get(row, "adName")) || "(unnamed ad)" : "All ads";
    const adId = str(get(row, "adId")) || `${campaignId}::${adName}`;
    rows.push({
      date,
      campaignId,
      campaignName,
      adId,
      adName,
      spend: toNumber(row[spendIdx]) ?? 0,
      purchases: toNumber(get(row, "purchases")) ?? 0,
      purchaseValue: toNumber(get(row, "value")) ?? 0,
    });
  }

  const dates = rows.map((r) => r.date).sort();
  const columns: Record<string, string> = { spend: headers[spendIdx] };
  for (const [k, v] of Object.entries(cols)) columns[k] = headers[v as number];
  const warnings: string[] = [];
  if (cols.value == null) warnings.push("No purchase conversion value column, so Meta ROAS will read as zero. Add Purchases conversion value to the report.");
  if (cols.day == null) warnings.push("No Day breakdown, so the daily chart is hidden. Choose Breakdown, By time, Day in Ads Manager for a daily view.");
  if (!hasAds) warnings.push("Campaign level only. Export at ad level to see which ads deliver.");
  return {
    rows,
    hasDays: cols.day != null,
    level: hasAds ? "ad" : "campaign",
    currency,
    columns,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    warnings,
    error: rows.length ? undefined : "The export has headers but no campaign rows.",
  };
}
