import { hashCity, hashCountry } from "../hash.server";
import type { CapiEventName } from "../types";
import { GRAPH_BASE } from "./graph.server";

/** Meta rejects events older than 7 days, and one stale event fails the whole request. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000; // 30 minute safety margin
export const BATCH_SIZE = 50;

export interface CapiOrder {
  shopifyId: string;
  name: string;
  total: number;
  currency: string;
  itemCount: number;
  phoneHash: string | null;
  emailHash: string | null;
  fnHash: string | null;
  lnHash: string | null;
  externalIdHash: string | null;
  city: string | null;
  countryCode: string | null;
  fbp: string | null;
  fbc: string | null;
  userAgent: string | null;
  clientIp: string | null;
  sourceUrl: string | null;
}

export interface BuiltEvent {
  eventId: string;
  actionSource: "website" | "system_generated";
  payload: Record<string, unknown>;
}

export type BuildResult = { ok: true; event: BuiltEvent } | { ok: false; reason: "stale" | "no_match_keys" };

export function eventIdFor(eventName: CapiEventName, shopifyId: string): string {
  return `${eventName}_${shopifyId}`;
}

export function buildCapiEvent(args: {
  eventName: CapiEventName;
  eventTime: Date;
  order: CapiOrder;
  preferredSource: "website" | "system_generated";
  storeUrl: string | null;
  now?: Date;
}): BuildResult {
  const now = args.now ?? new Date();
  let t = args.eventTime.getTime();
  if (t > now.getTime()) t = now.getTime();
  if (now.getTime() - t > MAX_EVENT_AGE_MS) return { ok: false, reason: "stale" };

  const o = args.order;
  const user: Record<string, unknown> = {};
  if (o.phoneHash) user.ph = [o.phoneHash];
  if (o.emailHash) user.em = [o.emailHash];
  if (o.fnHash) user.fn = [o.fnHash];
  if (o.lnHash) user.ln = [o.lnHash];
  const ct = hashCity(o.city);
  if (ct) user.ct = [ct];
  const country = hashCountry(o.countryCode || "pk");
  if (country) user.country = [country];
  if (o.externalIdHash) user.external_id = [o.externalIdHash];
  if (o.fbp) user.fbp = o.fbp;
  if (o.fbc) user.fbc = o.fbc;
  if (o.userAgent) user.client_user_agent = o.userAgent;
  if (o.clientIp) user.client_ip_address = o.clientIp;

  const hasKey = Boolean(o.phoneHash || o.emailHash || o.externalIdHash || o.fbp || o.fbc);
  if (!hasKey) return { ok: false, reason: "no_match_keys" };

  // Website events need a browser user agent. Without one the event is still useful
  // as system generated, so it is sent that way instead of being dropped.
  const actionSource =
    args.preferredSource === "website" && o.userAgent ? "website" : "system_generated";

  const custom: Record<string, unknown> = {
    currency: (o.currency || "PKR").toUpperCase(),
    order_id: o.name,
    num_items: o.itemCount,
  };
  if (args.eventName !== "ReturnedOrder") custom.value = Math.round(o.total * 100) / 100;

  const payload: Record<string, unknown> = {
    event_name: args.eventName,
    event_time: Math.floor(t / 1000),
    event_id: eventIdFor(args.eventName, o.shopifyId),
    action_source: actionSource,
    user_data: user,
    custom_data: custom,
  };
  if (actionSource === "website") {
    payload.event_source_url = o.sourceUrl || args.storeUrl || undefined;
  }

  return { ok: true, event: { eventId: payload.event_id as string, actionSource, payload } };
}

export interface CapiSendResult {
  ok: boolean;
  status: number;
  body: any;
}

export async function sendCapiBatch(
  pixelId: string,
  accessToken: string,
  events: Record<string, unknown>[],
  testEventCode?: string | null,
): Promise<CapiSendResult> {
  const body: Record<string, unknown> = { data: events, access_token: accessToken };
  if (testEventCode) body.test_event_code = testEventCode;
  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pixelId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok && !json?.error, status: res.status, body: json };
}
