// Turns demo-dist/index.html (a full document) into a page body fragment for hosting
// inside a wrapper that supplies its own <html>, <head> and <body>.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("demo-dist/index.html", "utf8");
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
const keep = head
  .split(/\n/)
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join("\n")
  .trim();
writeFileSync("demo-dist/artifact.html", `${keep}\n${body.trim()}\n`);
console.log("wrote demo-dist/artifact.html");
