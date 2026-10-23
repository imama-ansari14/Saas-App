import { addDays } from "./metrics";
import type { CapiLogRow, OrderStatus, ReportAdDay, ReportOrder } from "./types";

// Deterministic sample store for sales calls: a Pakistani COD fashion brand spending
// about PKR 25K a day on Meta. Same seed, same numbers, every time.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoAd {
  id: string;
  name: string;
  weight: number;
  rtoMul: number;
}
interface DemoCampaign {
  id: string;
  name: string;
  dailySpend: number;
  metaRoas: number;
  rto: number;
  aov: number;
  ads: DemoAd[];
}

const CAMPAIGNS: DemoCampaign[] = [
  {
    id: "120231904117650481",
    name: "Sales | ASC | Winter Collection 26",
    dailySpend: 9000,
    metaRoas: 4.1,
    rto: 0.29,
    aov: 4200,
    ads: [
      { id: "120231904117650511", name: "Video | Model Walk | Shawls", weight: 0.42, rtoMul: 0.85 },
      { id: "120231904117650512", name: "Carousel | Bestsellers", weight: 0.3, rtoMul: 0.8 },
      { id: "120231904117650513", name: "Static | FLAT 50% OFF Today Only", weight: 0.28, rtoMul: 1.95 },
    ],
  },
  {
    id: "120231877305120090",
    name: "Sales | CBO | Khussa Bestsellers",
    dailySpend: 6000,
    metaRoas: 3.5,
    rto: 0.13,
    aov: 3600,
    ads: [
      { id: "120231877305120101", name: "UGC | Unboxing Hook 3", weight: 0.5, rtoMul: 0.9 },
      { id: "120231877305120102", name: "Video | Handmade Process", weight: 0.32, rtoMul: 0.95 },
      { id: "120231877305120103", name: "Static | Size Guide", weight: 0.18, rtoMul: 1.2 },
    ],
  },
  {
    id: "120231950228810344",
    name: "Sales | ABO | Hook Testing",
    dailySpend: 3500,
    metaRoas: 2.8,
    rto: 0.38,
    aov: 3900,
    ads: [
      { id: "120231950228810361", name: "Hook A | Price Shock", weight: 0.36, rtoMul: 1.25 },
      { id: "120231950228810362", name: "Hook B | Celebrity Look", weight: 0.34, rtoMul: 1.05 },
      { id: "120231950228810363", name: "Hook C | Customer Review", weight: 0.3, rtoMul: 0.65 },
    ],
  },
  {
    id: "120231711940020017",
    name: "Retargeting | 30D Engagers and ATC",
    dailySpend: 2500,
    metaRoas: 6.2,
    rto: 0.1,
    aov: 4800,
    ads: [
      { id: "120231711940020031", name: "DPA | Viewed Not Bought", weight: 0.6, rtoMul: 1 },
      { id: "120231711940020032", name: "Static | Free Delivery Reminder", weight: 0.4, rtoMul: 1 },
    ],
  },
  {
    id: "120231963300470226",
    name: "Sales | Broad | Bridal Edit",
    dailySpend: 4000,
    metaRoas: 3.0,
    rto: 0.22,
    aov: 9800,
    ads: [
      { id: "120231963300470241", name: "Video | Bridal Lookbook", weight: 0.55, rtoMul: 0.9 },
      { id: "120231963300470242", name: "Carousel | Mehndi and Barat", weight: 0.45, rtoMul: 1.12 },
    ],
  },
];

const CITIES: { city: string; label: string; weight: number; rtoMul: number }[] = [
  { city: "karachi", label: "Karachi", weight: 0.24, rtoMul: 0.85 },
  { city: "lahore", label: "Lahore", weight: 0.2, rtoMul: 0.78 },
  { city: "islamabad", label: "Islamabad", weight: 0.07, rtoMul: 0.62 },
  { city: "rawalpindi", label: "Rawalpindi", weight: 0.07, rtoMul: 0.8 },
  { city: "faisalabad", label: "Faisalabad", weight: 0.06, rtoMul: 1.0 },
  { city: "multan", label: "Multan", weight: 0.05, rtoMul: 1.15 },
  { city: "peshawar", label: "Peshawar", weight: 0.05, rtoMul: 1.4 },
  { city: "hyderabad", label: "Hyderabad", weight: 0.04, rtoMul: 1.3 },
  { city: "gujranwala", label: "Gujranwala", weight: 0.035, rtoMul: 1.05 },
  { city: "sialkot", label: "Sialkot", weight: 0.03, rtoMul: 0.9 },
  { city: "quetta", label: "Quetta", weight: 0.03, rtoMul: 1.75 },
  { city: "sukkur", label: "Sukkur", weight: 0.025, rtoMul: 1.6 },
  { city: "bahawalpur", label: "Bahawalpur", weight: 0.025, rtoMul: 1.2 },
  { city: "sargodha", label: "Sargodha", weight: 0.02, rtoMul: 1.1 },
  { city: "abbottabad", label: "Abbottabad", weight: 0.02, rtoMul: 0.9 },
  { city: "dera ismail khan", label: "D I Khan", weight: 0.02, rtoMul: 1.85 },
  { city: "larkana", label: "Larkana", weight: 0.02, rtoMul: 1.8 },
  { city: "mardan", label: "Mardan", weight: 0.02, rtoMul: 1.35 },
  { city: "rahim yar khan", label: "Rahim Yar Khan", weight: 0.02, rtoMul: 1.25 },
];

