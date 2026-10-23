# Delivered ROAS by Better Sales

An embedded Shopify app for Pakistani COD brands. It shows real ROAS per Meta campaign and ad after RTO, RTO by city, and sends confirmed, delivered and returned orders back to the brand's own Meta pixel through the Conversions API, so the ad account learns from customers who actually pay.

Live demo (no login): `/demo` on the deployed app. It is the full console on a sample store, with the Shopify, courier and Meta connect flows, plus **Audit from exports**: drop a brand's Shopify orders export, courier status report and Ads Manager export and get a real delivered ROAS report, computed in the browser.

## What is in the box

| Part | Where | What it does |
|---|---|---|
| Shopify orders | `app/lib/sync/orders.server.ts`, `app/routes/webhooks.orders.tsx` | 60 day import in slices, then order webhooks plus an hourly safety pull. Reads UTMs from the order's customer journey and landing page. |
| Checkout pixel | `extensions/delivered-roas-pixel` | Web pixel that posts `_fbp`, `_fbc`, user agent and order id at checkout completed to `/api/pixel`. |
| Couriers | `app/lib/couriers/*`, `app/routes/app.couriers.tsx` | PostEx and Leopards APIs, plus CSV or XLSX upload for TCS, Trax, M&P and any other courier. Columns are found by name. |
| Meta spend | `app/lib/meta/insights.server.ts` | Ad level spend and Meta reported purchases per day, last 3 days re pulled every 6 hours. |
| Status engine | `app/lib/status.ts`, `app/lib/sync/status.server.ts` | One status per order from all its parcels, confirmation rules, and the Meta events each change earns. |
| Conversions API | `app/lib/meta/capi.server.ts`, `app/lib/sync/capi.server.ts` | `ConfirmedOrder`, `DeliveredOrder`, `ReturnedOrder` with hashed phone, email, name, city, external id, fbp, fbc, IP and user agent. Events older than 7 days are never sent. Event id is the event name plus the Shopify order id, so nothing counts twice. |
| Report | `app/lib/metrics.ts` | Meta ROAS, delivered ROAS, expected ROAS, RTO, cost per delivered order, per campaign and ad, plus cities and a daily series. Pure function, shared by the app and the demo. |
| Screens | `app/routes/app._index.tsx`, `app.integrations.tsx`, `app.couriers.tsx`, `app.signals.tsx`, `app.settings.tsx` | Dashboard, Integrations hub (connect couriers and Meta with live tests), courier uploads, Meta event log, settings. |
| Meta login | `app/routes/meta.oauth.*`, `app/lib/meta/oauth.server.ts` | Continue with Meta: opens Meta login in a new window, stores a long lived token encrypted, then lists the brand's ad accounts and pixels to pick from. System user token as a fallback. |
| Console and audits | `app/components/saas/*`, `app/lib/imports/*` | The SaaS console used by `/demo`, and the parsers for Shopify, courier and Ads Manager exports. |
| Jobs | `app/routes/api.cron.tick.tsx`, `app/lib/jobs.server.ts` | One hourly endpoint runs whatever is due per store, with a Postgres lock so runs never overlap. |

Privacy: no raw phone, email or name is stored. Only SHA256 hashes (exactly what Meta needs), the city, and the checkout IP and user agent for matching. Courier and Meta secrets are encrypted with AES 256 GCM.

## Stack

Shopify React Router app template, Polaris web components, Prisma 6 (Rust free client over `pg`), Postgres on Supabase, Vercel with Vercel Cron.

## Deploy, step by step

1. **Supabase.** Create a project. Copy the transaction pooler URL (port 6543, add `?pgbouncer=true`) as `DATABASE_URL` and the session or direct URL (port 5432) as `DIRECT_URL`.
2. **Shopify Dev Dashboard.** Create an app named Delivered ROAS. Copy the Client ID and Client Secret. Put the Client ID in `shopify.app.toml`.
3. **Vercel.** Import the GitHub repo. Add the variables from `.env.example`: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `DATABASE_URL`, `DIRECT_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `META_SYSTEM_USER_TOKEN`. The build runs the database migration by itself.
4. **App URLs.** Put the Vercel production URL in `shopify.app.toml` (`application_url` and `redirect_urls`), then run `npm run deploy` (Shopify CLI) once. This pushes scopes, webhooks and the checkout pixel extension.
5. **Install on Malhaa first.** Dev Dashboard, Distribution, Custom distribution, enter the store, open the install link. The app starts importing orders the first time it is opened.
6. **Integrations inside the app.** Connect a courier (PostEx or Leopards keys are tested before they are saved, then the first sync runs), and Connect Meta Ads (Continue with Meta, choose the ad account and pixel, pick the events). Settings keeps the advanced options: test event code, confirmation tags, send events as website or system generated.
7. **Meta login (optional but recommended).** Create a Meta app (type Business) with Facebook Login for Business, set the redirect URI to `<app url>/meta/oauth/callback`, and add `META_APP_ID` and `META_APP_SECRET` on Vercel. Without them the Meta step accepts a system user token instead.
8. **UTMs.** Paste the template from Settings into URL parameters on every ad:
   `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}`

### Approvals to start early

* **Protected customer data** (Shopify): request access to name, email, phone and address in the Dev Dashboard. Until it is granted the app still works, it just matches Meta events on browser ids and customer id only.
* **Meta Full Access for ads_read**: pilots work on ad accounts the Better Sales Business Manager already manages. Other businesses need App Review plus Business Verification.

### Cron

`vercel.json` calls `/api/cron/tick` every hour. Hourly crons need a Vercel Pro team; on Hobby, crons run once a day, so point any free scheduler (cron-job.org, GitHub Actions) at the same URL every hour with the header `Authorization: Bearer <CRON_SECRET>`. Add `?shop=store.myshopify.com&force=couriers,meta` to run one store immediately.

## Local development

```bash
npm install
cp .env.example .env      # fill it
npm run dev               # Shopify CLI tunnel, then press P to open the app
npm test                  # unit tests plus a full pipeline test on in memory Postgres
npm run build:demo        # one file sample report in demo-dist/
```

## How the numbers are calculated

* Orders are grouped by the day they were placed and joined to Meta by `utm_campaign` (campaign id, or campaign name as a fallback) and `utm_content` (ad id).
* Delivered ROAS = revenue of delivered parcels ÷ spend. Returned, cancelled and never dispatched orders count as zero.
* RTO = returned ÷ (delivered + returned). Parcels still moving are shown separately.
* Expected ROAS adds parcels in transit, and recent orders not booked yet, at the delivery rate the row has earned (the account rate below 20 final parcels).
* Meta orders without campaign ids sit in an Unattributed row so totals stay honest.

## Open checks on the first live store

* PostEx response fields are mapped defensively (`transactionStatus`, `orderRefNumber`, `transactionStatusHistory`). Run Test saved PostEx token on Malhaa and compare one parcel against the portal.
* Run the action source test in Events Manager: send DeliveredOrder as a website event and confirm it can be selected for a custom conversion.
* App numbers on Malhaa should match the manual audit within 2%.
