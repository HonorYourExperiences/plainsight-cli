import { apiUser, json, fail, siteUrl } from "@/lib/api.mjs";
import { listMaps, saveMap, looksLikeGraph, MAX_GRAPH_BYTES } from "@/lib/store.mjs";

export const runtime = "nodejs";

// GET /api/v1/maps: your maps, newest first
export async function GET(req) {
  const userId = await apiUser(req);
  if (!userId) return fail(401, "Send an API token: Authorization: Bearer psk_...");
  return json({ maps: await listMaps(userId) });
}

// POST /api/v1/maps: save a map made elsewhere (the CLI's --upload, the GitHub Action)
// body: { repo, commit?, run?, graph }
export async function POST(req) {
  const userId = await apiUser(req);
  if (!userId) return fail(401, "Send an API token: Authorization: Bearer psk_...");
  if (Number(req.headers.get("content-length")) > MAX_GRAPH_BYTES + 100_000) return fail(413, "That map is larger than 10 MB.");
  let body;
  try { body = await req.json(); } catch { return fail(400, "Send JSON."); }
  if (!looksLikeGraph(body?.graph)) return fail(400, "graph must be Plainsight output (plainsight --json).");
  const repo = String(body.repo || body.graph.source || body.graph.app || "").trim();
  if (!repo) return fail(400, "Say which repo the map is of (repo).");
  const run = typeof body.run === "string" && /^https:\/\/github\.com\//.test(body.run) ? body.run : null;
  try {
    const id = await saveMap(userId, { repo, commit: body.commit || body.graph.commit, origin: "upload", runUrl: run, graph: body.graph });
    return json({ id, url: `${siteUrl(req)}/maps/${id}` }, 201);
  } catch (e) {
    return fail(400, e.message);
  }
}
