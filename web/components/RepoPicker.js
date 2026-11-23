"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client.mjs";
import { scanRepo } from "@/app/dashboard/actions";

export default function RepoPicker({ repos, repoError, canConnectGithub, privateRepos }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState("");

  const scan = async (name) => {
    setBusy(name); setError(null);
    const r = await scanRepo(name);
    if (r?.id) router.push(`/maps/${r.id}`);
    else { setBusy(null); setError(r?.error || "The scan failed."); }
  };
  const shown = (repos || []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

  return (
    <div className="stack">
      {repos && (
        <>
          {repos.length > 8 && <input type="text" aria-label="Filter your repos" placeholder="Filter your repos" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <div className="repos" role="list">
            {shown.map((r) => (
              <button key={r.fullName} role="listitem" onClick={() => scan(r.fullName)} disabled={!!busy} title={r.description || ""}>
                <span>{r.fullName}{r.private && <span className="muted small"> · private</span>}</span>
                <span className="muted small">{busy === r.fullName ? "Scanning…" : r.language || ""}</span>
              </button>
            ))}
            {!shown.length && <p className="muted small" style={{ padding: 12, margin: 0 }}>{repos.length ? "No repo matches." : "No repos found on your GitHub account."}</p>}
          </div>
          {!privateRepos && <p className="muted small" style={{ margin: 0 }}>Public repos only on this site for now.</p>}
        </>
      )}
      {repoError && <p className="err small">{repoError}</p>}
      {canConnectGithub && (
        <button onClick={() => authClient.linkSocial({ provider: "github", callbackURL: "/dashboard" })} disabled={!!busy}>Connect GitHub to pick from your repos</button>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); scan(typed); }}>
        <input type="text" aria-label="Public repo" placeholder="or any public repo: owner/name" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="primary" type="submit" disabled={!!busy || !typed.trim()}>{busy && busy === typed ? "Scanning…" : "Scan"}</button>
      </form>
      {busy && <p className="muted small" role="status">Scanning {busy}. This usually takes 5–30 seconds.</p>}
      {error && <p className="err small" role="alert">{error}</p>}
    </div>
  );
}
