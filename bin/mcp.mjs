// `plainsight mcp`: a Model Context Protocol server over stdio, so AI agents (Claude Code,
// Cursor, Codex...) can scan an app and read its findings, receipts and fix prompts.
// It runs on this machine like the CLI: a local folder is read in place and never uploaded.
// With PLAINSIGHT_URL and PLAINSIGHT_TOKEN set, it can also read maps saved on a Plainsight website.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { analyze, VERSION } from "../src/analyze.mjs";
import { summarize, summaryText, findingDetail, listParts, partDetail } from "../src/agent.mjs";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const remote = () => (process.env.PLAINSIGHT_URL && process.env.PLAINSIGHT_TOKEN ? { url: process.env.PLAINSIGHT_URL.replace(/\/+$/, ""), token: process.env.PLAINSIGHT_TOKEN } : null);

const SOURCE = {
  path: { type: "string", description: "Folder of the app on this machine (default: the folder the agent runs in). For a monorepo, the app folder, e.g. apps/web." },
  repo: { type: "string", description: "A public GitHub repo instead, as owner/name. It is cloned to a temporary folder and deleted after." },
  map: { type: "string", description: "The id of a map saved on your Plainsight website (needs PLAINSIGHT_URL and PLAINSIGHT_TOKEN)." },
};
const tools = () => [
  { name: "plainsight_scan", description: "Scan a Next.js app (or a plain HTML/JS site) and list its parts and security findings, numbered. Always rescans. Run it again after a fix to confirm the finding is gone.", inputSchema: { type: "object", properties: { ...SOURCE }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "plainsight_finding", description: "One finding in full: what can happen, the code receipts in order, and a fix prompt written for an AI coding tool (secrets masked). Use the number from plainsight_scan.", inputSchema: { type: "object", properties: { ...SOURCE, index: { type: "integer", minimum: 0, description: "Finding number from plainsight_scan" } }, required: ["index"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "plainsight_parts", description: "List the app's parts (pages, API routes, server actions, tables, outside services) with their files.", inputSchema: { type: "object", properties: { ...SOURCE, kind: { type: "string", enum: ["page", "module", "route", "action", "table", "storage", "service", "host", "unknown"] } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "plainsight_part", description: "One part and its pipes: what calls it, what it calls or reads, how certain each link is, and any findings on it. Name it as listed, e.g. 'GET /api/habits', '/dashboard' or 'Habit'.", inputSchema: { type: "object", properties: { ...SOURCE, name: { type: "string" } }, required: ["name"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  ...(remote() ? [{ name: "plainsight_maps", description: "List the maps saved on your Plainsight website (newest first), with their ids.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }] : []),
];

const cache = new Map(); // source key -> graph, so follow-up questions don't rescan
async function load(args, fresh = false) {
  const given = ["path", "repo", "map"].filter((k) => args[k] != null);
  if (given.length > 1) throw new Error("Give one of path, repo or map, not several.");
  const key = args.map ? `map:${args.map}` : args.repo ? `repo:${args.repo}` : `path:${path.resolve(args.path || ".")}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  let graph;
  if (args.map) {
    const r = remote();
    if (!r) throw new Error("Set PLAINSIGHT_URL and PLAINSIGHT_TOKEN to read maps from your Plainsight website.");
    graph = await api(r, `/api/v1/maps/${encodeURIComponent(args.map)}?graph=1`).then((x) => x.graph);
  } else if (args.repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo)) throw new Error("repo must look like owner/name.");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-"));
    try {
      const r = spawnSync("git", ["clone", "--depth", "1", "--quiet", `https://github.com/${args.repo}.git`, dir], { stdio: ["ignore", "ignore", "pipe"], timeout: 120000 });
      if (r.status !== 0) throw new Error(`Couldn't clone ${args.repo}: ${r.stderr?.toString().trim() || "git failed"}`);
      graph = analyze(dir, { name: args.repo.split("/")[1] });
      graph.source = args.repo;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } else {
    const dir = path.resolve(args.path || ".");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`"${dir}" isn't a folder.`);
    graph = analyze(dir);
  }
  cache.set(key, graph);
  return graph;
}

async function api(r, p) {
  const res = await fetch(r.url + p, { headers: { authorization: `Bearer ${r.token}`, accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The Plainsight website answered ${res.status}.`);
  return body;
}

async function call(name, args = {}) {
  if (name === "plainsight_scan") { const s = summarize(await load(args, true)); return { text: summaryText(s), structured: s }; }
  if (name === "plainsight_finding") {
    const d = findingDetail(await load(args), args.index);
    if (!d) throw new Error(`There is no finding ${args.index}. Run plainsight_scan to see the numbers.`);
    return { text: d.text, structured: d.finding };
  }
  if (name === "plainsight_parts") { const parts = listParts(await load(args), args.kind); return { text: parts.map((p) => `${p.kind}: ${p.name}${p.file ? ` (${p.file})` : ""}`).join("\n") || "No parts of that kind.", structured: { parts } }; }
  if (name === "plainsight_part") {
    const d = partDetail(await load(args), args.name);
    if (!d) throw new Error(`No part named "${args.name}". Use plainsight_parts to see the names.`);
    return { text: d.text, structured: d.part };
  }
  if (name === "plainsight_maps" && remote()) {
    const { maps } = await api(remote(), "/api/v1/maps");
    return { text: maps.map((m) => `${m.id}  ${m.repo}${m.commit ? ` @ ${m.commit}` : ""}  ${m.counts.fixNow} Fix now, ${m.counts.fixSoon} Fix soon  (${m.createdAt})`).join("\n") || "No maps saved yet.", structured: { maps } };
  }
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // a notification: nothing to answer
  try {
    if (method === "initialize") {
      const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "plainsight", version: VERSION }, instructions: "Plainsight reads a Next.js app's code and reports security holes with the exact lines that prove them. Start with plainsight_scan, then plainsight_finding for receipts and a fix prompt. After changing code, run plainsight_scan again to confirm." } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: tools() } });
    if (method === "tools/call") {
      try {
        const r = await call(params?.name, params?.arguments || {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], structuredContent: r.structured } });
      } catch (e) {
        if (e.code === -32602) throw e;
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.message }], isError: true } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: e.code || -32603, message: e.message } });
  }
}

export function runMcp() {
  // stdout carries the protocol only; anything else goes to stderr
  console.log = (...a) => console.error(...a);
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    chain = chain.then(() => handle(msg));
  });
  return new Promise((resolve) => rl.on("close", () => chain.then(resolve)));
}
