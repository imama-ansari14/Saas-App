import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { SignalsTable } from "../components/Dashboard";
import "../components/dashboard.css";
import { loadCapiLog } from "../lib/report.server";
import { ensureShop, getShop } from "../lib/shop.server";

const EVENTS = ["ConfirmedOrder", "DeliveredOrder", "ReturnedOrder"] as const;
const STATUSES = ["SENT", "QUEUED", "FAILED", "STALE", "SKIPPED"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));
  const log = await loadCapiLog(shop.id);
  return {
    ...log,
    currency: shop.currency,
    capiEnabled: shop.capiEnabled,
    testMode: Boolean(shop.capiTestCode),
    pixel: shop.metaPixelId,
  };
};

export default function Signals() {
  const data = useLoaderData<typeof loader>();
  const send = useFetcher<{ ok?: boolean; error?: string }>();
  return (
    <s-page heading="Meta signals" inlineSize="large">
      <s-section heading="Last 7 days">
        <s-stack gap="base">
          {!data.capiEnabled ? (
            <s-banner tone="warning">The Conversions API is off, so events wait in the queue. Turn it on in <s-link href="/app/settings">Settings</s-link>.</s-banner>
          ) : data.testMode ? (
            <s-banner tone="info">Test mode: events go to Test events in Events Manager only. Clear the test code in Settings to go live.</s-banner>
          ) : null}
          <s-table>
            <s-table-header-row>
              <s-table-header>Event</s-table-header>
              {STATUSES.map((s) => (
                <s-table-header key={s} format="numeric">{s.toLowerCase()}</s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {EVENTS.map((e) => (
                <s-table-row key={e}>
                  <s-table-cell>{e}</s-table-cell>
                  {STATUSES.map((s) => (
                    <s-table-cell key={s}>{data.counts[`${e}:${s}`] ?? 0}</s-table-cell>
                  ))}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {send.data?.error ? <s-banner tone="critical">{send.data.error}</s-banner> : null}
          <send.Form method="post" action="/app/sync">
            <input type="hidden" name="job" value="capi" />
            <s-button type="submit" loading={send.state !== "idle" || undefined}>Send queued events now</s-button>
          </send.Form>
        </s-stack>
      </s-section>
      <s-section heading="Latest events">
        <div className="dr">
          <SignalsTable rows={data.rows} currency={data.currency} />
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
