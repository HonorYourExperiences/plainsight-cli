import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, providers, privateRepos } from "@/lib/auth.mjs";
import { listMaps, githubAccount } from "@/lib/store.mjs";
import { listGithubRepos } from "@/lib/scan.mjs";
import Header from "@/components/Header";
import RepoPicker from "@/components/RepoPicker";
import MapList from "@/components/MapList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your maps · Plainsight" };

export default async function Dashboard() {
  const user = await currentUser(await headers());
  if (!user) redirect("/");
  const [maps, gh] = await Promise.all([listMaps(user.id), githubAccount(user.id)]);
  const includePrivate = privateRepos && !!gh?.privateRepos;
  let repos = null, repoError = null;
  if (gh) {
    try { repos = await listGithubRepos(gh.token, { includePrivate }); } catch (e) { repoError = e.message; }
  }
  return (
    <>
      <Header user={user} current="dashboard" />
      <main className="wrap">
        <h1>Your maps</h1>
        <p className="lead">Pick a repo to draw its map and check it for holes. The code is downloaded for the scan and deleted right after; only the map is kept.</p>
        <div className="grid2">
          <section className="panel" aria-labelledby="scan-h">
            <h2 id="scan-h">Scan a repo</h2>
            <RepoPicker repos={repos} repoError={repoError} canConnectGithub={providers.github && !gh} privateShown={includePrivate} canAddPrivate={privateRepos && !!gh && !includePrivate} />
          </section>
          <section className="panel" aria-labelledby="ci-h">
            <h2 id="ci-h">Every push, automatically</h2>
            <p className="muted small">Add the Plainsight GitHub Action to a repo and each run's map lands here, and it can block a pull request that opens a hole. AI agents can read your maps too.</p>
            <a className="btn" href="/settings">Connect workflows and agents</a>
          </section>
        </div>
        <section className="panel" aria-labelledby="maps-h">
          <h2 id="maps-h">Maps {maps.length ? <span className="muted">· {maps.length}</span> : null}</h2>
          <MapList maps={maps} />
        </section>
      </main>
    </>
  );
}
