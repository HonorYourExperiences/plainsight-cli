import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.mjs";
import { listTokens } from "@/lib/store.mjs";
import Header from "@/components/Header";
import Tokens from "@/components/Tokens";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect · Plainsight" };

export default async function Settings() {
  const h = await headers();
  const user = await currentUser(h);
  if (!user) redirect("/");
  const tokens = await listTokens(user.id);
  const site = (process.env.BETTER_AUTH_URL || `${h.get("x-forwarded-proto") || "http"}://${h.get("host")}`).replace(/\/+$/, "");
  const T = "<your token>";
  return (
    <>
      <Header user={user} current="settings" />
      <main className="wrap">
        <h1>Connect workflows and agents</h1>
        <p className="lead">An API token lets your GitHub workflows send maps here and lets AI agents read them. Treat it like a password: anyone with it can see your maps.</p>

        <section className="panel" aria-labelledby="tok-h">
          <h2 id="tok-h">API tokens</h2>
          <Tokens tokens={tokens.map((t) => ({ ...t }))} />
        </section>

        <section className="panel" aria-labelledby="ci-h">
          <h2 id="ci-h">GitHub workflow</h2>
          <p className="muted small">Save a token as the repo secret <code>PLAINSIGHT_TOKEN</code> (repo Settings → Secrets and variables → Actions), then add this workflow. Every push and pull request gets a map here, a summary in the check, and a failed check if it opens a Fix now hole.</p>
          <pre>{`# .github/workflows/plainsight.yml
name: plainsight
on: [push, pull_request]
jobs:
  plainsight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: HonorYourExperiences/plainsight-cli@v0.3.1
        with:
          fail-on: crit
          upload-url: ${site}
          upload-token: \${{ secrets.PLAINSIGHT_TOKEN }}`}</pre>
          <p className="muted small">Pull requests from forks don't get repo secrets, so their maps stay in the check only.</p>
        </section>

        <section className="panel" aria-labelledby="mcp-h">
          <h2 id="mcp-h">AI agents (MCP)</h2>
          <p className="muted small">Plainsight runs as an MCP server on your machine. Agents can scan the code they're working on (it never leaves your machine), read each finding's receipts and fix prompt, rescan to confirm a fix, and, with a token, read the maps saved here.</p>
          <p className="small"><strong>Claude Code</strong></p>
          <pre>{`claude mcp add plainsight -e PLAINSIGHT_URL=${site} -e PLAINSIGHT_TOKEN=${T} -- npx -y plainsight-cli mcp`}</pre>
          <p className="small"><strong>Cursor, Windsurf and other MCP clients</strong> (<code>.cursor/mcp.json</code> or the client's MCP settings)</p>
          <pre>{JSON.stringify({ mcpServers: { plainsight: { command: "npx", args: ["-y", "plainsight-cli", "mcp"], env: { PLAINSIGHT_URL: site, PLAINSIGHT_TOKEN: T } } } }, null, 2)}</pre>
          <p className="muted small">Leave out the two variables to use it on local code only. Tools: <code>plainsight_scan</code>, <code>plainsight_finding</code>, <code>plainsight_parts</code>, <code>plainsight_part</code>, <code>plainsight_maps</code>.</p>
        </section>

        <section className="panel" aria-labelledby="api-h">
          <h2 id="api-h">REST API</h2>
          <pre>{`# your maps
curl -H "Authorization: Bearer ${T}" ${site}/api/v1/maps
# one map's findings, then one finding with its receipts and fix prompt
curl -H "Authorization: Bearer ${T}" ${site}/api/v1/maps/<id>
curl -H "Authorization: Bearer ${T}" "${site}/api/v1/maps/<id>?finding=0"
# scan a GitHub repo
curl -X POST -H "Authorization: Bearer ${T}" -H "content-type: application/json" \\
     -d '{"repo":"owner/name"}' ${site}/api/v1/analyze`}</pre>
        </section>
      </main>
    </>
  );
}
