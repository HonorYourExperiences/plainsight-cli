#!/usr/bin/env node
// plainsight: draw any repo as a schematic with receipts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { analyze, VERSION } from "../src/analyze.mjs";
import { renderReport } from "../src/report.mjs";

const HELP = `plainsight ${VERSION}
Draws a repo as a schematic: every part, pipe and plain-English claim links to
the file and lines it came from.

Usage
  plainsight [repo] [options]

  repo                 a folder (default: the current folder) or a git URL,
                       e.g. https://github.com/owner/name or owner/name

Options
  -o, --out <file>     where to write the report (default: plainsight-report.html)
      --json <file>    also write the raw graph as JSON
      --markdown <file>
                       also write a Markdown summary (for CI job summaries
                       and pull request comments)
      --no-report      don't write the HTML report (summary only)
      --open           open the report in your browser when done
      --cdn            load the layout engine from a CDN instead of
                       building it into the page (smaller file, needs internet)
      --fail-on <level>
                       exit with code 1 if there are findings at this level or
                       worse: crit ("Fix now") or warn ("Fix soon"). For CI.
  -q, --quiet          print only the report path and problems
  -v, --version        print the version
  -h, --help           print this help

Examples
  plainsight
  plainsight ../my-app --open
  plainsight vercel/nextjs-subscription-payments
  plainsight apps/web --fail-on crit --json plainsight.json`;

// ---------- arguments ----------
const args = process.argv.slice(2);
const opt = { out: "plainsight-report.html", json: null, markdown: null, report: true, open: false, offline: true, failOn: null, quiet: false, repo: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i], next = () => { if (i + 1 >= args.length) die(`${a} needs a value`); return args[++i]; };
  if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
  else if (a === "-v" || a === "--version") { console.log(VERSION); process.exit(0); }
  else if (a === "-o" || a === "--out") opt.out = next();
  else if (a === "--json") opt.json = next();
  else if (a === "--markdown") opt.markdown = next();
  else if (a === "--no-report") opt.report = false;
  else if (a === "--open") opt.open = true;
  else if (a === "--cdn") opt.offline = false;
  else if (a === "--fail-on") { opt.failOn = next(); if (!["crit", "warn"].includes(opt.failOn)) die('--fail-on takes "crit" or "warn"'); }
  else if (a === "-q" || a === "--quiet") opt.quiet = true;
  else if (a.startsWith("-")) die(`Unknown option ${a}. Run plainsight --help.`);
  else if (opt.repo) die(`Give one repo at a time (got "${opt.repo}" and "${a}").`);
  else opt.repo = a;
}

function die(msg) { console.error(`plainsight: ${msg}`); process.exit(2); }
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c("31", s), yellow = (s) => c("33", s), blue = (s) => c("34", s), dim = (s) => c("2", s), bold = (s) => c("1", s);

// ---------- which repo ----------
let target = opt.repo || ".", cloned = null;
const looksRemote = /^(https?:\/\/|git@|ssh:\/\/)/.test(target) || (/^[\w.-]+\/[\w.-]+$/.test(target) && !fs.existsSync(target));
if (looksRemote) {
  const url = /^[\w.-]+\/[\w.-]+$/.test(target) ? `https://github.com/${target}.git` : target;
  cloned = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-"));
  if (!opt.quiet) console.log(dim(`Cloning ${url} …`));
  const r = spawnSync("git", ["clone", "--depth", "1", "--quiet", url, cloned], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) { fs.rmSync(cloned, { recursive: true, force: true }); die(`couldn't clone ${url}\n${r.stderr?.toString().trim() || ""}`); }
  target = cloned;
} else if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) die(`"${target}" isn't a folder or a git URL.`);

// ---------- analyze ----------
let graph;
try {
  const t0 = Date.now();
  // a cloned repo is named after the repo, not the temporary folder it was cloned into
  const repoName = cloned ? opt.repo.replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() : undefined;
  graph = analyze(target, { name: repoName });
  graph.elapsedMs = Date.now() - t0;
  if (cloned) graph.source = opt.repo;
} catch (e) {
  die(`analysis failed: ${e.message}`);
} finally {
  if (cloned) fs.rmSync(cloned, { recursive: true, force: true });
}

// ---------- write ----------
let reportPath = null;
if (opt.report) {
  reportPath = path.resolve(opt.out);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, renderReport([graph], { offline: opt.offline }));
}
if (opt.json) { fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true }); fs.writeFileSync(opt.json, JSON.stringify(graph, null, 2)); }

// ---------- summary ----------
const count = (k) => graph.nodes.filter((n) => n.kind === k && !n.layout).length;
const sev = (s) => graph.findings.filter((f) => f.sev === s);
const where = (f) => { const e = f.evidence?.[f.evidence.length - 1]; return e ? `${e.file}:${e.line}` : f.file || ""; };
const parts = [["page", "page", "pages"], ["module", "browser module", "browser modules"], ["route", "API route", "API routes"], ["action", "server action", "server actions"], ["table", "table", "tables"], ["storage", "saved-data key", "saved-data keys"], ["service", "service", "services"], ["host", "outside address", "outside addresses"], ["unknown", "unresolved address", "unresolved addresses"]]
  .filter(([k]) => count(k)).map(([k, one, many]) => `${count(k)} ${count(k) === 1 ? one : many}`);
