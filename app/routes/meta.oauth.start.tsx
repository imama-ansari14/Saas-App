import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { verifyState } from "../lib/crypto.server";
import { metaDialogUrl, metaOAuthReady } from "../lib/meta/oauth.server";

// Opened in a new top level window from the embedded app (Meta login cannot run inside the
// Shopify admin iframe). The signed state proves which store started the login.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const state = new URL(request.url).searchParams.get("state");
  const data = verifyState<{ shop: string }>(state);
  if (!data?.shop || !metaOAuthReady()) {
    return new Response("This link expired. Close this window and press Continue with Meta again.", { status: 400 });
  }
  throw redirect(metaDialogUrl(state!));
};
