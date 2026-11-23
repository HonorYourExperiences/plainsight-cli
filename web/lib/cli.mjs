// The Plainsight CLI's own files, located and loaded at run time. The bundler rewrites paths
// inside modules it bundles (the report reads its template and layout engine from disk),
// so these are kept out of the bundle entirely.
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function cliRoot() {
  const req = createRequire(path.join(/*turbopackIgnore: true*/ process.cwd(), "package.json"));
  return path.dirname(req.resolve("plainsight-cli/package.json"));
}

export const cliBin = () => process.env.PLAINSIGHT_CLI || path.join(cliRoot(), "bin", "plainsight.mjs");

export async function renderReport(graphs, options) {
  const mod = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(cliRoot(), "src", "report.mjs")).href);
  return mod.renderReport(graphs, options);
}
