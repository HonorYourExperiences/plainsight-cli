// Analyze a GitHub repo on the server: download one snapshot, run the Plainsight CLI on it in
// a separate process, keep only the resulting map, and delete the code straight away.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

import { cliBin } from "./cli.mjs";

const MAX_DOWNLOAD = 150 * 1024 * 1024; // a Next.js app's source is far smaller; this stops abuse
const MAX_RUNNING = 2;
let running = 0;

export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function run(cmd, args, { timeout }) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
    const t = setTimeout(() => p.kill("SIGKILL"), timeout);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    // report the first real error line, not Node's trailing version banner
    const why = () => err.split("\n").map((l) => l.trim()).find((l) => /error/i.test(l)) || err.trim().split("\n")[0] || "";
    p.on("close", (code, signal) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(signal ? "it took too long" : why() || `exit ${code}`)); });
  });
}

export async function scanGithubRepo(fullName, { token } = {}) {
  if (!REPO_NAME.test(fullName)) throw new Error("A repo looks like owner/name.");
  if (running >= MAX_RUNNING) throw new Error("Plainsight is busy with other scans. Try again in a minute.");
  running++;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-web-"));
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/tarball`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "plainsight-web", ...(token && { authorization: `Bearer ${token}` }) },
      redirect: "follow",
    });
    if (res.status === 404) throw new Error(`Couldn't find ${fullName}. If it's private, connect GitHub with access to it.`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${fullName}.`);
    if (Number(res.headers.get("content-length")) > MAX_DOWNLOAD) throw new Error("That repo is too large to scan here. Run npx plainsight-cli on your machine instead.");
    const archive = path.join(work, "repo.tar.gz");
    let size = 0;
    const capped = Readable.fromWeb(res.body).map((chunk) => {
      size += chunk.length;
      if (size > MAX_DOWNLOAD) throw new Error("That repo is too large to scan here. Run npx plainsight-cli on your machine instead.");
      return chunk;
    });
    await pipeline(capped, fs.createWriteStream(archive));

    const out = path.join(work, "src");
    fs.mkdirSync(out);
    // unpacked in JavaScript, so it works on hosts without a tar program (Vercel); entries that
    // try to leave the folder (absolute paths, "..") are refused by the library
    await tar.x({ file: archive, cwd: out, strict: true });
    fs.rmSync(archive);
    const [top] = fs.readdirSync(out); // GitHub names it owner-repo-<commit>
    if (!top) throw new Error("The download was empty.");
    const commit = (top.match(/-([0-9a-f]{7,40})$/) || [])[1]?.slice(0, 7) || null;
    // name the folder after the repo, so the map and its fix prompts say "my app <name>"
    const appDir = path.join(out, fullName.split("/")[1]);
    fs.renameSync(path.join(out, top), appDir);

    const json = path.join(work, "graph.json");
    await run(process.execPath, [cliBin(), appDir, "--json", json, "--no-report", "--quiet"], { timeout: 120_000 }).catch((e) => { throw new Error(`The analysis failed: ${e.message}`); });
    const graph = JSON.parse(fs.readFileSync(json, "utf8"));
    graph.source = fullName;
    graph.commit = commit;
    return graph;
  } finally {
    running--;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Repos the signed-in user can pick from (needs their GitHub sign-in).
export async function listGithubRepos(token, { includePrivate }) {
  const repos = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&visibility=${includePrivate ? "all" : "public"}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "plainsight-web", authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("GitHub sign-in expired. Connect GitHub again.");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const batch = await res.json();
    repos.push(...batch.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, language: r.language, pushedAt: r.pushed_at })));
    if (batch.length < 100) break;
  }
  return repos;
}
