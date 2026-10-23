import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { DemoView } from "../components/DemoView";
import { FONT_HREF } from "../components/fonts";
import { dateKey } from "../lib/metrics";

// Public sample report for sales calls. No login, no database: the data is generated.

export const meta: MetaFunction = () => [
  { title: "Delivered ROAS sample report" },
  { name: "description", content: "What a Pakistani COD brand sees when Meta ROAS is measured against delivered orders." },
  { name: "robots", content: "noindex" },
];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: FONT_HREF },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return { today: dateKey(new Date(), "Asia/Karachi"), preset: url.searchParams.get("range") ?? "30d" };
};

export default function Demo() {
  const { today, preset: initial } = useLoaderData<typeof loader>();
  return <DemoView today={today} initialPreset={initial} />;
}