const cov = graph.coverage, counted = cov.sourceFiles - cov.tooling.length - cov.tests.length - (cov.docs?.length || 0);
const notProven = graph.edges.filter((e) => e.certainty !== "proven").length;

if (!opt.quiet) {
  console.log(`\n${bold("Plainsight")} ${graph.app}${graph.commit ? dim(" @ " + graph.commit) : ""}`);
  console.log(`  ${parts.join(" · ") || "no parts found"}`);
  console.log(`  ${graph.edges.length} pipes${notProven ? `, ${notProven} not proven from code` : ", all proven from code"}`);
  console.log(`  ${cov.mapped} of ${counted} app files mapped${cov.unmapped.length ? dim(` (${cov.unmapped.length} not reached from any page or route)`) : ""}`);
  if (!graph.nodes.length) console.log(yellow("\n  Nothing recognised. Plainsight reads Next.js apps, plain HTML + JS sites and Cloudflare Workers today.\n  In a monorepo, point it at the app folder, e.g. plainsight apps/web"));
}
const label = { crit: red("FIX NOW "), warn: yellow("FIX SOON"), info: blue("REVIEW  ") };
const shown = opt.quiet ? graph.findings.filter((f) => f.sev !== "info") : graph.findings;
if (shown.length) {
  console.log("");
  const partName = (f) => { const n = graph.nodes.find((x) => x.id === f.node); return n ? (n.kind === "route" && n.method && n.method !== "ANY" ? `${n.method} ${n.name}` : n.name) : ""; };
  for (const f of shown) console.log(`  ${label[f.sev]} ${f.title}  ${dim([partName(f), where(f)].filter(Boolean).join(" · "))}`);
} else if (!opt.quiet) console.log(dim("\n  No findings from the checks this version runs."));
if (reportPath) console.log(`\n  Report: ${reportPath}${opt.quiet ? "" : dim("  (open it in a browser)")}`);
if (opt.json && !opt.quiet) console.log(`  Graph:  ${path.resolve(opt.json)}`);
if (!opt.quiet) console.log("");

if (opt.open && reportPath) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const r = spawnSync(cmd, process.platform === "win32" ? ["/c", "start", "", reportPath] : [reportPath], { stdio: "ignore" });
  if (r.status !== 0) console.log(dim(`  Couldn't open a browser here. Open the report yourself: ${reportPath}`));
}

if (opt.markdown) {
  const md = [];
  const sevName = { crit: "🔴 Fix now", warn: "🟠 Fix soon", info: "🔵 Review" };
  const counts = ["crit", "warn", "info"].map((s) => [s, graph.findings.filter((f) => f.sev === s).length]);
  md.push(`## Plainsight · ${graph.app}${graph.commit ? ` @ \`${graph.commit}\`` : ""}`);
  md.push("");
  md.push(`${counts.map(([s, n]) => `**${n}** ${sevName[s].slice(3).toLowerCase()}`).join(" · ")} · ${graph.edges.length} pipes, ${graph.edges.filter((e) => e.certainty === "proven").length} proven from code · ${graph.coverage.mapped} files mapped`);
  md.push("");
  const shownMd = graph.findings.filter((f) => f.sev !== "info");
  const infos = graph.findings.filter((f) => f.sev === "info");
  const promptMd = (f) => [`<details><summary>Fix prompt: ${f.title.replace(/</g, "&lt;")}</summary>`, "", "~~~~text", f.fix, "~~~~", "", "</details>", ""];
  const row = (f) => { const n = graph.nodes.find((x) => x.id === f.node); const part = n ? (n.kind === "route" && n.method && n.method !== "ANY" ? `${n.method} ${n.name}` : n.name) : ""; return `| ${sevName[f.sev]} | ${f.title.replace(/\|/g, "\\|")} | ${part ? "`" + part + "`" : ""} | \`${where(f)}\` |`; };
  if (shownMd.length) {
    md.push("| | Finding | Part | Where |", "|---|---|---|---|", ...shownMd.map(row), "");
    for (const f of shownMd.filter((x) => x.fix)) md.push(...promptMd(f));
  }
  else md.push("No **Fix now** or **Fix soon** findings from the checks this version runs.", "");
  if (infos.length) md.push(`<details><summary>${infos.length} to review</summary>`, "", "| | Finding | Part | Where |", "|---|---|---|---|", ...infos.map(row), "", ...infos.filter((x) => x.fix).flatMap(promptMd), "</details>", "");
  md.push("Open the HTML report for the drawing, the plain-English explanation of every part, and the code behind each finding.");
  fs.mkdirSync(path.dirname(path.resolve(opt.markdown)), { recursive: true });
  fs.writeFileSync(opt.markdown, md.join("\n") + "\n");
}

// ---------- exit code ----------
if (opt.failOn) {
  const bad = opt.failOn === "crit" ? sev("crit") : [...sev("crit"), ...sev("warn")];
  if (bad.length) { console.error(red(`plainsight: ${bad.length} finding${bad.length === 1 ? "" : "s"} at "${opt.failOn}" or worse`)); process.exit(1); }
}
