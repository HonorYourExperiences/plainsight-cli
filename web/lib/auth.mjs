// Sign-in: Google, GitHub and email (a one-time link, no password to leak).
// A provider shows up only when its keys are set, so the site runs locally with email alone.
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins/magic-link";
import { nextCookies } from "better-auth/next-js";
import { getDb, ensurePlainsightTables } from "./db.mjs";
import { sendSignInEmail } from "./mail.mjs";

export const providers = {
  google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  email: true,
};
// Private repos need GitHub's broad "repo" scope, so it's off unless the site owner turns it on.
export const privateRepos = process.env.PLAINSIGHT_GITHUB_PRIVATE_REPOS === "1";

const g = globalThis.__plainsightAuth || (globalThis.__plainsightAuth = {});

function options(db, type) {
  return {
    appName: "Plainsight",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    database: { db, type },
    telemetry: { enabled: false },
    socialProviders: {
      ...(providers.google && { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }),
      ...(providers.github && { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, scope: privateRepos ? ["repo"] : [] } }),
    },
    // signing in with Google and later GitHub (same verified email) lands in one account
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "github"] } },
    plugins: [magicLink({ expiresIn: 60 * 10, sendMagicLink: ({ email, url }) => sendSignInEmail(email, url) }), nextCookies()],
  };
}

export async function getAuth() {
  if (g.auth) return g.auth;
  if (!g.ready) g.ready = (async () => {
    if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") throw new Error("Set BETTER_AUTH_SECRET (32+ random characters).");
    const { db, type } = await getDb();
    const opts = options(db, type);
    const { runMigrations } = await getMigrations(opts);
    await runMigrations();
    await ensurePlainsightTables(db);
    g.auth = betterAuth(opts);
    return g.auth;
  })();
  return g.ready;
}

export async function currentUser(headers) {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers });
  return s?.user || null;
}
