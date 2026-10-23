import { getAppUrl } from "../app-url";
import { pixelKeyFor } from "../crypto.server";

type AdminLike = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

export function pixelSettings(shop: string) {
  return {
    endpoint: `${getAppUrl()}/api/pixel`,
    shop,
    key: pixelKeyFor(shop),
  };
}

/**
 * Turns on the checkout pixel for this store, or refreshes its settings when the app URL changed.
 * Returns the web pixel id, or an error message Settings can show.
 */
export async function ensureWebPixel(admin: AdminLike, shop: string): Promise<{ id: string | null; error: string | null }> {
  const settings = JSON.stringify(pixelSettings(shop));
  const existingRes = await admin.graphql(`#graphql
    query DeliveredRoasPixel { webPixel { id settings } }`);
  const existing: any = await existingRes.json();
  const pixel = existing?.data?.webPixel;

  if (pixel?.id) {
    if (pixel.settings === settings) return { id: pixel.id, error: null };
    const res = await admin.graphql(
      `#graphql
      mutation DeliveredRoasPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) { userErrors { field message } webPixel { id } }
      }`,
      { variables: { id: pixel.id, webPixel: { settings } } },
    );
    const json: any = await res.json();
    const err = json?.data?.webPixelUpdate?.userErrors?.[0]?.message ?? (json?.errors ? JSON.stringify(json.errors) : null);
    return { id: json?.data?.webPixelUpdate?.webPixel?.id ?? pixel.id, error: err };
  }

  const res = await admin.graphql(
    `#graphql
    mutation DeliveredRoasPixelCreate($webPixel: WebPixelInput!) {
      webPixelCreate(webPixel: $webPixel) { userErrors { field message } webPixel { id } }
    }`,
    { variables: { webPixel: { settings } } },
  );
  const json: any = await res.json();
  const err = json?.data?.webPixelCreate?.userErrors?.[0]?.message ?? (json?.errors ? JSON.stringify(json.errors) : null);
  return { id: json?.data?.webPixelCreate?.webPixel?.id ?? null, error: err };
}
