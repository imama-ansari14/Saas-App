import { createRoot } from "react-dom/client";
import { DemoView } from "../app/components/DemoView";
import { dateKey } from "../app/lib/metrics";

const root = document.getElementById("root");
if (root) createRoot(root).render(<DemoView today={dateKey(new Date(), "Asia/Karachi")} />);
