"use client";
import { useState, useTransition } from "react";
import { newToken, removeToken } from "@/app/dashboard/actions";

export default function Tokens({ tokens }) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="stack">
      {created && (
        <div className="stack" role="status">
          <p className="okc small" style={{ margin: 0 }}>Copy your new token now. It won't be shown again.</p>
          <div className="secret mono" data-testid="new-token">{created.secret}</div>
          <div className="row">
            <button onClick={async () => { await navigator.clipboard.writeText(created.secret); setCopied(true); }}>{copied ? "Copied ✓" : "Copy"}</button>
            <button onClick={() => { setCreated(null); setCopied(false); }}>Done</button>
          </div>
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); start(async () => { setCreated(await newToken(name || "token")); setName(""); setCopied(false); }); }}>
        <input type="text" aria-label="Token name" placeholder="Name it, e.g. my-app CI or Claude Code" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 220 }} maxLength={60} />
        <button className="primary" type="submit" disabled={pending}>Create token</button>
      </form>
      {tokens.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Ends in</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono muted">…{t.hint}</td>
                <td className="muted small">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}</td>
                <td><button className="danger" disabled={pending} onClick={() => { if (confirm(`Revoke "${t.name}"? Anything using it stops working.`)) start(() => removeToken(t.id)); }}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
