import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Dashboard } from "../components/Dashboard";
import "../components/dashboard.css";
import { timeAgo } from "../components/format";
import { dateKey, resolveRange } from "../lib/metrics";
import { loadReport } from "../lib/report.server";
import { ensureShop, getShop } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = (await getShop(session.shop)) ?? (await ensureShop(session.shop, admin));
  const url = new URL(request.url);
  const range = resolveRange(url.searchParams.get("range"), dateKey(new Date(), shop.timezone));
  const report = await loadReport(shop, range.since, range.until);
  return {
    report,
    preset: range.preset,
    storeName: shop.name ?? shop.id,
    setup: {
      backfillDone: shop.backfillDone,
      meta: Boolean(shop.metaAdAccountId),
      couriers: Boolean(shop.postexTokenEnc || shop.leopardsKeyEnc),
      capi: shop.capiEnabled && Boolean(shop.metaPixelId),
    },
    lastCourierSyncAt: shop.lastCourierSyncAt?.toISOString() ?? null,
    lastMetaSyncAt: shop.lastMetaSyncAt?.toISOString() ?? null,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const importer = useFetcher<{ done?: boolean; orders?: number; error?: string }>();
  const [imported, setImported] = useState(0);

  // First open after install: keep importing the last 60 days of orders in slices until done
  useEffect(() => {
    if (data.setup.backfillDone || importer.state !== "idle") return;
    if (importer.data?.error) return;
    if (importer.data?.done) {
      revalidator.revalidate();
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (importer.data?.orders) setImported((n) => n + (importer.data?.orders ?? 0));
    importer.submit({ job: "orders" }, { method: "post", action: "/app/sync" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.setup.backfillDone, importer.state, importer.data]);

  const missing = [
    !data.setup.meta && "your Meta ad account",
    !data.setup.couriers && "a courier (PostEx, Leopards, or a CSV upload)",
  ].filter(Boolean) as string[];

  const syncNote = [
    data.lastCourierSyncAt ? `couriers ${timeAgo(data.lastCourierSyncAt)}` : null,
    data.lastMetaSyncAt ? `Meta ${timeAgo(data.lastMetaSyncAt)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <s-page inlineSize="large">
      <Dashboard
        report={data.report}
        storeName={data.storeName}
        preset={data.preset}
        onPresetChange={(id) => navigate(`?range=${id}`)}
        mode="app"
        syncNote={syncNote ? `Synced: ${syncNote}` : null}
        notice={
          <>
            {!data.setup.backfillDone ? (
              <s-banner tone="info" heading="Importing your last 60 days of orders">
                {importer.data?.error
                  ? `Import paused: ${importer.data.error}`
                  : `Imported ${imported} orders so far. Keep this page open, the numbers fill in when it finishes.`}
              </s-banner>
            ) : null}
            {missing.length ? (
              <s-banner tone="warning" heading="Finish setup to see delivered ROAS">
                Connect {missing.join(" and ")} in <s-link href="/app/integrations">Integrations</s-link>.
              </s-banner>
            ) : null}
            {data.setup.meta && data.setup.couriers && !data.setup.capi ? (
              <s-banner tone="info" heading="Meta is not learning from delivered orders yet">
                Turn on the Conversions API in <s-link href="/app/integrations">Integrations</s-link> to send confirmed and delivered orders to your pixel.
              </s-banner>
            ) : null}
          </>
        }
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