function pickWeighted<T extends { weight: number }>(list: T[], r: number): T {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of list) {
    acc += x.weight / total;
    if (r <= acc) return x;
  }
  return list[list.length - 1];
}

export interface DemoData {
  orders: ReportOrder[];
  ads: ReportAdDay[];
  capiLog: CapiLogRow[];
  storeName: string;
}

export function buildDemoData(today: string, days = 60): DemoData {
  const r = rng(20261021);
  const orders: ReportOrder[] = [];
  const ads: ReportAdDay[] = [];
  let orderNo = 18240;

  const outcome = (ageDays: number, rto: number): OrderStatus => {
    if (r() < 0.055) return ageDays < 2 ? "NOT_DISPATCHED" : "CANCELLED";
    if (ageDays < 1) return "NOT_DISPATCHED";
    // Most parcels reach a final status 3 to 8 days after the order
    const pFinal = Math.min(1, Math.max(0, (ageDays - 2) / 7));
    if (r() > pFinal) return ageDays < 2 && r() < 0.5 ? "NOT_DISPATCHED" : "IN_TRANSIT";
    return r() < Math.min(0.8, rto) ? "RETURNED" : "DELIVERED";
  };

  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekday = dow === 5 ? 0.88 : dow === 0 ? 1.12 : 1; // Friday dip, Sunday peak
    const ramp = 0.85 + ((days - i) / days) * 0.3; // spend grew over the period

    for (const c of CAMPAIGNS) {
      for (const ad of c.ads) {
        const spend = Math.round(c.dailySpend * ad.weight * weekday * ramp * (0.8 + r() * 0.4));
        const roasNoise = 0.75 + r() * 0.5;
        const adRoas = c.metaRoas * (ad.rtoMul > 1.5 ? 1.18 : 1) * roasNoise;
        const value = spend * adRoas;
        const aov = c.aov * (0.9 + r() * 0.2);
        const purchases = Math.max(0, Math.round(value / aov));
        ads.push({
          date,
          campaignId: c.id,
          campaignName: c.name,
          adId: ad.id,
          adName: ad.name,
          spend,
          purchases,
          purchaseValue: Math.round(purchases * aov),
        });
        // Shopify sees slightly fewer orders than Meta claims, all carrying UTM ids
        const real = Math.round(purchases * (0.86 + r() * 0.16));
        for (let k = 0; k < real; k++) {
          const city = pickWeighted(CITIES, r());
          const total = Math.round((c.aov * (0.7 + r() * 0.6)) / 50) * 50;
          orders.push({
            id: `demo_${orderNo}`,
            name: `#${orderNo++}`,
            date,
            total,
            isCod: r() < 0.93,
            status: outcome(i, c.rto * ad.rtoMul * city.rtoMul),
            city: city.city,
            cityLabel: city.label,
            utmSource: "facebook",
            utmMedium: "paid",
            utmCampaign: c.id,
            utmContent: ad.id,
            hasFbclid: true,
          });
        }
      }
    }

    // Meta orders that lost their UTMs (Instagram profile link, in app browser quirks)
    const lost = Math.round(1.6 * weekday * ramp * (0.6 + r() * 0.8));
    for (let k = 0; k < lost; k++) {
      const city = pickWeighted(CITIES, r());
      orders.push({
        id: `demo_${orderNo}`,
        name: `#${orderNo++}`,
        date,
        total: Math.round((4300 * (0.7 + r() * 0.6)) / 50) * 50,
        isCod: true,
        status: outcome(i, 0.24 * city.rtoMul),
        city: city.city,
        cityLabel: city.label,
        utmSource: r() < 0.6 ? "ig" : "facebook",
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        hasFbclid: r() < 0.5,
      });
    }

    // Organic, Google and WhatsApp orders
    const organic = Math.round(14 * weekday * (0.7 + r() * 0.6));
    for (let k = 0; k < organic; k++) {
      const city = pickWeighted(CITIES, r());
      orders.push({
        id: `demo_${orderNo}`,
        name: `#${orderNo++}`,
        date,
        total: Math.round((4600 * (0.7 + r() * 0.6)) / 50) * 50,
        isCod: r() < 0.85,
        status: outcome(i, 0.14 * city.rtoMul),
        city: city.city,
        cityLabel: city.label,
        utmSource: r() < 0.4 ? "google" : null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        hasFbclid: false,
      });
    }
  }

  // A recent slice of the Conversions API log
  const capiLog: CapiLogRow[] = [];
  const recent = orders.filter((o) => o.date >= addDays(today, -6) && o.utmCampaign).slice(-400);
  const names = ["ConfirmedOrder", "DeliveredOrder", "ReturnedOrder"] as const;
  for (let k = 0; k < 40 && recent.length; k++) {
    const o = recent[Math.floor(r() * recent.length)];
    const ev = o.status === "DELIVERED" ? names[1] : o.status === "RETURNED" ? names[2] : names[0];
    const hoursAgo = Math.floor(r() * 140);
    const at = new Date(Date.now() - hoursAgo * 3600_000);
    capiLog.push({
      id: `ev_${k}`,
      orderName: o.name,
      eventName: ev,
      eventTime: at.toISOString(),
      value: ev === "ReturnedOrder" ? null : o.total,
      status: "SENT",
      source: r() < 0.85 ? "website" : "system_generated",
      error: null,
      sentAt: new Date(at.getTime() + 20 * 60_000).toISOString(),
    });
  }
  capiLog.sort((a, b) => (a.eventTime < b.eventTime ? 1 : -1));

  return { orders, ads, capiLog, storeName: "Demo Store (sample data)" };
}
