import { summarize } from "plainsight-cli/agent";
import { apiUser, json, fail, siteUrl } from "@/lib/api.mjs";
import { scanGithubRepo, REPO_NAME } from "@/lib/scan.mjs";
import { saveMap, githubToken, scansToday, SCANS_PER_DAY } from "@/lib/store.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/v1/analyze  { "repo": "owner/name" }  scan a GitHub repo and save its map
export async function POST(req) {
  const userId = await apiUser(req);
  if (!userId) return fail(401, "Send an API token: Authorization: Bearer psk_...");
  let body;
  try { body = await req.json(); } catch { return fail(400, "Send JSON: { \"repo\": \"owner/name\" }"); }
  const repo = String(body?.repo || "").trim();
  if (!REPO_NAME.test(repo)) return fail(400, "repo must look like owner/name.");
  if ((await scansToday(userId)) >= SCANS_PER_DAY) return fail(429, `Limit of ${SCANS_PER_DAY} scans a day reached.`);
  try {
    const graph = await scanGithubRepo(repo, { token: await githubToken(userId) });
    const id = await saveMap(userId, { repo, commit: graph.commit, origin: "api", graph });
    return json({ id, url: `${siteUrl(req)}/maps/${id}`, summary: summarize(graph) }, 201);
  } catch (e) {
    return fail(/busy/.test(e.message) ? 503 : 422, e.message);
  }
}
