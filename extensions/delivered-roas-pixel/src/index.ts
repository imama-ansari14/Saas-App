import { register } from "@shopify/web-pixels-extension";

// Runs in Shopify's strict pixel sandbox. Only checkout_completed matters: it carries the
// order id, and the shopper's browser still holds Meta's _fbp and _fbc cookies at that moment.
register(({ analytics, browser, settings }) => {
  const endpoint = String(settings.endpoint || "");
  if (!endpoint.startsWith("https://")) return;

  analytics.subscribe("checkout_completed", async (event) => {
    const checkout = event.data?.checkout;
    const orderId = checkout?.order?.id;
    if (!orderId) return;

    let fbp: string | null = null;
    let fbc: string | null = null;
    try {
      fbp = (await browser.cookie.get("_fbp")) || null;
      fbc = (await browser.cookie.get("_fbc")) || null;
    } catch {
      // Cookies can be unavailable when the shopper declined tracking; the order still matches on phone
    }

    // fbclid on the landing URL is a fallback for _fbc when the Meta pixel never set it
    if (!fbc) {
      try {
        const href = event.context?.document?.location?.href ?? "";
        const clickId = new URL(href).searchParams.get("fbclid");
        if (clickId) fbc = `fb.1.${Date.now()}.${clickId}`;
      } catch {
        /* ignore malformed URLs */
      }
    }

    const body = JSON.stringify({
      shop: settings.shop,
      key: settings.key,
      orderId,
      fbp,
      fbc,
      userAgent: event.context?.navigator?.userAgent ?? null,
      pageUrl: event.context?.document?.location?.href ?? null,
      clientId: event.clientId ?? null,
      ts: event.timestamp,
    });

    // text/plain keeps this a simple request, so no CORS preflight is needed
    fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => undefined);
  });
});
