import { renderReport } from "@/lib/cli.mjs";
import { currentUser } from "@/lib/auth.mjs";
import { getMap } from "@/lib/store.mjs";

export const runtime = "nodejs";

export async function GET(req, { params }) {
  const user = await currentUser(req.headers);
  if (!user) return new Response("Sign in to see this map.", { status: 401 });
  const map = await getMap(user.id, (await params).id);
  if (!map) return new Response("Not found.", { status: 404 });
  return new Response(await renderReport([map.graph], { offline: true, webFonts: true }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // even opened directly, the report runs in an opaque origin with no access to the site's cookies or APIs
      "content-security-policy": "sandbox allow-scripts allow-popups allow-downloads",
      "cache-control": "private, no-store",
    },
  });
}
