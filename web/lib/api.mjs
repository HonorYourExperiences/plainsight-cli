// Shared helpers for /api/v1: who is calling (an API token, or the signed-in browser) and JSON replies.
import { currentUser } from "./auth.mjs";
import { userFromBearer } from "./store.mjs";

export const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const fail = (status, error) => json({ error }, status);

export async function apiUser(req) {
  const auth = req.headers.get("authorization");
  if (auth) return userFromBearer(auth); // a bad token is a failure, never a fallback to cookies
  // the signed-in browser may read (e.g. "Download JSON"); changes need a token, so no other site can make them
  if (req.method !== "GET") return null;
  return (await currentUser(req.headers))?.id || null;
}

export const siteUrl = (req) => (process.env.BETTER_AUTH_URL || new URL(req.url).origin).replace(/\/+$/, "");
