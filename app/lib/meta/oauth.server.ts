import { getAppUrl } from "../app-url";
import { GRAPH_BASE, GRAPH_VERSION, graphGet } from "./graph.server";

// Meta login for brands: the shop owner signs in with the Meta account that manages the ad
// account and pixel, and the app keeps a long lived token (about 60 days) encrypted.

export const META_SCOPES = ["ads_read", "ads_management", "business_management"];

export function metaOAuthReady(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function metaRedirectUri(): string {
  return `${getAppUrl()}/meta/oauth/callback`;
}

export function metaDialogUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: metaRedirectUri(),
    state,
    response_type: "code",
    scope: META_SCOPES.join(","),
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q.toString()}`;
}

async function tokenCall(params: Record<string, string>) {
  const q = new URLSearchParams({ client_id: process.env.META_APP_ID ?? "", client_secret: process.env.META_APP_SECRET ?? "", ...params });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${q.toString()}`, { headers: { Accept: "application/json" } });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new Error(body?.error?.message || `Meta token exchange failed (${res.status})`);
  return body as { access_token: string; expires_in?: number };
}

/** Code from the dialog, to a short lived token, to a long lived one. */
export async function exchangeCode(code: string): Promise<{ token: string; expiresIn: number | null }> {
  const short = await tokenCall({ redirect_uri: metaRedirectUri(), code });
  const long = await tokenCall({ grant_type: "fb_exchange_token", fb_exchange_token: short.access_token });
  return { token: long.access_token, expiresIn: long.expires_in ?? null };
}

export interface AdAccountOption {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  active: boolean;
}

export async function listAdAccounts(token: string): Promise<AdAccountOption[]> {
  const body: any = await graphGet("me/adaccounts", { fields: "name,account_id,currency,account_status,timezone_name", limit: "100" }, token);
  return (body?.data ?? []).map((a: any) => ({
    id: String(a.account_id),
    name: a.name ?? `act_${a.account_id}`,
    currency: a.currency ?? "",
    timezone: a.timezone_name ?? "",
    active: a.account_status === 1,
  }));
}

export async function listPixels(token: string, accountId: string): Promise<{ id: string; name: string; lastFired: string | null }[]> {
  const body: any = await graphGet(`act_${accountId.replace(/^act_/, "")}/adspixels`, { fields: "id,name,last_fired_time", limit: "50" }, token);
  return (body?.data ?? []).map((p: any) => ({ id: String(p.id), name: p.name ?? String(p.id), lastFired: p.last_fired_time ?? null }));
}

export async function whoAmI(token: string): Promise<{ id: string; name: string }> {
  return graphGet("me", { fields: "id,name" }, token);
}
