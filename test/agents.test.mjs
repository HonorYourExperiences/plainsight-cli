// `plainsight mcp` (for AI agents) and `--upload` (for workflows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.mjs";
import { summarize, summaryText, findingDetail, partDetail, listParts } from "../src/agent.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tidy = path.join(root, "fixtures", "tidy");
const bin = path.join(root, "bin", "plainsight.mjs");
const g = analyze(tidy);

test("agent summary numbers the findings, worst first, with where they are", () => {
  const s = summarize(g);
  assert.equal(s.findings.length, g.findings.length);
  assert.deepEqual(s.findings.map((f) => f.sev), [...s.findings.map((f) => f.sev)].sort((a, b) => ["crit", "warn", "info"].indexOf(a) - ["crit", "warn", "info"].indexOf(b)));
  assert.equal(s.counts.fixNow, g.findings.filter((f) => f.sev === "crit").length);
  for (const f of s.findings) assert.equal(g.findings[f.index].title, f.title, "the number points at the same finding");
  assert.match(summaryText(s), /\[\d+\] Fix now: Anyone can read other people's Habit records \(GET \/api\/habits\) at app\/api\/habits\/route\.ts:6/);
});

test("agent finding detail has receipts and the fix prompt, with keys masked", () => {
  const i = g.findings.findIndex((f) => f.rule === "secret-in-browser");
  const d = findingDetail(g, i);
  assert.match(d.text, /lib\/stripe\.ts:3/);
  assert.match(d.text, /Plainsight \(a code checker\) found a problem/);
  assert.equal(findingDetail(g, 999), null);
  const key = /sk_live_[A-Za-z0-9]{12,}/;
  assert.ok(!key.test(d.finding.fix), "the fix prompt carries no full key");
});

test("agent part detail shows pipes both ways and findings on the part", () => {
  const d = partDetail(g, "GET /api/habits");
  assert.ok(d, "found by its listed name");
  assert.ok(d.part.incoming.some((p) => p.other === "/dashboard"));
  assert.ok(d.part.outgoing.some((p) => p.other === "Habit"));
  assert.ok(d.part.findings.length >= 1);
  assert.equal(partDetail(g, "no such part"), null);
  assert.ok(listParts(g, "table").every((p) => p.kind === "table"));
});

function mcp(messages, env = {}) {
  const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [bin, "mcp"], { input, cwd: root, env: { ...process.env, PLAINSIGHT_URL: "", PLAINSIGHT_TOKEN: "", ...env }, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").map((l) => JSON.parse(l));
}

test("mcp: speaks the protocol and answers every tool on a local folder", () => {
  const out = mcp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plainsight_scan", arguments: { path: "fixtures/tidy" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "plainsight_finding", arguments: { path: "fixtures/tidy", index: 0 } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "plainsight_part", arguments: { path: "fixtures/tidy", name: "Habit" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "plainsight_finding", arguments: { path: "fixtures/tidy", index: 99 } } },
    { jsonrpc: "2.0", id: 7, method: "nope" },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "plainsight_scan", arguments: { path: "fixtures/tidy", repo: "a/b" } } },
  ]);
  const by = Object.fromEntries(out.map((m) => [m.id, m]));
  assert.equal(out.length, 8, "notifications get no reply");
  assert.equal(by[1].result.protocolVersion, "2025-06-18");
  assert.equal(by[1].result.serverInfo.name, "plainsight");
  assert.deepEqual(by[2].result.tools.map((t) => t.name), ["plainsight_scan", "plainsight_finding", "plainsight_parts", "plainsight_part"], "no website tool without a token");
  assert.match(by[3].result.content[0].text, /Findings: 2 Fix now/);
  assert.equal(by[3].result.structuredContent.counts.fixNow, 2);
  assert.match(by[4].result.content[0].text, /Fix prompt/);
  assert.match(by[5].result.content[0].text, /Comes in from:/);
  assert.equal(by[6].result.isError, true);
  assert.equal(by[7].error.code, -32601);
  assert.equal(by[8].result.isError, true, "one source at a time");
});

