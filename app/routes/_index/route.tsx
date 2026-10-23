import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import "../../components/dashboard.css";
import "../../components/demo-page.css";
import "./landing.css";
import { FONT_HREF } from "../../components/fonts";

export const meta: MetaFunction = () => [
  { title: "Delivered ROAS" },
  { name: "description", content: "Real ROAS after RTO for Pakistani COD brands on Shopify, and delivered orders sent back to Meta." },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: FONT_HREF },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function Landing() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <main className="lp">
      <p className="lp-brand"><span className="dr-brand-mark" aria-hidden="true" /> Delivered ROAS by Better Sales</p>
      <h1 className="lp-title">Meta shows ROAS on placed orders. This shows it on delivered ones.</h1>
      <p className="lp-lede">
        For Pakistani COD brands on Shopify. Every campaign and ad gets its real ROAS after RTO, every city its return rate,
        and Meta gets confirmed and delivered orders back through the Conversions API so it learns who actually pays.
      </p>
      <div className="lp-actions">
        <a className="lp-btn lp-btn-primary" href="/demo">Open the live demo</a>
      </div>
      <ul className="lp-points">
        <li><strong>Delivered ROAS per campaign and ad.</strong> Shopify orders joined to Meta spend through UTM ids, with PostEx, Leopards or any courier export deciding what was delivered.</li>
        <li><strong>RTO by city.</strong> The cities that return half their parcels, ready to exclude or move to advance payment.</li>
        <li><strong>Signals Meta can learn from.</strong> ConfirmedOrder, DeliveredOrder and ReturnedOrder events sent to the store&apos;s own pixel.</li>
      </ul>
      {showForm ? (
        <Form className="lp-login" method="post" action="/auth/login">
          <label htmlFor="lp-shop">Already installed? Open it for your store</label>
          <div className="lp-row">
            <input id="lp-shop" className="lp-input" type="text" name="shop" placeholder="your-store.myshopify.com" autoComplete="off" />
            <button className="lp-btn" type="submit">Log in</button>
          </div>
        </Form>
      ) : null}
    </main>
  );
}
