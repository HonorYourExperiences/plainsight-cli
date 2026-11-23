import { summarize, findingDetail } from "plainsight-cli/agent";
import { apiUser, json, fail, siteUrl } from "@/lib/api.mjs";
import { getMap, deleteMap } from "@/lib/store.mjs";

export const runtime = "nodejs";

// GET /api/v1/maps/:id            summary and numbered findings
// GET /api/v1/maps/:id?finding=2  one finding with receipts and its fix prompt
// GET /api/v1/maps/:id?graph=1    the full graph (what plainsight --json writes)
export async function GET(req, { params }) {
  const userId = await apiUser(req);
  if (!userId) return fail(401, "Send an API token: Authorization: Bearer psk_...");
  const map = await getMap(userId, (await params).id);
  if (!map) return fail(404, "No map with that id.");
  const q = new URL(req.url).searchParams;
  const meta = { id: map.id, repo: map.repo, commit: map.commit, origin: map.origin, runUrl: map.runUrl, createdAt: map.createdAt, url: `${siteUrl(req)}/maps/${map.id}` };
  if (q.get("graph") === "1") return json({ ...meta, graph: map.graph });
  if (q.has("finding")) {
    const d = findingDetail(map.graph, Number(q.get("finding")));
    return d ? json({ ...meta, finding: d.finding }) : fail(404, "No finding with that number.");
  }
  return json({ ...meta, summary: summarize(map.graph) });
}

export async function DELETE(req, { params }) {
  const userId = await apiUser(req);
  if (!userId) return fail(401, "Send an API token: Authorization: Bearer psk_...");
  return (await deleteMap(userId, (await params).id)) ? json({ deleted: true }) : fail(404, "No map with that id.");
}