test("mcp: offers website maps only with a token, and reads them with it", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push([req.url, req.headers.authorization]);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/maps") return res.end(JSON.stringify({ maps: [{ id: "map_1", repo: "acme/tidy", commit: "abc1234", counts: { fixNow: 2, fixSoon: 1, review: 3 }, createdAt: "2026-11-22T00:00:00Z" }] }));
    if (req.url === "/api/v1/maps/map_1?graph=1") return res.end(JSON.stringify({ graph: g }));
    res.statusCode = 404; res.end(JSON.stringify({ error: "No map with that id." }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plainsight_maps", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "plainsight_scan", arguments: { map: "map_1" } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "plainsight_scan", arguments: { map: "map_404" } } },
    ].map((m) => JSON.stringify(m)).join("\n") + "\n";
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [bin, "mcp"], { cwd: root, env: { ...process.env, PLAINSIGHT_URL: url + "/", PLAINSIGHT_TOKEN: "psk_test" } });
      let s = ""; p.stdout.on("data", (d) => (s += d)); p.on("error", reject);
      p.on("close", () => resolve(s.trim().split("\n").map((l) => JSON.parse(l))));
      p.stdin.end(input);
    });
    const by = Object.fromEntries(out.map((m) => [m.id, m]));
    assert.ok(by[2].result.tools.some((t) => t.name === "plainsight_maps"));
    assert.match(by[3].result.content[0].text, /map_1\s+acme\/tidy @ abc1234\s+2 Fix now/);
    assert.match(by[4].result.content[0].text, /Findings: 2 Fix now/);
    assert.equal(by[5].result.isError, true);
    assert.match(by[5].result.content[0].text, /No map with that id/);
    assert.ok(seen.every(([, auth]) => auth === "Bearer psk_test"), "every request carries the token");
  } finally { server.close(); }
});

function upload(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [bin, tidy, "--no-report", "--upload", "--quiet"], { cwd: root, env: { ...process.env, GITHUB_REPOSITORY: "", GITHUB_SHA: "", GITHUB_RUN_ID: "", ...env } });
    let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("error", reject); p.on("close", (code) => resolve({ code, out, err }));
  });
}

test("--upload sends the map with the token and names it after the GitHub repo and commit", async () => {
  let got = null;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => { got = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }; res.setHeader("content-type", "application/json"); res.statusCode = 201; res.end(JSON.stringify({ id: "map_x", url: "http://site/maps/map_x" })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await upload({ PLAINSIGHT_URL: `http://127.0.0.1:${server.address().port}`, PLAINSIGHT_TOKEN: "psk_abc", GITHUB_REPOSITORY: "acme/tidy", GITHUB_SHA: "abcdef1234567", GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "7" });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Map:\s+http:\/\/site\/maps\/map_x/);
    assert.equal(got.url, "/api/v1/maps");
    assert.equal(got.auth, "Bearer psk_abc");
    assert.equal(got.body.repo, "acme/tidy");
    assert.equal(got.body.commit, "abcdef1");
    assert.equal(got.body.run, "https://github.com/acme/tidy/actions/runs/7");
    assert.equal(got.body.graph.findings.length, g.findings.length);
  } finally { server.close(); }
});

test("--upload problems warn but never fail the build on their own", async () => {
  const missing = await upload({ PLAINSIGHT_URL: "", PLAINSIGHT_TOKEN: "" });
  assert.equal(missing.code, 0);
  assert.match(missing.err, /needs PLAINSIGHT_URL and PLAINSIGHT_TOKEN/);
  const refused = await upload({ PLAINSIGHT_URL: "http://127.0.0.1:9", PLAINSIGHT_TOKEN: "psk_abc" });
  assert.equal(refused.code, 0);
  assert.match(refused.err, /upload failed/);
});
