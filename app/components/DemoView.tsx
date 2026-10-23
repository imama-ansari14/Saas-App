import "./dashboard.css";
import "./saas/saas.css";
import "./demo-page.css";
import { SaasApp } from "./saas/SaasApp";

/** Public product demo: the full console on sample data, plus real audits from exports. */
export function DemoView({ today }: { today: string; initialPreset?: string }) {
  return <SaasApp today={today} />;
}
