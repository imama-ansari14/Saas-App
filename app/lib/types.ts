// Shared types used by the server, the embedded admin and the public demo.

export type OrderStatus =
  | "DELIVERED"
  | "RETURNED"
  | "IN_TRANSIT"
  | "NOT_DISPATCHED"
  | "CANCELLED";

export type ShipmentStatus =
  | "BOOKED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "RETURN_IN_TRANSIT"
  | "RETURNED"
  | "CANCELLED"
  | "UNKNOWN";

export type CapiEventName = "ConfirmedOrder" | "DeliveredOrder" | "ReturnedOrder";

/** One order as the report engine sees it. */
export interface ReportOrder {
  id: string;
  name: string;
  /** YYYY-MM-DD in the store time zone */
  date: string;
  total: number;
  isCod: boolean;
  status: OrderStatus;
  city: string | null;
  cityLabel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  hasFbclid: boolean;
}

/** One ad on one day, from the Meta Marketing API. */
export interface ReportAdDay {
  date: string;
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  spend: number;
  purchases: number;
  purchaseValue: number;
}

export interface ReportRow {
  key: string;
  level: "account" | "campaign" | "ad" | "unattributed";
  id: string;
  name: string;
  spend: number;
  metaPurchases: number;
  metaValue: number;
  orders: number;
  delivered: number;
  returned: number;
  inTransit: number;
  notDispatched: number;
  cancelled: number;
  orderValue: number;
  deliveredRevenue: number;
  returnedValue: number;
  inTransitValue: number;
  /** Recent orders not booked with a courier yet (last 4 days of the range) */
  pendingValue: number;
  metaRoas: number | null;
  deliveredRoas: number | null;
  expectedRoas: number | null;
  overstatement: number | null;
  rtoPct: number | null;
  costPerDelivered: number | null;
  children?: ReportRow[];
}

export interface CityRow {
  city: string;
  label: string;
  orders: number;
  delivered: number;
  returned: number;
  inTransit: number;
  rtoPct: number | null;
  deliveredRevenue: number;
  lostValue: number;
  share: number;
}

export interface DailyPoint {
  date: string;
  spend: number;
  metaValue: number;
  deliveredRevenue: number;
  expectedRevenue: number;
}

export interface Report {
  since: string;
  until: string;
  currency: string;
  /** Account level, Meta sourced orders only (attributed plus unattributed). */
  totals: ReportRow;
  campaigns: ReportRow[];
  unattributed: ReportRow;
  /** Orders that did not come from Meta ads at all. */
  other: { orders: number; deliveredRevenue: number; delivered: number; returned: number };
  /** Every store order in range, any channel. */
  store: {
    orders: number;
    delivered: number;
    returned: number;
    inTransit: number;
    deliveredRevenue: number;
    blendedRoas: number | null;
  };
  cities: CityRow[];
  daily: DailyPoint[];
  deliveryRate: number | null;
  dispatchRate: number | null;
  generatedAt: string;
  /** False when orders carry no campaign ids (file audits from a plain Shopify export) */
  campaignJoin?: boolean;
}

export interface CapiLogRow {
  id: string;
  orderName: string;
  eventName: CapiEventName | string;
  eventTime: string;
  value: number | null;
  status: string;
  source: string | null;
  error: string | null;
  sentAt: string | null;
}
