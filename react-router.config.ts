import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  // The Vercel preset is only needed for Vercel builds; local `react-router-serve` works without it
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
