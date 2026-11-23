// Maps and API tokens. A token is shown once and stored only as a SHA-256 hash.
import crypto from "node:crypto";
import { summarize } from "plainsight-cli/agent";
import { getDb } from "./db.mjs";
import { getAuth } from "./auth.mjs";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const MAX_GRAPH_BYTES = 10 * 1024 * 1024;
export const SCANS_PER_DAY = 40;

async function db() { await getAuth(); return (await getDb()).db; } // getAuth creates the tables

// ---------- maps ----------
export function looksLikeGraph(g) {
  return !!g && typeof g === "object" && Array.isArray(g.nodes) && Array.isArray(g.edges) && Array.isArray(g.findings) && typeof g.analyzer === "string" && g.analyzer.startsWith("plainsight");
}

export async function saveMap(userId, { repo, commit, origin, runUrl, graph }) {
  const json = JSON.stringify(graph);
  if (Buffer.byteLength(json) > MAX_GRAPH_BYTES) throw new Error("That map is larger than 10 MB.");
  const row = { id: id("map"), userId, repo: String(repo).slice(0, 200), commitSha: commit ? String(commit).slice(0, 40) : null, origin, runUrl: runUrl ? String(runUrl).slice(0, 500) : null, summary: JSON.stringify(summarize(graph)), graph: json, createdAt: now() };
  await (await db()).insertInto("plainsight_map").values(row).execute();
  return row.id;
}

const head = (r) => { const s = JSON.parse(r.summary); return { id: r.id, repo: r.repo, commit: r.commitSha, origin: r.origin, runUrl: r.runUrl, createdAt: r.createdAt, counts: s.counts, parts: s.parts }; };

export async function listMaps(userId, { limit = 100 } = {}) {
  const rows = await (await db()).selectFrom("plainsight_map").select(["id", "repo", "commitSha", "origin", "runUrl", "summary", "createdAt"]).where("userId", "=", userId).orderBy("createdAt", "desc").limit(limit).execute();
  return rows.map(head);
}

export async function getMap(userId, mapId) {
  const r = await (await db()).selectFrom("plainsight_map").selectAll().where("id", "=", String(mapId)).where("userId", "=", userId).executeTakeFirst();
  return r ? { ...head(r), graph: JSON.parse(r.graph) } : null;
}

export async function deleteMap(userId, mapId) {
  const r = await (await db()).deleteFrom("plainsight_map").where("id", "=", String(mapId)).where("userId", "=", userId).executeTakeFirst();
  return Number(r.numDeletedRows) > 0;
}

export async function scansToday(userId) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const r = await (await db()).selectFrom("plainsight_map").select((eb) => eb.fn.countAll().as("n")).where("userId", "=", userId).where("origin", "in", ["web", "api"]).where("createdAt", ">", since).executeTakeFirst();
  return Number(r?.n || 0);
}

// ---------- API tokens ----------
export async function createToken(userId, name) {
  const secret = `psk_${crypto.randomBytes(24).toString("base64url")}`;
  const row = { id: id("tok"), userId, name: String(name || "token").trim().slice(0, 60) || "token", hash: sha256(secret), hint: secret.slice(-4), createdAt: now(), lastUsedAt: null };
  await (await db()).insertInto("plainsight_token").values(row).execute();
  return { id: row.id, name: row.name, secret };
}

export async function listTokens(userId) {
  return (await db()).selectFrom("plainsight_token").select(["id", "name", "hint", "createdAt", "lastUsedAt"]).where("userId", "=", userId).orderBy("createdAt", "desc").execute();
}

export async function deleteToken(userId, tokenId) {
  await (await db()).deleteFrom("plainsight_token").where("id", "=", String(tokenId)).where("userId", "=", userId).execute();
}

// Returns the user id behind "Authorization: Bearer psk_...", or null.
export async function userFromBearer(header) {
  const m = /^Bearer\s+(psk_[A-Za-z0-9_-]{20,})\s*$/.exec(header || "");
  if (!m) return null;
  const d = await db();
  const row = await d.selectFrom("plainsight_token").select(["id", "userId"]).where("hash", "=", sha256(m[1])).executeTakeFirst();
  if (!row) return null;
  await d.updateTable("plainsight_token").set({ lastUsedAt: now() }).where("id", "=", row.id).execute();
  return row.userId;
}

// ---------- GitHub ----------
export async function githubToken(userId) {
  const r = await (await db()).selectFrom("account").select(["accessToken"]).where("userId", "=", userId).where("providerId", "=", "github").executeTakeFirst();
  return r?.accessToken || null;
}
