import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect } from "react";
import db from "../db.server";
import { encrypt, verifyState } from "../lib/crypto.server";
import { exchangeCode, whoAmI } from "../lib/meta/oauth.server";
import "../components/dashboard.css";
import "../components/demo-page.css";
import { FONT_HREF } from "../components/fonts";

export const meta: MetaFunction = () => [{ title: "Meta connection" }, { name: "robots", content: "noindex" }];
export const links: LinksFunction = () => [{ rel: "stylesheet", href: FONT_HREF }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const data = verifyState<{ shop: string }>(url.searchParams.get("state"));
  if (!data?.shop) return { ok: false, message: "This login link expired. Close this window and try again from the app." };
  if (url.searchParams.get("error")) {
    return { ok: false, message: "Meta login was cancelled. Close this window and try again when you are ready." };
  }
  const code = url.searchParams.get("code");
  if (!code) return { ok: false, message: "Meta did not return a login code. Close this window and try again." };
  try {
    const { token } = await exchangeCode(code);
    const me = await whoAmI(token);
    await db.shop.update({ where: { id: data.shop }, data: { metaTokenEnc: encrypt(token) } });
    return { ok: true, message: `Connected as ${me.name}. Go back to Shopify to choose the ad account and pixel.` };
  } catch (e: any) {
    return { ok: false, message: `Meta refused the login: ${e?.message ?? e}` };
  }
};

export default function MetaCallback() {
  const { ok, message } = useLoaderData<typeof loader>();
  useEffect(() => {
    if (!ok) return;
    const t = window.setTimeout(() => window.close(), 2500);
    return () => window.clearTimeout(t);
  }, [ok]);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "64px max(16px, env(safe-area-inset-left, 0px))", fontFamily: "var(--dr-font-body)" }}>
      <p className="dr-brand"><span className="dr-brand-mark" aria-hidden="true" /> Delivered ROAS</p>
      <h1 style={{ fontFamily: "var(--dr-font-display)", fontSize: 26, margin: "8px 0" }}>{ok ? "Meta is connected" : "Meta is not connected"}</h1>
      <p style={{ color: "var(--dr-muted)", fontSize: 16, lineHeight: 1.6 }}>{message}</p>
      {ok ? <p style={{ color: "var(--dr-faint)" }}>This window closes on its own.</p> : null}
    </main>
  );
}
