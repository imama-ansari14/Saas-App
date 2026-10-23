import { createHmac } from "node:crypto";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** appsecret_proof is only added for our own system user token, when META_APP_SECRET is set. */
export function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function graphGet<T = any>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", proof);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.error)) {
    const msg = body?.error?.message || `Meta API ${res.status}`;
    throw new MetaApiError(msg, res.status, body);
  }
  return body as T;
}
