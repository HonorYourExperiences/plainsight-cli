// Storage rules the website depends on: tokens, ownership, uploads, the GitHub repo list.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-web-test-"));
process.env.DATABASE_URL = path.join(dir, "test.db");
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

let store, scan, graph;
before(async () => {
  store = await import("../lib/store.mjs");
  scan = await import("../lib/scan.mjs");
  graph = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "fixtures", "tidy.graph.json"), "utf8"));
});

test("a token is shown once, stored only as a hash, and identifies its owner", async () => {
  const t = await store.createToken("user_a", "ci");
  assert.match(t.secret, /^psk_[A-Za-z0-9_-]{32}$/);
  const { db } = await (await import("../lib/db.mjs")).getDb();
  const row = await db.selectFrom("plainsight_token").selectAll().where("id", "=", t.id).executeTakeFirst();
  assert.notEqual(row.hash, t.secret);
  assert.ok(!JSON.stringify(row).includes(t.secret), "the secret itself is never stored");
  assert.equal(await store.userFromBearer(`Bearer ${t.secret}`), "user_a");
  assert.equal(await store.userFromBearer(`Bearer ${t.secret}x`), null);
  assert.equal(await store.userFromBearer(t.secret), null, "needs the Bearer scheme");
  assert.equal(await store.userFromBearer("Bearer psk_short"), null);
  await store.deleteToken("user_b", t.id);
  assert.equal(await store.userFromBearer(`Bearer ${t.secret}`), "user_a", "someone else can't revoke it");
  await store.deleteToken("user_a", t.id);
  assert.equal(await store.userFromBearer(`Bearer ${t.secret}`), null, "revoked tokens stop working");
});

test("maps belong to the user who saved them", async () => {
  const id = await store.saveMap("user_a", { repo: "acme/tidy", commit: "abc1234", origin: "upload", graph });
  assert.equal((await store.getMap("user_a", id)).graph.findings.length, graph.findings.length);
  assert.equal(await store.getMap("user_b", id), null);
  assert.ok(!(await store.listMaps("user_b")).some((m) => m.id === id));
  assert.equal(await store.deleteMap("user_b", id), false);
  const [head] = await store.listMaps("user_a");
  assert.equal(head.id, id);
  assert.deepEqual(head.counts, { fixNow: 2, fixSoon: 1, review: 3 });
  assert.equal(await store.deleteMap("user_a", id), true);
  assert.equal(await store.getMap("user_a", id), null);
});

test("only Plainsight graphs under 10 MB are accepted", async () => {
  assert.equal(store.looksLikeGraph(graph), true);
  for (const bad of [null, {}, { nodes: [], edges: [], findings: [] }, { ...graph, analyzer: "other" }, { ...graph, nodes: "x" }]) assert.equal(store.looksLikeGraph(bad), false);
  const huge = { ...graph, padding: "x".repeat(store.MAX_GRAPH_BYTES) };
  await assert.rejects(store.saveMap("user_a", { repo: "a/b", origin: "upload", graph: huge }), /larger than 10 MB/);
});

test("repo names are checked before anything is fetched", async () => {
  for (const ok of ["vercel/next.js", "a-b/c_d.e"]) assert.ok(scan.REPO_NAME.test(ok), ok);
  for (const bad of ["../etc/passwd", "a/b/c", "a", "a b/c", "a/b?x=1", "https://github.com/a/b"]) assert.ok(!scan.REPO_NAME.test(bad), bad);
  await assert.rejects(scan.scanGithubRepo("../../x"), /owner\/name/);
});

test("the repo picker lists public repos by default and asks GitHub for private ones only when allowed", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push([String(url), opts.headers.authorization]);
    return new Response(JSON.stringify([{ full_name: "me/app", private: false, description: null, language: "TypeScript", pushed_at: "2026-11-01T00:00:00Z" }]), { status: 200 });
  };
  try {
    const repos = await scan.listGithubRepos("gho_test", { includePrivate: false });
    assert.deepEqual(repos.map((r) => r.fullName), ["me/app"]);
    assert.match(calls[0][0], /visibility=public/);
    assert.equal(calls[0][1], "Bearer gho_test");
    await scan.listGithubRepos("gho_test", { includePrivate: true });
    assert.match(calls[1][0], /visibility=all/);
  } finally { globalThis.fetch = realFetch; }
});
