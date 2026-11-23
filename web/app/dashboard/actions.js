"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth.mjs";
import { scanGithubRepo, REPO_NAME } from "@/lib/scan.mjs";
import { saveMap, deleteMap, githubToken, scansToday, SCANS_PER_DAY, createToken, deleteToken } from "@/lib/store.mjs";

async function user() {
  const u = await currentUser(await headers());
  if (!u) throw new Error("Sign in first.");
  return u;
}

// accepts owner/name or a github.com URL
export async function scanRepo(input) {
  try {
    const u = await user();
    const fullName = String(input || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!REPO_NAME.test(fullName)) return { error: "Enter a GitHub repo as owner/name, e.g. vercel/nextjs-subscription-payments." };
    if ((await scansToday(u.id)) >= SCANS_PER_DAY) return { error: `You've run ${SCANS_PER_DAY} scans in the last day. Try again later, or run npx plainsight-cli locally.` };
    // the user's own GitHub token, when connected: reaches their private repos (if allowed) and a higher rate limit
    const graph = await scanGithubRepo(fullName, { token: await githubToken(u.id) });
    const id = await saveMap(u.id, { repo: fullName, commit: graph.commit, origin: "web", graph });
    revalidatePath("/dashboard");
    return { id };
  } catch (e) {
    console.error("[plainsight] scan failed:", e);
    return { error: e.message };
  }
}

export async function removeMap(id) {
  const u = await user();
  await deleteMap(u.id, id);
  revalidatePath("/dashboard");
}

export async function newToken(name) {
  const u = await user();
  const t = await createToken(u.id, name);
  revalidatePath("/settings");
  return t;
}

export async function removeToken(id) {
  const u = await user();
  await deleteToken(u.id, id);
  revalidatePath("/settings");
}
