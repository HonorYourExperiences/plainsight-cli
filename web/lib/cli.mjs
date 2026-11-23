// The Plainsight CLI's own files, located and loaded at run time. The bundler rewrites paths
// inside modules it bundles (the report reads its template and layout engine from disk),
// so these are kept out of the bundle entirely.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const isCli = (dir) => !!dir && fs.existsSync(path.join(dir, "bin", "plainsight.mjs")) && fs.existsSync(path.join(dir, "src", "report.mjs"));

export function cliRoot() {
  const cwd = /*turbopackIgnore: true*/ process.cwd();
  const candidates = [process.env.PLAINSIGHT_CLI_ROOT];
  // installed as a dependency (npm links "file:.." into node_modules)
  try { candidates.push(path.dirname(createRequire(path.join(cwd, "package.json")).resolve("plainsight-cli/package.json"))); } catch {}
  // hosts that copy files without node_modules links (Vercel): the repo root sits one folder up
  candidates.push(path.join(cwd, ".."), cwd);
  const root = candidates.find(isCli);
  if (!root) throw new Error("Couldn't find the Plainsight CLI files next to the website.");
  return root;
}

export const cliBin = () => process.env.PLAINSIGHT_CLI || path.join(cliRoot(), "bin", "plainsight.mjs");

export async function renderReport(graphs, options) {
  const mod = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(cliRoot(), "src", "report.mjs")).href);
  return mod.renderReport(graphs, options);
}
