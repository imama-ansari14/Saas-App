import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the public sample report as one self contained HTML file (React from cdnjs),
// for sharing before the app is deployed. Output: demo-dist/index.html
export default defineConfig({
  root: "demo-standalone",
  resolve: {
    alias: {
      papaparse: fileURLToPath(new URL("./demo-standalone/shims/papaparse.ts", import.meta.url)),
      "read-excel-file/browser": fileURLToPath(new URL("./demo-standalone/shims/read-excel-file.ts", import.meta.url)),
    },
  },
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    jsxInject: `import React from "react"`,
  },
  build: {
    outDir: "../demo-dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client"],
      output: {
        format: "iife",
        inlineDynamicImports: true,
        globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
      },
    },
  },
  plugins: [viteSingleFile()],
});
