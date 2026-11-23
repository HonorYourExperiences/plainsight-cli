// Turns a graph into answers an AI agent can use: a short summary, one finding with
// its receipts and fix prompt, the parts of the app, and one part with its pipes.
// Shared by `plainsight mcp` and the website's API, so both answer the same way.

export const SEVERITY = { crit: "Fix now", warn: "Fix soon", info: "Review" };
const KIND = { page: "page", module: "browser module", route: "API route", action: "server action", table: "table", storage: "saved-data key", service: "outside service", host: "outside address", unknown: "unresolved address" };

export function partLabel(graph, id) {
  const n = (graph.nodes || []).find((x) => x.id === id);
  if (!n) return "";
  return n.kind === "route" && n.method && n.method !== "ANY" ? `${n.method} ${n.name}` : n.name;
}

const where = (f) => {
  const e = f.evidence?.[f.evidence.length - 1];
  return e ? `${e.file}:${e.line}` : f.file || "";
};

export function summarize(graph) {
  const parts = {};
  for (const n of graph.nodes || []) if (!n.layout) parts[n.kind] = (parts[n.kind] || 0) + 1;
  const order = { crit: 0, warn: 1, info: 2 };
  const findings = (graph.findings || [])
    .map((f, index) => ({ index, severity: SEVERITY[f.sev] || "Review", sev: f.sev, rule: f.rule || null, title: f.title, part: partLabel(graph, f.node) || null, where: where(f) }))
    .sort((a, b) => order[a.sev] - order[b.sev] || a.index - b.index);
  return {
    app: graph.app, commit: graph.commit || null, source: graph.source || null, analyzer: graph.analyzer, generatedAt: graph.generatedAt,
    parts, pipes: (graph.edges || []).length,
    counts: { fixNow: findings.filter((f) => f.sev === "crit").length, fixSoon: findings.filter((f) => f.sev === "warn").length, review: findings.filter((f) => f.sev === "info").length },
    findings,
  };
}

export function summaryText(s) {
  const parts = Object.entries(s.parts).map(([k, v]) => `${v} ${KIND[k] || k}${v === 1 ? "" : "s"}`).join(", ");
  const lines = [
    `Plainsight map of ${s.app}${s.commit ? ` @ ${s.commit}` : ""}: ${parts || "no parts recognised"}; ${s.pipes} pipes.`,
    `Findings: ${s.counts.fixNow} Fix now, ${s.counts.fixSoon} Fix soon, ${s.counts.review} Review.`,
  ];
  for (const f of s.findings) lines.push(`  [${f.index}] ${f.severity}: ${f.title}${f.part ? ` (${f.part})` : ""}${f.where ? ` at ${f.where}` : ""}`);
  if (s.findings.length) lines.push("", "Get the code receipts and a ready-to-use fix prompt for one finding with plainsight_finding and its number.");
  else lines.push("", "No findings from the checks this version runs. That isn't a clean bill of health: Plainsight reads structure, not behavior.");
  return lines.join("\n");
}

export function findingDetail(graph, index) {
  const f = (graph.findings || [])[index];
  if (!f) return null;
  const out = [`${SEVERITY[f.sev] || "Review"}: ${f.title}`];
  const part = partLabel(graph, f.node);
  if (part) out.push(`Part: ${part}`);
  if (f.rule) out.push(`Rule: ${f.rule}`);
  out.push("", f.text);
  for (const e of f.evidence || []) out.push("", `${e.file}:${e.line}${e.endLine && e.endLine !== e.line ? `-${e.endLine}` : ""}`, ...(e.code || "").split("\n").map((l) => "    " + l));
  if (f.fix) out.push("", "Fix prompt (already masked for secrets):", "", f.fix);
  return { finding: { index, severity: SEVERITY[f.sev], rule: f.rule || null, title: f.title, part: part || null, text: f.text, evidence: f.evidence || [], fix: f.fix || null }, text: out.join("\n") };
}

export function listParts(graph, kind) {
  return (graph.nodes || []).filter((n) => !n.layout && (!kind || n.kind === kind))
    .map((n) => ({ id: n.id, kind: n.kind, name: partLabel(graph, n.id), file: n.file || null, line: n.line || null }));
}

export function partDetail(graph, query) {
  const q = String(query || "").trim().toLowerCase();
  const nodes = (graph.nodes || []).filter((n) => !n.layout);
  const n = nodes.find((x) => x.id.toLowerCase() === q) || nodes.find((x) => partLabel(graph, x.id).toLowerCase() === q) || nodes.find((x) => x.name.toLowerCase() === q);
  if (!n) return null;
  const pipe = (e, dir) => ({ direction: dir, other: partLabel(graph, dir === "out" ? e.to : e.from), kind: e.kind, certainty: e.certainty, label: e.label || null, where: e.evidence?.[0] ? `${e.evidence[0].file}:${e.evidence[0].line}` : null });
  const out = (graph.edges || []).filter((e) => e.from === n.id).map((e) => pipe(e, "out"));
  const inc = (graph.edges || []).filter((e) => e.to === n.id).map((e) => pipe(e, "in"));
  const findings = (graph.findings || []).map((f, i) => [f, i]).filter(([f]) => f.node === n.id).map(([f, i]) => ({ index: i, severity: SEVERITY[f.sev], title: f.title }));
  const lines = [`${KIND[n.kind] || n.kind}: ${partLabel(graph, n.id)}${n.file ? ` (${n.file}${n.line ? `:${n.line}` : ""})` : ""}`];
  for (const x of n.explain || []) lines.push(`- ${x.text}`);
  if (inc.length) lines.push("", "Comes in from:", ...inc.map((p) => `  ${p.other}: ${p.label || p.kind}${p.certainty !== "proven" ? ` [${p.certainty}]` : ""}`));
  if (out.length) lines.push("", "Goes out to:", ...out.map((p) => `  ${p.other}: ${p.label || p.kind}${p.certainty !== "proven" ? ` [${p.certainty}]` : ""}`));
  if (findings.length) lines.push("", "Findings here:", ...findings.map((f) => `  [${f.index}] ${f.severity}: ${f.title}`));
  return { part: { id: n.id, kind: n.kind, name: partLabel(graph, n.id), file: n.file || null, line: n.line || null, explain: (n.explain || []).map((x) => x.text), incoming: inc, outgoing: out, findings }, text: lines.join("\n") };
}
