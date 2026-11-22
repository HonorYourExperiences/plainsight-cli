// Turns one or more analyzer graphs into a single self-contained HTML report.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ELK_CDN = '<script src="https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"></script>';

/**
 * @param {object[]} graphs  analyzer output, first one shown first
 * @param {{ offline?: boolean, webFonts?: boolean }} options  offline (default): build the layout engine in; webFonts (default: only when not offline) loads IBM Plex from Google Fonts
 */
export function renderReport(graphs, { offline = true, webFonts = !offline } = {}) {
  const tpl = fs.readFileSync(path.join(here, "..", "viewer", "template.html"), "utf8");
  if (!tpl.includes(ELK_CDN)) throw new Error("viewer/template.html no longer loads ELK the expected way");
  // keep the page's own data from closing its <script> tag early
  const json = JSON.stringify(graphs).replace(/</g, "\\u003c");
  let html = tpl.replace("/*__GRAPHS__*/[]", () => json);
  if (offline) {
    const elk = fs.readFileSync(require.resolve("elkjs/lib/elk.bundled.js"), "utf8").replace(/<\/script/gi, "<\\/script");
    html = html.replace(ELK_CDN, () => `<script>${elk}</script>`);
  }
  // fully offline: no web fonts either (the page falls back to system fonts)
  if (!webFonts) {
    html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\n?/g, "");
  }
  // a standalone file needs its own document head (the template is written as a page body for embedding)
  if (!/^\s*<!doctype/i.test(html)) html = `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${html}`;
  return html;
}
