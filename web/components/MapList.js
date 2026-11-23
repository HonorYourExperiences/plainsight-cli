"use client";
import { useTransition } from "react";
import { removeMap } from "@/app/dashboard/actions";

const ORIGIN = { web: "Scanned here", upload: "From a workflow", api: "From the API" };

export function Counts({ counts }) {
  if (!counts.fixNow && !counts.fixSoon) return <span className="pill none">No Fix now / Fix soon</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      {counts.fixNow > 0 && <span className="pill crit">{counts.fixNow} Fix now</span>}
      {counts.fixSoon > 0 && <span className="pill warn">{counts.fixSoon} Fix soon</span>}
    </span>
  );
}

export default function MapList({ maps }) {
  const [pending, start] = useTransition();
  if (!maps.length) return <p className="muted">No maps yet. Scan a repo above, or connect a workflow.</p>;
  return (
    <table>
      <thead><tr><th>Repo</th><th>Findings</th><th>From</th><th>When</th><th /></tr></thead>
      <tbody>
        {maps.map((m) => (
          <tr key={m.id}>
            <td><a href={`/maps/${m.id}`}>{m.repo}</a>{m.commit && <span className="muted mono"> @ {m.commit}</span>}</td>
            <td><Counts counts={m.counts} /></td>
            <td className="muted small">{m.runUrl ? <a href={m.runUrl} rel="noopener noreferrer">{ORIGIN[m.origin]}</a> : ORIGIN[m.origin]}</td>
            <td className="muted small"><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></td>
            <td><button className="danger small" disabled={pending} onClick={() => { if (confirm(`Delete the map of ${m.repo}?`)) start(() => removeMap(m.id)); }}>Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
