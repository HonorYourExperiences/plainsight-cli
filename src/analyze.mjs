// Plainsight analyzer
// Reads a repo and extracts a system graph where every part, pipe and finding
// carries the file and line it came from. Facts come from the TypeScript parser;
// sentences are templated from those facts, so nothing is stated that the
// analysis did not establish.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fixPrompt } from "./fixprompt.mjs";

export const VERSION = "0.3.1";

/** Analyze the repository at `rootDir` and return its graph. */
export function analyze(rootDir = ".", { name } = {}) {
const root = path.resolve(rootDir);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`);

const SRC_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", ".vercel", "coverage", ".turbo", ".cache"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const PRISMA_READ = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const PRISMA_WRITE = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const SUPABASE_READ = new Set(["select"]);
const SUPABASE_WRITE = new Set(["insert", "update", "upsert", "delete"]);
const AUTH_NAMES = new Set(["getSession", "getServerSession", "auth", "currentUser", "getUser", "getAuth", "getCurrentUser", "validateRequest", "requireUser", "requireAuth", "requireSession", "getServerAuthSession", "withAuth"]);
const SERVICES = {
  stripe: { name: "Stripe", what: "payments" },
  resend: { name: "Resend", what: "email" },
  "@sendgrid/mail": { name: "SendGrid", what: "email" },
  nodemailer: { name: "Email server (SMTP)", what: "email" },
  postmark: { name: "Postmark", what: "email" },
  openai: { name: "OpenAI", what: "AI model" },
  "@anthropic-ai/sdk": { name: "Anthropic", what: "AI model" },
  "@google/generative-ai": { name: "Google Gemini", what: "AI model" },
  ai: { name: "Vercel AI SDK", what: "AI model" },
  twilio: { name: "Twilio", what: "SMS and calls" },
  "posthog-node": { name: "PostHog", what: "analytics" },
  "@aws-sdk/client-s3": { name: "AWS S3", what: "file storage" },
  "@vercel/blob": { name: "Vercel Blob", what: "file storage" },
  cloudinary: { name: "Cloudinary", what: "images" },
  "@upstash/redis": { name: "Upstash Redis", what: "cache" },
  ioredis: { name: "Redis", what: "cache" },
  "@pinecone-database/pinecone": { name: "Pinecone", what: "vector search" },
  algoliasearch: { name: "Algolia", what: "search" },
  "@slack/web-api": { name: "Slack", what: "messaging" },
  "lemonsqueezy.ts": { name: "Lemon Squeezy", what: "payments" },
  "@lemonsqueezy/lemonsqueezy.js": { name: "Lemon Squeezy", what: "payments" },
};
const DB_PKGS = { "@prisma/client": "prisma", "@supabase/supabase-js": "supabase", "@supabase/ssr": "supabase" };
const SECRET_PATTERNS = [
  [/\bsk_(live|test)_[A-Za-z0-9]{10,}/, "Stripe secret key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bxox[bap]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{20,}/, "OpenAI key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic key"],
  [/\bre_[A-Za-z0-9]{20,}/, "Resend key"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key"],
];

// ---------- files ----------
// A folder like dist/ is normally build output, unless it's what the site deploys as-is (vercel.json outputDirectory,
// or a dist/ with its own index.html and no framework app folder).
const servedDirs = new Set();
try { const od = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")).outputDirectory; if (od) servedDirs.add(path.resolve(root, od)); } catch {}
if (!["app", "src/app", "pages", "src/pages"].some((d) => fs.existsSync(path.join(root, d))))
  for (const d of ["dist", "build", "out", "public"]) if (fs.existsSync(path.join(root, d, "index.html"))) servedDirs.add(path.join(root, d));
// Symbolic links are followed only when they point inside the repo, so a crafted repo can't pull outside
// files (for example a CI runner's) into the report.
const realRoot = fs.realpathSync(root);
const inside = (p) => { try { const r = fs.realpathSync(p); return r === realRoot || r.startsWith(realRoot + path.sep); } catch { return false; } };
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink() && !inside(p)) continue;
    const isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(p).isDirectory());
    if (isDir) { if (e.isSymbolicLink()) continue; if (!IGNORE_DIRS.has(e.name) || servedDirs.has(p)) walk(p, acc); }
    else if (e.isFile() || e.isSymbolicLink()) acc.push(p);
  }
  return acc;
}
const allFiles = walk(root);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const isSource = (p) => SRC_EXT.includes(path.extname(p)) && !p.endsWith(".d.ts");
const sourceFiles = allFiles.filter(isSource);
const fileSet = new Set(sourceFiles);
const isToolingConfig = (r) => /(^|\/)[\w.-]+\.config\.(m?[jt]s|cjs)$/.test(r) || /(^|\/)(jest|vitest)\.setup\./.test(r);
const isScripts = (r) => /^(scripts|tools|bin)\//.test(r);
const isDocs = (r) => /^(docs|art|examples?|design)\//.test(r);
// tests, and the fixtures and sample apps they read
const isTest = (r) => /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/.test(r) || /(^|\/)(__tests__|tests?|e2e|cypress|playwright|__fixtures__|fixtures?)\//.test(r);

// ---------- tsconfig paths ----------
let baseDir = root, aliasPaths = {}, hasBaseUrl = false;
for (const name of ["tsconfig.json", "jsconfig.json"]) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  const parsed = ts.parseConfigFileTextToJson(p, fs.readFileSync(p, "utf8"));
  const co = parsed.config?.compilerOptions || {};
  if (co.baseUrl) { baseDir = path.resolve(root, co.baseUrl); hasBaseUrl = true; }
  aliasPaths = co.paths || {};
  break;
}
function tryFile(c) {
  if (fileSet.has(c)) return c;
  for (const e of SRC_EXT) if (fileSet.has(c + e)) return c + e;
  for (const e of SRC_EXT) if (fileSet.has(path.join(c, "index" + e))) return path.join(c, "index" + e);
  if (/\.(m?js|jsx)$/.test(c)) { const b = c.replace(/\.(m?js|jsx)$/, ""); for (const e of [".ts", ".tsx"]) if (fileSet.has(b + e)) return b + e; }
  return null;
}
function resolveSpec(fromFile, spec) {
  const cands = [];
  if (spec.startsWith(".")) cands.push(path.resolve(path.dirname(fromFile), spec));
  else {
    for (const [pat, targets] of Object.entries(aliasPaths)) {
      const star = pat.indexOf("*");
      if (star >= 0) {
        const pre = pat.slice(0, star), suf = pat.slice(star + 1);
        if (spec.startsWith(pre) && spec.endsWith(suf)) {
          const mid = spec.slice(pre.length, spec.length - suf.length);
          for (const t of targets) cands.push(path.resolve(baseDir, t.replace("*", mid)));
        }
      } else if (pat === spec) for (const t of targets) cands.push(path.resolve(baseDir, t));
    }
    if (hasBaseUrl) cands.push(path.resolve(baseDir, spec));
  }
  for (const c of cands) { const r = tryFile(c); if (r) return r; }
  return null;
}
const pkgOf = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

// ---------- parse ----------
const F = new Map(); // abs path -> file model
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ext === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const m = { file, rel: rel(file), sf, text, lines: text.split(/\r?\n/), directives: new Set(), imports: [], importMap: new Map(),
    fns: new Map(), vars: new Map(), varTypes: new Map(), wrapped: new Map(), exportsMap: new Map(), handles: new Map(), secrets: [] };
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) { m.directives.add(st.expression.text); continue; }
    break;
  }
  const isExported = (n) => !!n.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n) => !!n.modifiers?.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      const resolved = resolveSpec(file, spec);
      const imp = { spec, resolved, pkg: resolved ? null : pkgOf(spec), line: lineOf(sf, st), bindings: [], typeOnly: !!st.importClause?.isTypeOnly };
      const c = st.importClause;
      if (c?.name) imp.bindings.push({ local: c.name.text, imported: "default" });
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) imp.bindings.push({ local: c.namedBindings.name.text, imported: "*" });
        else for (const el of c.namedBindings.elements) imp.bindings.push({ local: el.name.text, imported: (el.propertyName || el.name).text });
      }
      m.imports.push(imp);
      for (const b of imp.bindings) m.importMap.set(b.local, { resolved, pkg: imp.pkg, imported: b.imported, line: imp.line });
    } else if (ts.isFunctionDeclaration(st)) {
      const name = st.name ? st.name.text : "__default";
      m.fns.set(name, st);
      if (isExported(st)) m.exportsMap.set(isDefault(st) ? "default" : name, { local: name });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        m.vars.set(name, d.initializer);
        if (d.type) m.varTypes.set(name, d.type.getText(sf));
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) m.fns.set(name, d.initializer);
        else if (d.initializer && ts.isCallExpression(d.initializer)) {
          // cache(async () => ...), memo(function ...), withAuth(handler) ...
          const inner = d.initializer.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
          if (inner) {
            m.fns.set(name, inner);
            // remember the wrapper: its own login check runs before the inner function
            const wc = unwrap(d.initializer.expression);
            if (ts.isIdentifier(wc)) m.wrapped.set(name, { name: wc.text, node: d.initializer });
            else { const root = chainOf(wc)?.[0]; if (root && root !== "[]") m.wrapped.set(name, { name: root, node: d.initializer, chained: true }); }
          }
        }
        if (isExported(st)) m.exportsMap.set(name, { local: name });
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      if (isExported(st)) m.exportsMap.set(isDefault(st) ? "default" : st.name.text, { local: st.name.text });
    } else if (ts.isExportAssignment(st)) {
      const e = st.expression;
      if (ts.isIdentifier(e)) m.exportsMap.set("default", { local: e.text });
      else if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) { m.fns.set("__default", e); m.exportsMap.set("default", { local: "__default" }); }
      else if (ts.isCallExpression(e)) { m.vars.set("__default", e); m.exportsMap.set("default", { local: "__default" }); }
      else if (ts.isObjectLiteralExpression(e)) {
        m.vars.set("__default", e); m.exportsMap.set("default", { local: "__default" });
        for (const p of e.properties) {
          const nm = p.name && p.name.getText(sf);
          if (ts.isMethodDeclaration(p)) m.fns.set("__default." + nm, p);
          else if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) m.fns.set("__default." + nm, p.initializer);
        }
      }
    } else if (ts.isExportDeclaration(st)) {
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolveSpec(file, st.moduleSpecifier.text) : null;
      if (from) m.imports.push({ spec: st.moduleSpecifier.text, resolved: from, pkg: null, line: lineOf(sf, st), bindings: [], typeOnly: !!st.isTypeOnly, reexport: true });
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName || el.name).text;
          m.exportsMap.set(el.name.text, from ? { reexport: from, name: local } : { local });
        }
      } else if (!st.exportClause && from) {
        (m.starExports ||= []).push(from);
      }
    }
  }
  // secrets anywhere in the file
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      for (const [re, label] of SECRET_PATTERNS) if (re.test(n.text)) m.secrets.push({ label, node: n });
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "importScripts") {
      for (const a of n.arguments) if (ts.isStringLiteral(a)) { const resolved = resolveSpec(file, a.text.startsWith(".") || a.text.startsWith("/") ? a.text : "./" + a.text); m.imports.push({ spec: a.text, resolved, pkg: null, line: lineOf(sf, n), bindings: [], classic: true }); }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const resolved = resolveSpec(file, n.arguments[0].text);
      m.imports.push({ spec: n.arguments[0].text, resolved, pkg: resolved ? null : pkgOf(n.arguments[0].text), line: lineOf(sf, n), bindings: [], dynamic: true, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  F.set(file, m);
}

// ---------- helpers ----------
function lineOf(sf, node) { return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1; }
function ev(m, node, maxLines = 4) {
  const start = lineOf(m.sf, node);
  const end = m.sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const last = Math.min(end, start + maxLines - 1);
  let lines = m.lines.slice(start - 1, last);
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  lines = lines.map((l) => l.slice(indent));
  if (last < end) lines.push("…");
  return { file: m.rel, line: start, endLine: end, code: lines.join("\n") };
}
function unwrap(e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isTypeAssertionExpression?.(e))) e = e.expression;
  return e;
}
function chainOf(expr) {
  // returns [rootName, ...props] for a.b.c / a.b().c, or null
  const names = [];
  let e = expr;
  for (;;) {
    e = unwrap(e);
    if (ts.isPropertyAccessExpression(e)) { names.unshift(e.name.text); e = e.expression; }
    else if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isElementAccessExpression(e)) { names.unshift("[]"); e = e.expression; }
    else if (ts.isIdentifier(e)) { names.unshift(e.text); return names; }
    else return null;
  }
}
function findExport(file, name, seen = new Set()) {
  // follow re-exports to the defining file + local name
  const m = F.get(file);
  if (!m || seen.has(file + name)) return null;
  seen.add(file + name);
  const x = m.exportsMap.get(name);
  if (x?.local) return { m, local: x.local };
  if (x?.reexport) return findExport(x.reexport, x.name, seen);
  for (const s of m.starExports || []) { const r = findExport(s, name, seen); if (r) return r; }
  return null;
}
function inTry(node, stopAt) {
  for (let p = node.parent; p && p !== stopAt; p = p.parent) {
    if (ts.isTryStatement(p) && node.pos >= p.tryBlock.pos && node.end <= p.tryBlock.end) return true;
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "catch") return true;
  }
  return false;
}

// ---------- handles (service clients, db clients), resolved to a fixpoint ----------
function handleFromExpr(m, init, H = m.handles) {
  if (!init) return null;
  let found = null;
  if (ts.isIdentifier(unwrap(init)) && H.has(unwrap(init).text)) return H.get(unwrap(init).text);
  const look = (n) => {
    if (found) return;
    if (ts.isNewExpression(n) || ts.isCallExpression(n)) {
      const ch = chainOf(n.expression);
      if (ch && H.has(ch[0])) { found = H.get(ch[0]); return; }
    }
    if (ts.isFunctionLike(n)) return; // a function returning a client is not itself a client
    ts.forEachChild(n, look);
  };
  look(init);
  return found;
}
for (const m of F.values()) {
  for (const imp of m.imports) {
    if (!imp.pkg) continue;
    for (const b of imp.bindings) {
      if (SERVICES[imp.pkg]) m.handles.set(b.local, { kind: "service", pkg: imp.pkg, origin: ev(m, m.sf.statements.find((s) => lineOf(m.sf, s) === imp.line) || m.sf, 1) });
      if (DB_PKGS[imp.pkg] && /PrismaClient|createClient|createServerClient|createBrowserClient/.test(b.imported + b.local)) m.handles.set(b.local, { kind: "db", db: DB_PKGS[imp.pkg] });
      if (imp.pkg === "drizzle-orm" && b.imported === "drizzle") m.handles.set(b.local, { kind: "db", db: "drizzle" });
    }
  }
}
// let prisma: PrismaClient (assigned later, e.g. cached on globalThis in development)
for (const m of F.values()) for (const [name, t] of m.varTypes) {
  if (m.handles.has(name)) continue;
  if (/\bPrismaClient\b/.test(t)) m.handles.set(name, { kind: "db", db: "prisma" });
  else if (/\bSupabaseClient\b/.test(t)) m.handles.set(name, { kind: "db", db: "supabase" });
}
for (let changed = true, guard = 0; changed && guard < 20; guard++) {
  changed = false;
  for (const m of F.values()) {
    for (const [name, init] of m.vars) {
      if (m.handles.has(name)) continue;
      let h = handleFromExpr(m, init);
      if (h && h.kind === "db" && h.db === "supabase" && /SERVICE_ROLE/.test(init.getText(m.sf))) h = { ...h, admin: true, adminEv: ev(m, init, 3) };
      if (h) { m.handles.set(name, h); changed = true; }
    }
    for (const [local, imp] of m.importMap) {
      if (m.handles.has(local) || !imp.resolved) continue;
      const x = findExport(imp.resolved, imp.imported);
      if (x && x.m.handles.has(x.local)) { m.handles.set(local, x.m.handles.get(x.local)); changed = true; }
    }
    // functions that return a client, e.g. `export function createClient() { return createServerClient(...) }`
    for (const [name, fn] of m.fns) {
      if (m.handles.has(name) || !fn.body) continue;
      const h = handleFromExpr(m, ts.isBlock(fn.body) ? fn.body : fn.body);
      if (h && h.kind === "db") { m.handles.set(name, { ...h, factory: true }); changed = true; }
    }
  }
}

// ---------- server actions ----------
function isAction(m, local) {
  const fn = m.fns.get(local);
  if (!fn) return false;
  if (m.directives.has("use server") && [...m.exportsMap.values()].some((x) => x.local === local)) return true;
  const first = fn.body && ts.isBlock(fn.body) ? fn.body.statements[0] : null;
  return !!(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server");
}

// ---------- effects per function ----------
const unitCache = new Map();
function taintSet(m, fn) {
  const t = new Set();
  fn.parameters?.forEach((p) => collectNames(p.name, t));
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const names = new Set(); collectNames(n.name, names);
        if ([...names].some((x) => !t.has(x)) && mentions(n.initializer, t)) { names.forEach((x) => t.add(x)); grew = true; }
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  }
  return t;
}
function collectNames(b, out) {
  if (!b) return;
  if (ts.isIdentifier(b)) out.add(b.text);
  else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) b.elements.forEach((el) => el.name && collectNames(el.name, out));
}
function mentions(node, names) {
  let hit = false;
  const v = (n) => { if (hit) return; if (ts.isIdentifier(n) && names.has(n.text)) { hit = true; return; } ts.forEachChild(n, v); };
  v(node);
  return hit;
}
function classifyUrl(m, fn, arg) {
  arg = unwrap(arg);
  if (!arg) return { kind: "unresolved", expr: "(nothing)" };
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return fromPattern(arg.text, arg.getText(m.sf));
  if (ts.isTemplateExpression(arg)) {
    let s = arg.head.text;
    for (const sp of arg.templateSpans) s += "\u0000" + sp.literal.text;
    return fromPattern(s, arg.getText(m.sf));
  }
  if (ts.isNewExpression(arg) && arg.expression.getText(m.sf) === "URL" && arg.arguments?.[0]) return classifyUrl(m, fn, arg.arguments[0]);
  if (ts.isIdentifier(arg)) {
    let init = null;
    const v = (n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text && n.initializer) init = n.initializer; ts.forEachChild(n, v); };
    if (fn?.body) v(fn.body);
    if (!init && m.vars.has(arg.text)) init = m.vars.get(arg.text);
    if (init) {
      const inner = unwrap(init);
      if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner)) return classifyUrl(m, fn, inner);
      return { kind: "unresolved", expr: arg.text, source: init.getText(m.sf), sourceEv: ev(m, init, 1) };
    }
  }
  return { kind: "unresolved", expr: arg.getText(m.sf) };
}
function fromPattern(s, raw) {
  const abs = s.match(/^https?:\/\/([^/\u0000?#]+)(.*)$/);
  if (abs) return { kind: "external", host: abs[1], path: abs[2].split("?")[0].replace(/\u0000/g, "…") || "/" };
  if (s.startsWith("/")) {
    const p = s.split(/[?#]/)[0];
    const segs = p.split("/").filter(Boolean).map((x) => (x.includes("\u0000") ? "*" : x));
    return { kind: "internal", path: "/" + segs.join("/"), segs };
  }
  const rel = s.match(/^(\.{0,2}\/)?([\w-]+)\/[^\u0000]*\.?/);
  if (rel && !s.startsWith("\u0000")) return { kind: "asset", dir: rel[2], path: s.split("?")[0].replace(/\u0000/g, "*") };
  return { kind: "unresolved", expr: raw };
}
// Does this condition test for "no login"? full = true when it fires whenever the login is missing.
function isNoLogin(e, names) {
  e = unwrap(e);
  const isRef = (x) => { x = unwrap(x); const ch = chainOf(x); return !!ch && names.has(ch[0]) && !ts.isCallExpression(x); };
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return isRef(e.operand);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(e.operatorToken.kind))
    return (isRef(e.left) && /^(null|undefined)$/.test(e.right.getText())) || (isRef(e.right) && /^(null|undefined)$/.test(e.left.getText()));
  return false;
}
function condFull(e, names) {
  e = unwrap(e);
  if (isNoLogin(e, names)) return true;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return condFull(e.left, names) || condFull(e.right, names);
  return false;
}
function condTests(e, names) {
  e = unwrap(e);
  if (isNoLogin(e, names)) return true;
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) return condTests(e.left, names) || condTests(e.right, names);
  return false;
}
// verifyX(): either its result is checked like a login, or it's awaited on its own and expected to throw when verification fails
function verifyGate(m, fn, call, name) {
  let p = call.parent; while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  const awaited = ts.isAwaitExpression(call.parent) || (ts.isParenthesizedExpression(call.parent) && ts.isAwaitExpression(call.parent.parent));
  // a verifier skipped when the value it checks is missing (if (t) verify(t), t && verify(t)) lets requests without it through.
  // Branching on something else (if (req.method === "GET") verifyA(req) else verifyB(req)) is fine.
  if (skippedWhenMissing(call, fn, m.sf)) return { enforced: false };
  // a failure caught by a catch that doesn't stop the request is ignored
  for (let c = call, q = call.parent; q && q !== fn; c = q, q = q.parent) {
    if (ts.isTryStatement(q) && c === q.tryBlock && q.catchClause) {
      // the handler's own catch stops the request when every path through it returns, throws or redirects
      const cb = q.catchClause.block;
      const leavesAll = (st) => !!st && (ts.isReturnStatement(st) || alwaysStops(st, m.sf) || (ts.isBlock(st) && st.statements.some(leavesAll)) || (ts.isIfStatement(st) && leavesAll(st.thenStatement) && leavesAll(st.elseStatement)));
      if (!leavesAll(cb)) return { enforced: false };
    }
  }
  if (p && ts.isExpressionStatement(p) && !/timingSafe/i.test(name)) {
    // the result is ignored, so it only protects anything if it throws. If its code is in the repo, check that it does.
    const id = unwrap(call.expression);
    let target = null;
    if (ts.isIdentifier(id)) { const imp = m.importMap.get(id.text); target = imp?.resolved ? findExport(imp.resolved, imp.imported) : m.fns.has(id.text) ? { m, local: id.text } : null; }
    const tfn = target && target.m.fns.get(target.local);
    const body = tfn?.body;
    // an async verifier that isn't awaited can't stop the request: its rejection arrives after the work is done
    const isAsync = tfn && (tfn.modifiers || []).some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
    if (!awaited && (isAsync || !body)) return { enforced: false };
    if (body) {
      // follows calls into other functions in the repo (seenFns holds the helpers being scanned right now, so recursion stops but the same helper can be scanned again with other inputs): rejectInvalidToken(t) can be the throw
      const seenFns = new Set();
      // a throw only rejects the request when it depends on what the verifier was given (not, say, missing config)
      const inputsOf = (fnNode, seed) => {
        const t = new Set(seed); let grew = true;
        while (grew) { grew = false; const w = (n) => { if (ts.isVariableDeclaration(n) && n.initializer && mentions(n.initializer, t)) { const names = new Set(); collectNames(n.name, names); for (const x of names) if (!t.has(x)) { t.add(x); grew = true; } } ts.forEachChild(n, w); }; if (fnNode.body) w(fnNode.body); }
        return t;
      };
      // a condition rejects the input when it is about the input alone: every && term mentions it, and it reads no configuration
      const aboutInput = (cond, inputs, tm) => {
        if (/process\.env|import\.meta\.env|\bconfig\b|\benv\b/i.test(cond.getText(tm.sf))) return false;
        const terms = []; const split = (e) => { e = unwrap(e); if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { split(e.left); split(e.right); } else terms.push(e); };
        split(cond);
        return terms.every((t) => mentions(t, inputs));
      };
      // a branch that always leaves (return or throw), like the early success return in if (t === "ok") return;
      const leaves = (st) => !!st && (ts.isReturnStatement(st) || ts.isThrowStatement(st) || (ts.isBlock(st) && st.statements.length > 0 && leaves(st.statements[st.statements.length - 1])));
      const dependsOnInput = (n, stop, inputs, tm) => {
        // a throw nested under a configuration check (if (t) { if (!process.env.KEY) throw }) is about the configuration
        const cfg = /process\.env|import\.meta\.env|\bconfig\b|\benv\b/i;
        for (let c = n, p = n.parent; p && c !== stop; c = p, p = p.parent) {
          if (ts.isIfStatement(p) && c !== p.expression && cfg.test(p.expression.getText(tm.sf))) return false;
          if (ts.isConditionalExpression(p) && c !== p.condition && cfg.test(p.condition.getText(tm.sf))) return false;
          if (ts.isBinaryExpression(p) && c === p.right && cfg.test(p.left.getText(tm.sf))) return false;
        }
        for (let c = n, p = n.parent; p && c !== stop; c = p, p = p.parent) {
          // code after if (<about the input>) return; only runs for some inputs
          if (ts.isBlock(p) || ts.isSourceFile(p)) { const i = p.statements.indexOf(c); if (p.statements.slice(0, Math.max(i, 0)).some((st) => ts.isIfStatement(st) && aboutInput(st.expression, inputs, tm) && (leaves(st.thenStatement) || leaves(st.elseStatement)))) return true; }
          if (ts.isIfStatement(p) && c !== p.expression && aboutInput(p.expression, inputs, tm)) return true;
          if (ts.isConditionalExpression(p) && c !== p.condition && aboutInput(p.condition, inputs, tm)) return true;
          if (ts.isBinaryExpression(p) && c === p.right && aboutInput(p.left, inputs, tm)) return true;
        }
        return false;
      };
      const throwsIn = (tm, b, inputs) => {
        let hit = false;
        const v = (n) => {
          if (hit) return;
          if ((ts.isThrowStatement(n) || (ts.isCallExpression(n) && /^(redirect|notFound|unauthorized|forbidden)$/.test(n.expression.getText(tm.sf)))) && dependsOnInput(n, b, inputs, tm)) { hit = true; return; }
          // a library verifier given the input throws on a bad one
          if (ts.isCallExpression(n) && /^(jwtVerify|verify)$/.test(n.expression.getText(tm.sf).split(".").pop()) && n.arguments.some((a) => mentions(a, inputs)) && !onBranch(n, (() => { let q = n.parent; while (q && !ts.isFunctionLike(q)) q = q.parent; return q; })())) { hit = true; return; }
          // a return in finally overrides any throw from its try (and catch)
          if (ts.isTryStatement(n) && n.finallyBlock && n.finallyBlock.statements.some(ts.isReturnStatement)) { v(n.finallyBlock); return; }
          // a try whose catch carries on (doesn't throw, return or redirect) swallows anything thrown inside it
          if (ts.isTryStatement(n) && n.catchClause) {
            // (a return here only leaves the verifier, so the caller carries on: that swallows the failure too)
            if (!alwaysStops(n.catchClause.block, tm.sf)) { if (n.finallyBlock) v(n.finallyBlock); return; } // a rethrow on only some paths is still swallowed on the rest
          }
          if (ts.isCallExpression(n) && ts.isIdentifier(unwrap(n.expression)) && ts.isExpressionStatement(n.parent.kind === ts.SyntaxKind.AwaitExpression ? n.parent.parent : n.parent)) {
            const id = unwrap(n.expression).text, im = tm.importMap.get(id);
            const t2 = im?.resolved ? findExport(im.resolved, im.imported) : tm.fns.has(id) ? { m: tm, local: id } : null;
            const key = t2 && t2.m.rel + "#" + t2.local;
            const f2 = t2 && t2.m.fns.get(t2.local);
            // an async helper's rejection only reaches the caller if the call is awaited
            const async2 = f2 && (f2.modifiers || []).some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
            const awaited2 = n.parent.kind === ts.SyntaxKind.AwaitExpression;
            // a helper called only on some paths (if (t) reject(t)) doesn't reject every bad request
            const ownFn = (() => { let p = n.parent; while (p && !ts.isFunctionLike(p)) p = p.parent; return p; })();
            // the helper's own parameters that receive the verifier's input
            const passed = new Set(); (f2?.parameters || []).forEach((prm, i) => { if (n.arguments[i] && mentions(n.arguments[i], inputs)) collectNames(prm.name, passed); });
            if (f2?.body && passed.size && !seenFns.has(key) && (!async2 || awaited2) && !onBranch(n, ownFn)) { seenFns.add(key); const r = throwsIn(t2.m, f2.body, inputsOf(f2, passed)); seenFns.delete(key); if (r) { hit = true; return; } }
          }
          if (!ts.isFunctionLike(n)) ts.forEachChild(n, v);
        };
        ts.forEachChild(b, v);
        return hit;
      };
      seenFns.add(target.m.rel + "#" + target.local);
      const seed = new Set(); (tfn.parameters || []).forEach((prm) => collectNames(prm.name, seed));
      const throws = throwsIn(target.m, body, inputsOf(tfn, seed));
      if (!throws) return { enforced: false };
      return { enforced: true, full: true, stop: "throw", certainty: "proven", how: `${name}() throws when it can't verify the request` };
    }
    return { enforced: true, full: true, stop: "throw", certainty: "inferred", how: `${name}() is expected to reject requests it can't verify (judged by its name only)` };
  }

  const r = authEnforced(m, fn, call);
  return r.enforced ? { ...r, how: r.full ? `stops the request unless ${name}() accepts it` : r.how } : r;
}
function authEnforced(m, fn, call) {
  // Is the result of this auth call used to stop the request?
  let decl = call.parent;
  while (decl && (ts.isAwaitExpression(decl) || ts.isParenthesizedExpression(decl))) decl = decl.parent;
  // "throw" = also stops whoever called this function (Next's redirect() throws); "return" = only stops this function
  const stops = (st) => { let hit = null; const v = (n) => { if (hit === "throw") return; if (ts.isThrowStatement(n)) { hit = "throw"; return; } if (ts.isCallExpression(n) && /^(redirect|permanentRedirect|notFound|unauthorized|forbidden)$/.test(n.expression.getText(m.sf))) { hit = "throw"; return; } if (ts.isReturnStatement(n)) hit = hit || "return"; ts.forEachChild(n, v); }; v(st); return hit; };
  const name = call.expression.getText(m.sf).split(".").pop();
  if (/^require/.test(name)) return { enforced: true, full: true, stop: "throw", how: `${name}() is expected to stop the request itself (judged by its name only)`, certainty: "inferred" };
  if (decl && (ts.isPrefixUnaryExpression(decl) || ts.isIfStatement(decl.parent))) {
    // if (!(await auth())) ...
    let p = decl; while (p && !ts.isIfStatement(p)) p = p.parent;
    const st = p && stops(p.thenStatement);
    if (st && ts.isPrefixUnaryExpression(unwrap(p.expression))) return { enforced: true, full: true, stop: st, how: "blocks the request when there's no login", certainty: "proven", site: ev(m, p, 3) };
  }
  // walk up to the declaration that receives this call's result (through Promise.all([...]) too)
  let d = call, idx = -1;
  while (d && !ts.isVariableDeclaration(d) && !ts.isFunctionLike(d) && !ts.isStatement(d)) {
    if (ts.isArrayLiteralExpression(d.parent)) idx = d.parent.elements.indexOf(d);
    d = d.parent;
  }
  // session = await getSession() into a variable declared earlier
  const assign = decl && ts.isBinaryExpression(decl) && decl.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(decl.left) ? decl : null;
  if ((d && ts.isVariableDeclaration(d)) || assign) {
    const names = new Set();
    if (assign) names.add(assign.left.text);
    else if (ts.isArrayBindingPattern(d.name) && idx >= 0 && d.name.elements[idx]) collectNames(d.name.elements[idx].name, names);
    else collectNames(d.name, names);
    decl = assign || d;
    let found = null;
    const v = (n) => {
      if (found) return;
      if (ts.isIfStatement(n)) {
        if (condTests(n.expression, names) && stops(n.thenStatement)) found = n;
        if (found) return;
      }
      ts.forEachChild(n, v);
    };
    v(fn.body);
    if (found) {
      const cond = found.expression.getText(m.sf);
      const isFull = condFull(found.expression, names);
      return { enforced: true, full: isFull, stop: stops(found.thenStatement), certainty: "proven", site: ev(m, found, 3),
        how: isFull ? "blocks the request when there's no login" : `only stops the request in one case: when ${cond.replace(/\s+/g, " ")}` };
    }
  }
  return { enforced: false };
}

function localHandles(m, fn) {
  const H = new Map(m.handles);
  for (const p of fn.parameters || []) {
    const t = p.type ? p.type.getText(m.sf) : "";
    if (ts.isIdentifier(p.name) && /SupabaseClient/.test(t)) H.set(p.name.text, { kind: "db", db: "supabase", viaParam: true });
    if (ts.isIdentifier(p.name) && /PrismaClient/.test(t)) H.set(p.name.text, { kind: "db", db: "prisma", viaParam: true });
  }
  const v = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !H.has(n.name.text)) {
      let h = handleFromExpr(m, n.initializer, H);
      if (h && h.kind === "db" && h.db === "supabase" && /SERVICE_ROLE/.test(n.initializer.getText(m.sf))) h = { ...h, admin: true, adminEv: ev(m, n.initializer, 3) };
      if (h) H.set(n.name.text, h);
    }
    ts.forEachChild(n, v);
  };
  if (fn.body) v(fn.body);
  return H;
}
// variables that hold the logged-in user or session (and values derived from them)
const AUTH_CALL_RE = new RegExp(`\\b(${[...AUTH_NAMES].join("|")})\\s*\\(|\\.auth\\.get(User|Session|Claims)\\s*\\(`);
function authVarsOf(m, fn) {
  const t = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const names = new Set(); collectNames(n.name, names);
        if ([...names].some((x) => !t.has(x)) && (AUTH_CALL_RE.test(n.initializer.getText(m.sf)) || mentions(n.initializer, t))) { names.forEach((x) => t.add(x)); grew = true; }
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  }
  return t;
}
// getUser(email), getUser(id): fetching a user record by a key is a database lookup, not a login check
const lookupByKey = (m, call) => call.arguments.length > 0 && /\b(email|e-?mail|userId|user_id|username|id)\b/i.test(call.arguments[0].getText(m.sf)) && !/session|req|request|headers|cookies|options|config|token/i.test(call.arguments[0].getText(m.sf));
// does this node's text use one of the login variables with optional chaining (session?.user.id), which is undefined for logged-out visitors?
const optionalAuth = (m, node, names, optVars = new Set()) => {
  let hit = false;
  // session?.user.id ?? NONE (or || NONE) replaces undefined, so Prisma keeps the filter
  const mayBeUndefined = (e) => { e = unwrap(e); return (ts.isIdentifier(e) && e.text === "undefined") || e.kind === ts.SyntaxKind.VoidExpression || (ts.isIdentifier(e) && optVars.has(e.text)) || (ts.isPropertyAccessExpression(e) && !!e.questionDotToken); };
  const fallback = (n) => { for (let c = n, p = n.parent; p && c !== node; c = p, p = p.parent) if (ts.isBinaryExpression(p) && p.left === c && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind) && !mayBeUndefined(p.right)) return true; return false; };
  const v = (n) => { if (hit) return; if (((ts.isPropertyAccessExpression(n) && n.questionDotToken && mentions(n, names)) || (ts.isIdentifier(n) && optVars.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n))) && !fallback(n)) hit = true; ts.forEachChild(n, v); };
  v(node); return hit;
};
// drizzle: walk up a query chain (db.select().from(t).where(...)) and test its where() arguments
// the values in a sql`` template, grouped by predicate: a new group starts wherever the literal text has AND or OR
function sqlPredicates(t) {
  const groups = [[]];
  for (const sp of t.templateSpans) { groups[groups.length - 1].push(sp.expression); if (/\b(and|or)\b/i.test(sp.literal.text)) groups.push([]); }
  return groups;
}
function drizzleWhere(n, test) {
  for (let p = n.parent; p && (ts.isPropertyAccessExpression(p) || ts.isCallExpression(p) || ts.isAwaitExpression(p)); p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "where" && p.arguments.some(test)) return true;
  }
  return false;
}
function drizzleTableOf(m, id) {
  if (!ts.isIdentifier(id)) return null;
  const imp = m.importMap.get(id.text);
  if (imp?.resolved) { const x = findExport(imp.resolved, imp.imported); if (x) return drizzleTables.get(x.m.rel + "#" + x.local)?.key || null; }
  return drizzleTables.get(m.rel + "#" + id.text)?.key || null;
}
function directEffects(m, name, fn) {
  const effects = [];
  const tainted = taintSet(m, fn);
  const authVars = authVarsOf(m, fn);
  // const ownerId = session?.user.id: undefined when nobody is logged in
  const optVars = new Set();
  const ov = (n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && optionalAuth(m, n.initializer, authVars, optVars)) optVars.add(n.name.text); ts.forEachChild(n, ov); };
  if (fn.body) ov(fn.body);
  const H = localHandles(m, fn);
  const callTo = (ident, node, ref) => {
    const imp = m.importMap.get(ident);
    const taintedArgs = ts.isCallExpression(node) ? node.arguments.some((a) => mentions(a, tainted)) : true;
    if (imp?.resolved) { const x = findExport(imp.resolved, imp.imported); if (x && x.m.fns.has(x.local)) effects.push({ type: "call", target: x, name: ident, ref, taintedArgs, site: { node, ev: ev(m, node, 2), inTry: inTry(node, fn), pos: node.getStart(m.sf) } }); }
    else if (m.fns.has(ident) && m.fns.get(ident) !== fn) effects.push({ type: "call", target: { m, local: ident }, name: ident, ref, taintedArgs, site: { node, ev: ev(m, node, 2), inTry: inTry(node, fn), pos: node.getStart(m.sf) } });
  };
  const visit = (n) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && /^[A-Z]/.test(n.tagName.text)) callTo(n.tagName.text, n, "renders");
    if (ts.isIdentifier(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !ts.isJsxOpeningElement(n.parent) && !ts.isJsxSelfClosingElement(n.parent) && !ts.isJsxClosingElement(n.parent)
      && !ts.isPropertyAssignment(n.parent) && !ts.isVariableDeclaration(n.parent) && !ts.isBindingElement(n.parent) && !ts.isParameter(n.parent) && !ts.isFunctionDeclaration(n.parent) && !ts.isTypeReferenceNode(n.parent)) {
      if (m.importMap.has(n.text) || m.fns.has(n.text)) { const before = effects.length; callTo(n.text, n, "passes"); if (effects.length > before) { let c = n; while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isTypeAssertionExpression(c.parent) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(c.parent)))) c = c.parent; if (ts.isConditionalExpression(c.parent) && c.parent.condition !== c) effects[effects.length - 1].conditional = c.parent.condition.getText(m.sf); } }
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const ch = chainOf(callee);
      const site = { node: n, ev: ev(m, n), inTry: inTry(n, fn), pos: n.getStart(m.sf) };
      if (ts.isIdentifier(callee) && callee.text === "fetch") {
        const url = classifyUrl(m, fn, n.arguments[0]);
        let method = "GET";
        const opts = n.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) if (ts.isPropertyAssignment(p) && p.name.getText(m.sf) === "method" && ts.isStringLiteral(p.initializer)) method = p.initializer.text.toUpperCase();
        }
        effects.push({ type: "fetch", url, method, site });
      } else if (ch) {
        const h = H.get(ch[0]);
        const last = ch[ch.length - 1];
        if (h?.kind === "db" && h.db === "prisma" && ch.length >= 3 && (PRISMA_READ.has(ch[2]) || PRISMA_WRITE.has(ch[2]))) {
          const arg = n.arguments[0];
          let whereFromRequest = false, whereOptionalAuth = null;
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(m.sf) === "where") {
                if (mentions(p, tainted)) whereFromRequest = true;
                // Prisma drops filters whose value is undefined, so session?.user.id matches every row when nobody is logged in
                if (optionalAuth(m, p, authVars, optVars)) whereOptionalAuth = ev(m, p, 6);
              }
            }
          }
          effects.push({ type: "db", model: ch[1], op: ch[2], write: PRISMA_WRITE.has(ch[2]), whereFromRequest, whereOptionalAuth, site });
        } else if (h?.kind === "db" && h.db === "drizzle" && /^(from|insert|update|delete)$/.test(last) && n.arguments[0] && drizzleTableOf(m, unwrap(n.arguments[0]))) {
          const write = last !== "from";
          effects.push({ type: "db", model: drizzleTableOf(m, unwrap(n.arguments[0])), op: write ? last : "select", write, whereFromRequest: drizzleWhere(n, (a) => mentions(a, tainted)), site });
        } else if (h?.kind === "db" && h.db === "drizzle" && /^(leftJoin|rightJoin|innerJoin|fullJoin)$/.test(last) && n.arguments[0] && drizzleTableOf(m, unwrap(n.arguments[0]))) {
          // the joined table is only "selected by the request" when the request-driven filter is on that table's columns
          const joinId = unwrap(n.arguments[0]).getText(m.sf);
          // parts are a call's arguments, or the values in a sql`...` template
          const onJoined = (a) => { let hit = false; const v = (x) => { if (hit) return; const groups = ts.isCallExpression(x) ? [x.arguments] : ts.isTaggedTemplateExpression(x) && ts.isTemplateExpression(x.template) ? sqlPredicates(x.template) : []; for (const parts of groups) if (parts.some((y) => (ts.isPropertyAccessExpression(unwrap(y)) || ts.isElementAccessExpression(unwrap(y))) && unwrap(y).expression.getText(m.sf) === joinId) && parts.some((y) => mentions(y, tainted))) hit = true; ts.forEachChild(x, v); }; v(a); return hit; };
          effects.push({ type: "db", model: drizzleTableOf(m, unwrap(n.arguments[0])), op: "select", write: false, whereFromRequest: drizzleWhere(n, onJoined), site });
        } else if (h?.kind === "db" && h.db === "drizzle" && ch[1] === "query" && ch.length >= 4 && /^find(First|Many)$/.test(last)) {
          const key = [...drizzleTables.values()].find((t) => t.local === ch[2])?.key || ch[2];
          const opts = n.arguments[0];
          const whereP = opts && ts.isObjectLiteralExpression(opts) ? opts.properties.find((p) => p.name?.getText(m.sf) === "where") : null;
          effects.push({ type: "db", model: key, op: last, write: false, whereFromRequest: !!whereP && mentions(whereP, tainted), site });
          // with: { team: true } also reads the related tables (matched by name: team -> teams)
          const withP = opts && ts.isObjectLiteralExpression(opts) ? opts.properties.find((p) => p.name?.getText(m.sf) === "with") : null;
          const relKeys = (wp) => wp && ts.isPropertyAssignment(wp) && ts.isObjectLiteralExpression(wp.initializer) ? wp.initializer.properties : [];
          const walkWith = (wp, depth) => { if (depth > 3) return; for (const r of relKeys(wp)) {
            const name = r.name?.getText(m.sf); if (!name) continue;
            const t = [...drizzleTables.values()].find((x) => [name, name + "s", name + "es", name.replace(/y$/, "ies"), name.replace(/s$/, "")].includes(x.local));
            if (t) effects.push({ type: "db", model: t.key, op: last, write: false, whereFromRequest: false, site });
            if (ts.isPropertyAssignment(r) && ts.isObjectLiteralExpression(r.initializer)) walkWith(r.initializer.properties.find((p) => p.name?.getText(m.sf) === "with"), depth + 1);
          } };
          walkWith(withP, 0);
        } else if (h?.kind === "db" && h.db === "prisma" && /^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)$/.test(ch[1] || "")) {
          effects.push({ type: "db", model: "(raw SQL)", op: ch[1], write: /execute/.test(ch[1]), site });
        } else if (h?.kind === "db" && h.db === "supabase" && last === "from" && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
          // supabase.from("table").select()/insert()...
          let op = "select", p = n.parent;
          while (p && (ts.isPropertyAccessExpression(p) || ts.isCallExpression(p))) {
            if (ts.isPropertyAccessExpression(p) && (SUPABASE_READ.has(p.name.text) || SUPABASE_WRITE.has(p.name.text))) { op = p.name.text; break; }
            p = p.parent;
          }
          effects.push({ type: "db", model: n.arguments[0].text, op, write: SUPABASE_WRITE.has(op), admin: !!h.admin, adminEv: h.adminEv, site });
        } else if (h?.kind === "db" && h.db === "supabase" && ch[1] === "auth" && /^(updateUser|signOut)$/.test(last)) {
          effects.push({ type: "auth", name: ch.slice(1).join("."), enforced: true, full: true, stop: "return", certainty: "library", how: `uses ${ch.slice(1).join(".")}(), which Supabase only runs for the logged-in user`, site });
        } else if (h?.kind === "db" && h.db === "supabase" && ch[1] === "auth" && /^get(User|Session|Claims)$/.test(last)) {
          effects.push({ type: "auth", name: ch.slice(1).join("."), ...authEnforced(m, fn, n), site });
        } else if (h?.kind === "service" && ch.length >= 2) {
          effects.push({ type: "service", pkg: h.pkg, call: ch.join("."), verify: /constructEvent|verify/i.test(ch.join(".")), site });
        } else if (ch.length === 1 && AUTH_NAMES.has(last) && !lookupByKey(m, n)) {
          effects.push({ type: "auth", name: last, ...authEnforced(m, fn, n), site });
        } else if (ch.length > 1 && AUTH_NAMES.has(last) && !h && !lookupByKey(m, n)) {
          effects.push({ type: "auth", name: ch.join("."), ...authEnforced(m, fn, n), site });
        } else if (/^verify(\w*(Signature|Webhook))?$|constructEvent|^timingSafe(Equal|Compare)$/i.test(last)) {
          const gate = verifyGate(m, fn, n, ch.join("."));
          effects.push({ type: "verify", call: ch.join("."), enforced: gate.enforced, site });
          effects.push({ type: "auth", name: ch.join("."), ...gate, site });
        } else if (/^verify\w*(Token|Request|Key|Jwt|JWT|Secret|Hmac)$/.test(last)) {
          effects.push({ type: "auth", name: ch.join("."), ...verifyGate(m, fn, n, ch.join(".")), site });
        }
        // calls into other local functions
        if (ch.length === 1 && ts.isIdentifier(callee)) callTo(ch[0], n, null);
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return effects;
}
// The login checks a wrapper runs before the wrapped function: a wrapper function, or a client object built with
// .use(async ({ next }) => { ...check... }) (next-safe-action and similar), followed back through its chain.
function wrapperAuth(m, name, stack, cutActions, depth) {
  if (depth > 3) return [];
  const imp = m.importMap.get(name);
  const x = imp?.resolved ? findExport(imp.resolved, imp.imported) : { m, local: name };
  if (!x) return [];
  if (x.m.fns.has(x.local)) {
    const wf = x.m.fns.get(x.local);
    // where the wrapper calls the function it wraps: a check only protects the handler if it runs before that
    const params = new Set(); (wf.parameters || []).forEach((p) => collectNames(p.name, params));
    let handlerAt = Infinity;
    // (calls on a special-case branch, like an anonymous mode, don't count: the check still runs before the usual call)
    const findCall = (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(unwrap(n.expression)) && params.has(unwrap(n.expression).text) && !onBranch(n, wf)) handlerAt = Math.min(handlerAt, n.getStart(x.m.sf)); ts.forEachChild(n, findCall); };
    if (wf.body) findCall(wf.body);
    return unitEffects(x.m, x.local, stack, cutActions).filter((s) => s.type === "auth" && runsInWrapper(s.entry?.node || s.site?.node, wf) && (s.entry?.node || s.site?.node).getStart(x.m.sf) < handlerAt)
      // a refusal returned by a helper the wrapper calls doesn't stop the wrapper from calling the handler
      .map((s) => (s.stop === "return" && s.via.length ? { ...s, enforced: false } : s));
  }
  const init = x.m.vars.get(x.local);
  if (!init) return [];
  const out = [];
  const look = (n) => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) { out.push(...directEffects(x.m, x.local, n).filter((e) => e.type === "auth").map((e) => ({ ...e, via: [], entry: e.site, files: [x.m.rel] }))); return; }
    ts.forEachChild(n, look);
  };
  look(init);
  const root = chainOf(unwrap(init))?.[0];
  if (root && root !== x.local && (x.m.vars.has(root) || x.m.importMap.has(root))) out.push(...wrapperAuth(x.m, root, stack, cutActions, depth + 1));
  return out;
}
// is this node inside an if/else, ternary, && / || or try within fn (so it may not run on every request)?
// every path through the block ends in a throw or a redirect (a catch that only sometimes rethrows still swallows the rest)
const STOP_CALL = /^(redirect|notFound|unauthorized|forbidden)$/;
function alwaysStops(st, sf) {
  if (!st) return false;
  if (ts.isThrowStatement(st)) return true;
  if (ts.isExpressionStatement(st)) { let e = st.expression; if (ts.isAwaitExpression(e)) e = e.expression; return ts.isCallExpression(e) && STOP_CALL.test(e.expression.getText(sf)); }
  if (ts.isReturnStatement(st)) { let e = st.expression; if (e && ts.isAwaitExpression(e)) e = e.expression; return !!e && ts.isCallExpression(e) && STOP_CALL.test(e.expression.getText(sf)); }
  // statements run in order: a stop counts only if nothing before it can return first
  if (ts.isBlock(st)) { for (const x of st.statements) { if (alwaysStops(x, sf)) return true; if (mayReturn(x, sf)) return false; } return false; }
  if (ts.isIfStatement(st)) return alwaysStops(st.thenStatement, sf) && alwaysStops(st.elseStatement, sf);
  if (ts.isTryStatement(st)) return alwaysStops(st.finallyBlock, sf) || (alwaysStops(st.tryBlock, sf) && (!st.catchClause || alwaysStops(st.catchClause.block, sf)));
  return false;
}
function skippedWhenMissing(call, fn, sf) {
  const args = new Set(call.arguments.flatMap((a) => { const out = [a.getText(sf)]; const v = (x) => { if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) out.push(x.getText(sf)); ts.forEachChild(x, v); }; v(a); return out; }));
  const presence = (e) => { e = unwrap(e);
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return args.has(e.getText(sf));
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(e.operatorToken.kind) && /^(null|undefined|"")$/.test(e.right.getText(sf))) return args.has(unwrap(e.left).getText(sf));
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return presence(e.left) || presence(e.right);
    return false; };
  for (let c = call, p = call.parent; p && p !== fn; c = p, p = p.parent) {
    if (ts.isIfStatement(p) && c === p.thenStatement && presence(p.expression)) return true;
    if (ts.isConditionalExpression(p) && c === p.whenTrue && presence(p.condition)) return true;
    if (ts.isBinaryExpression(p) && c === p.right && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && presence(p.left)) return true;
  }
  return false;
}
// a plain return (not return redirect(...)) somewhere in the statement, outside nested functions
function mayReturn(st, sf) {
  let hit = false;
  const v = (n) => { if (hit || ts.isFunctionLike(n)) return; if (ts.isReturnStatement(n) && !alwaysStops(n, sf)) { hit = true; return; } ts.forEachChild(n, v); };
  v(st); return hit;
}
function onBranch(node, fn) {
  for (let c = node, p = node?.parent; p && p !== fn; c = p, p = p.parent) {
    if (ts.isIfStatement(p) && c !== p.expression) return true;
    if (ts.isConditionalExpression(p) && c !== p.condition) return true;
    if (ts.isBinaryExpression(p) && c === p.right && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return true;
    if (ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return true;
  }
  return false;
}
// F. in a wrapper, only checks that run: in its own body or in the function it returns, not in local helpers it never calls
function runsInWrapper(node, wrapperFn) {
  for (let c = node, p = node?.parent; p && c !== wrapperFn; c = p, p = p.parent) {
    if (c !== node && (ts.isFunctionDeclaration(c) || ts.isFunctionExpression(c) || ts.isArrowFunction(c) || ts.isMethodDeclaration(c))) {
      const returned = ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === c) || (ts.isCallExpression(p) && p.arguments.includes(c));
      if (!returned) return false;
    }
  }
  return true;
}
// cutActions: when walking page code, a call into a server action is a request to the server, not inlined code
function unitEffects(m, local, stack = new Set(), cutActions = false) {
  const key = m.file + "#" + local + (cutActions ? "#cut" : "");
  if (unitCache.has(key)) return unitCache.get(key);
  const fn = m.fns.get(local);
  if (!fn || stack.has(key)) return [];
  stack.add(key);
  const out = [];
  // defined through a wrapper, e.g. export const save = withUser(async (data, user) => ...): the wrapper's login check comes first
  const w = m.wrapped.get(local);
  if (w?.chained) {
    // authClient.use(async ({ next }) => { ...check... }).action(...): middleware added on the action's own chain
    for (let c = unwrap(w.node.expression); c && (ts.isPropertyAccessExpression(c) || ts.isCallExpression(c)); c = ts.isCallExpression(c) ? c.expression : c.expression) {
      if (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === "use")
        for (const a of c.arguments) if (ts.isArrowFunction(a) || ts.isFunctionExpression(a))
          for (const e of directEffects(m, local, a)) if (e.type === "auth") out.push({ ...e, via: [{ fn: ".use()", ev: ev(m, a, 2), ref: "wraps" }], entry: e.site, files: [m.rel] });
    }
  }
  if (w) for (const s of wrapperAuth(m, w.name, stack, cutActions, 0)) out.push({ ...s, via: [{ fn: w.name, ev: ev(m, w.node, 2), ref: "wraps" }, ...s.via], entry: s.site, files: [m.rel, ...s.files] });
  for (const e of directEffects(m, local, fn)) {
    if (e.type !== "call") { out.push({ ...e, via: [], entry: e.site, files: [m.rel] }); continue; }
    if (cutActions && isAction(e.target.m, e.target.local)) { out.push({ type: "action", target: e.target, name: e.name, ref: e.ref, conditional: e.conditional, site: e.site, via: [], entry: e.site, files: [m.rel] }); continue; }
    const sub = unitEffects(e.target.m, e.target.local, stack, cutActions);
    // a helper only touches "records named by the request" if this call hands it something from the request;
    // a login check inside a helper called on only one branch doesn't protect the rest of this function
    const branch = onBranch(e.site.node, fn);
    for (const s of sub) out.push({ ...s, ...(s.whereFromRequest && !e.taintedArgs ? { whereFromRequest: false } : {}), ...(s.type === "auth" && branch ? { enforced: false, conditional: true } : {}), via: [{ fn: e.name, ev: e.site.ev, ref: e.ref }, ...s.via], entry: e.site, files: [m.rel, ...s.files] });
  }
  stack.delete(key);
  unitCache.set(key, out);
  return out;
}

// ---------- entities: pages, routes, middleware ----------
const appDir = ["app", "src/app"].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
const pagesDir = ["pages", "src/pages"].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
function routeFromDir(dirRel) {
  const segs = dirRel.split("/").filter(Boolean).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"))
    .map((s) => s.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, ":$1*").replace(/^\[(\w+)\]$/, ":$1"));
  return "/" + segs.join("/");
}
function reach(file) {
  const seen = new Set([file]); const q = [file];
  while (q.length) { const f = q.shift(); for (const imp of F.get(f)?.imports || []) if (imp.resolved && !imp.typeOnly && !seen.has(imp.resolved)) { seen.add(imp.resolved); q.push(imp.resolved); } }
  return seen;
}
const pages = [], routes = [];
if (appDir) {
  for (const f of sourceFiles) {
    if (!f.startsWith(appDir + path.sep)) continue;
    const r = path.relative(appDir, path.dirname(f)).split(path.sep).join("/");
    const base = path.basename(f).replace(/\.[^.]+$/, "");
    if (base === "page") pages.push({ file: f, route: routeFromDir(r) });
    if (base === "layout") pages.push({ file: f, route: routeFromDir(r), layout: true, group: (r.match(/\([^/)]+\)/g) || []).join(" ") });
    if (base === "route") {
      const m = F.get(f);
      for (const meth of HTTP_METHODS) if (m.exportsMap.has(meth)) routes.push({ file: f, route: routeFromDir(r), method: meth, local: m.exportsMap.get(meth).local });
    }
  }
}
if (pagesDir) {
  for (const f of sourceFiles) {
    if (!f.startsWith(pagesDir + path.sep)) continue;
    const r = path.relative(pagesDir, f).split(path.sep).join("/").replace(/\.[^.]+$/, "").replace(/(^|\/)index$/, "");
    if (/^_(app|document|error)$/.test(r)) continue;
    if (r.startsWith("api/") || r === "api") { const m = F.get(f); const x = m.exportsMap.get("default"); if (x) routes.push({ file: f, route: routeFromDir(r), method: "ANY", local: x.local }); }
    else pages.push({ file: f, route: routeFromDir(r) });
  }
}
// middleware (Next.js "middleware" or "proxy")
// Drizzle schemas: export const users = pgTable("users", { ... }). Read before any effects are evaluated
// (middleware is analyzed early); added to the table list with the other schemas below.
const drizzleTables = new Map(); // "file#local" -> { key, local }
for (const m of F.values()) for (const [local, init] of m.vars) {
  if (!init || !ts.isCallExpression(init)) continue;
  const callee = init.expression.getText(m.sf);
  if (!/(^|\.)(pg|mysql|sqlite|singlestore)Table$/.test(callee) || !init.arguments[0] || !ts.isStringLiteralLike(init.arguments[0])) continue;
  const key = local, cols = init.arguments[1];
  const fields = [], relations = [];
  if (cols && ts.isObjectLiteralExpression(cols)) for (const p of cols.properties) {
    if (!p.name) continue;
    fields.push(p.name.getText(m.sf));
    const ref = p.getText(m.sf).match(/\.references\(\s*\(\)\s*(?::\s*\w+\s*)?=>\s*(\w+)\./);
    if (ref) relations.push({ field: p.name.getText(m.sf), to: ref[1], line: lineOf(m.sf, p), code: p.getText(m.sf).replace(/\s+/g, " ") });
  }
  drizzleTables.set(m.rel + "#" + local, { key, local, fields, relations, drizzle: init.arguments[0].text, ev: ev(m, init, 12) });
}
let middleware = null;
for (const cand of ["middleware", "src/middleware", "proxy", "src/proxy"]) {
  const f = tryFile(path.join(root, cand));
  if (!f) continue;
  const m = F.get(f);
  const local = m.exportsMap.get("middleware")?.local || m.exportsMap.get("proxy")?.local || m.exportsMap.get("default")?.local;
  let matchers = null, matcherEv = null;
  const cfg = m.vars.get("config");
  if (cfg && ts.isObjectLiteralExpression(cfg)) {
    for (const p of cfg.properties) if (ts.isPropertyAssignment(p) && p.name.getText(m.sf) === "matcher") {
      matcherEv = ev(m, p, 3);
      const v = p.initializer;
      if (ts.isStringLiteral(v)) matchers = [v.text];
      else if (ts.isArrayLiteralExpression(v)) matchers = v.elements.filter(ts.isStringLiteral).map((e) => e.text);
    }
  }
  const effects = local ? unitEffects(m, local) : [];
  let auth = effects.find((e) => e.type === "auth" && e.enforced);
  // if (isProtected && !sessionCookie) return redirect(...), with isProtected = pathname.startsWith("/dashboard")
  let prefixes = null, partialGate = false;
  const fn = local && m.fns.get(local);
  if (!auth && fn?.body) {
    const cookieVars = new Set(), prefixVars = new Map();
    const lit = (e) => { e = unwrap(e); if (ts.isStringLiteralLike(e)) return e.text; if (ts.isIdentifier(e) && m.vars.get(e.text) && ts.isStringLiteralLike(m.vars.get(e.text))) return m.vars.get(e.text).text; return null; };
    const prefixesIn = (n) => { const out = []; const v = (x) => { if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "startsWith" && x.arguments[0] && lit(x.arguments[0])) out.push(lit(x.arguments[0])); if (ts.isIdentifier(x) && prefixVars.has(x.text)) out.push(...prefixVars.get(x.text)); ts.forEachChild(x, v); }; v(n); return out; };
    const scan = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        if (/cookies(\(\))?\.get\(/.test(n.initializer.getText(m.sf))) cookieVars.add(n.name.text);
        const pf = prefixesIn(n.initializer); if (pf.length) prefixVars.set(n.name.text, pf);
      }
      if (ts.isIfStatement(n) && [...cookieVars].some((c) => new RegExp(`!\\s*${c}\\b`).test(n.expression.getText(m.sf))) && /redirect|status:\s*40[13]|NextResponse\.json/.test(n.thenStatement.getText(m.sf))) {
        const pf = prefixesIn(n.expression);
        // every term of the && chain must be the missing cookie or the path prefix; anything else narrows the check
        const terms = []; const split = (e) => { e = unwrap(e); if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { split(e.left); split(e.right); } else terms.push(e); };
        split(n.expression);
        const extra = terms.some((t) => !([...cookieVars].some((c) => new RegExp(`^!\\s*${c}$`).test(t.getText(m.sf))) || prefixesIn(t).length));
        auth = { type: "auth", enforced: true, full: !extra, stop: "return", certainty: "proven", how: "sends visitors without a session cookie away", site: { ev: ev(m, n, 3) }, via: [] };
        prefixes = pf.length ? pf : null;
        partialGate = extra;
      }
      ts.forEachChild(n, scan);
    };
    scan(fn.body);
  }
  middleware = { file: f, rel: m.rel, local, matchers, matcherEv, effects, auth, prefixes, partial: partialGate };
  break;
}
// true / false when the pattern can be evaluated, null when it can't
function matcherCovers(pattern, routePath) {
  const re = "^" + pattern.replace(/:\w+\(/g, "(").replace(/\/:\w+\*/g, "(/.*)?").replace(/:\w+\+/g, ".+").replace(/:\w+/g, "[^/]+") + "$";
  try { return new RegExp(re).test(routePath); } catch { return null; }
}
// null: middleware doesn't check this path. { unknown: true }: it checks some paths, but Plainsight can't tell whether this one.
function middlewareGuard(routePath) {
  if (!middleware?.auth) return null;
  const mw = middleware;
  if (mw.prefixes) {
    const hit = mw.prefixes.find((pf) => routePath === pf || routePath.startsWith(pf.endsWith("/") ? pf : pf + "/"));
    if (!hit) return null;
    const cov = mw.matchers ? mw.matchers.map((p) => matcherCovers(p, routePath)) : [true];
    if (cov.some((c) => c === true)) return mw.partial ? { unknown: true, how: `${mw.rel} turns some visitors without a session cookie away from ${hit}, but only under extra conditions`, ev: mw.auth.site?.ev } : { how: `${mw.rel} ${mw.auth.how} from ${hit}`, ev: mw.auth.site?.ev, authEv: mw.matcherEv };
    if (cov.some((c) => c === null)) return { unknown: true, how: `${mw.rel} checks ${hit}, but its path rules (${mw.matchers.join(", ")}) are a pattern Plainsight can't evaluate`, ev: mw.matcherEv };
    return null;
  }
  if (!mw.matchers) return { how: `${mw.rel} checks the login on every path`, ev: mw.auth.site?.ev };
  let unknown = false;
  for (const p of mw.matchers) {
    const c = matcherCovers(p, routePath);
    if (c) return { how: `${mw.rel} checks the login for "${p}"`, ev: mw.matcherEv, authEv: mw.auth.site?.ev };
    if (c === null) unknown = true;
  }
  return unknown ? { unknown: true, how: `${mw.rel} may check the login here, but its path rules (${mw.matchers.join(", ")}) are a pattern Plainsight can't evaluate`, ev: mw.matcherEv } : null;
}

// ---------- prisma schema ----------
const tables = new Map(); // name -> {ev, fields, relations}
const schemaFile = ["prisma/schema.prisma", "schema.prisma", "prisma/schema/schema.prisma"].map((p) => path.join(root, p)).find((p) => fs.existsSync(p) && inside(p));
if (schemaFile) {
  const lines = fs.readFileSync(schemaFile, "utf8").split(/\r?\n/);
  let cur = null;
  lines.forEach((l, i) => {
    const mm = l.match(/^\s*model\s+(\w+)\s*\{/);
    if (mm) { cur = { name: mm[1], start: i + 1, fields: [], relations: [] }; return; }
    if (cur && /^\s*\}/.test(l)) {
      cur.end = i + 1;
      cur.ev = { file: rel(schemaFile), line: cur.start, endLine: cur.end, code: lines.slice(cur.start - 1, cur.end).join("\n") };
      tables.set(cur.name, cur); cur = null; return;
    }
    if (cur) {
      const f = l.match(/^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
      if (f && !f[1].startsWith("@@")) {
        cur.fields.push(f[1]);
        if (/@relation\(/.test(f[5])) cur.relations.push({ field: f[1], to: f[2], line: i + 1, code: l.trim() });
      }
    }
  });
}
// SQL schemas (Supabase / plain Postgres): tables, links, row-level security
const sqlFiles = [];
for (const d of ["", "supabase", "supabase/migrations", "db", "sql", "migrations"]) {
  const dir = path.join(root, d);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
  for (const e of fs.readdirSync(dir)) if (e.endsWith(".sql") && !/seed/i.test(e)) sqlFiles.push(path.join(dir, e));
}
const sqlRls = new Map(); // table -> {enabled, ev, policies: []}
if (!schemaFile) for (const sqlFile of sqlFiles.sort()) {
  const text = fs.readFileSync(sqlFile, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, (c) => " ".repeat(c.length));
  const lineAt = (i) => text.slice(0, i).split("\n").length;
  const lines = text.split("\n");
  const bare = (n) => n.replace(/"/g, "").replace(/^public\./i, "");
  for (const mt of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi)) {
    let depth = 1, i = mt.index + mt[0].length;
    for (; i < text.length && depth; i++) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; }
    const body = text.slice(mt.index + mt[0].length, i - 1);
    const name = bare(mt[1]);
    const start = lineAt(mt.index), end = lineAt(i);
    const fields = [], relations = [], external = [];
    let d = 0, cur = "", parts = [];
    for (const ch of body) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { parts.push(cur); cur = ""; } else cur += ch; }
    parts.push(cur);
    for (const raw of parts) {
      const col = raw.replace(/--.*$/gm, "").trim();
      if (!col) continue;
      const first = col.split(/\s+/)[0].replace(/"/g, "");
      if (/^(constraint|primary|foreign|unique|check|exclude)$/i.test(first)) continue;
      fields.push(first);
      const ref = col.match(/references\s+([\w."]+)/i);
      if (ref) {
        const to = bare(ref[1]);
        const li = start + body.slice(0, body.indexOf(raw)).split("\n").length - 1;
        (to.includes(".") ? external : relations).push({ field: first, to, line: li, code: col.replace(/\s+/g, " ") });
      }
    }
    if (!tables.has(name)) tables.set(name, { name, fields, relations, external, sql: true,
      ev: { file: rel(sqlFile), line: start, endLine: end, code: lines.slice(start - 1, Math.min(end, start + 11)).join("\n") + (end > start + 11 ? "\n…" : "") } });
  }
  for (const mt of text.matchAll(/alter\s+table\s+([\w."]+)\s+enable\s+row\s+level\s+security/gi)) {
    const t = bare(mt[1]); const r = sqlRls.get(t) || { policies: [] };
    r.enabled = true; r.ev = { file: rel(sqlFile), line: lineAt(mt.index), code: mt[0] }; sqlRls.set(t, r);
  }
  for (const mt of text.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+([\w."]+)\s+for\s+(\w+)[\s\S]*?;/gi)) {
    const t = bare(mt[2]); const r = sqlRls.get(t) || { policies: [] };
    if (r.policies.some((x) => x.name === mt[1])) continue;
    r.policies.push({ name: mt[1], for: mt[3].toLowerCase(), ev: { file: rel(sqlFile), line: lineAt(mt.index), code: mt[0].replace(/\s+/g, " ") } }); sqlRls.set(t, r);
  }
}
for (const t of drizzleTables.values()) if (!tables.has(t.key)) tables.set(t.key, { name: t.key, fields: t.fields, relations: t.relations, drizzle: t.drizzle, ev: t.ev });
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const tableName = (model) => { for (const t of tables.keys()) if (lcFirst(t) === model || t === model) return t; return model; };

// ---------- build graph ----------
const nodes = new Map(), edges = [], findings = [], unknowns = [];
const addNode = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, { facts: [], ...n }); return nodes.get(n.id); };
function addEdge(from, to, kind, e, extra = {}) {
  let edge = edges.find((x) => x.from === from && x.to === to && x.kind === kind);
  if (!edge) { edge = { id: "e" + (edges.length + 1), from, to, kind, certainty: "proven", evidence: [], ...extra }; edges.push(edge); }
  if (e && edge.evidence.length < 6 && !edge.evidence.some((x) => x.file === e.file && x.line === e.line)) edge.evidence.push(e);
  return edge;
}
const evChain = (eff) => [...eff.via.map((v) => ({ ...v.ev, note: v.ref === "renders" ? `renders <${v.fn}>` : v.ref === "passes" ? `hands ${v.fn}() to other code` : v.ref === "wraps" ? `runs inside ${v.fn}()` : `calls ${v.fn}()` })), eff.site.ev];
const viaText = (eff) => eff.via.filter((v) => v.ref !== "renders").map((v) => v.fn + "()");

for (const [name, t] of tables) addNode({ id: "table:" + name, kind: "table", name, sub: "Table", file: t.ev.file, line: t.ev.line, ev: t.ev, fields: t.fields, external: t.external, rls: sqlRls.get(name) || (t.sql ? { enabled: false, policies: [] } : undefined) });
for (const [name, t] of tables) for (const r of t.relations) {
  if (!tables.has(r.to)) continue;
  addEdge("table:" + name, "table:" + r.to, "relation", { file: t.ev.file, line: r.line, code: r.code }, { label: `each ${name} belongs to a ${r.to}` });
}
function tableNodeFor(model, eff) {
  const t = tableName(model);
  const id = "table:" + t;
  if (!nodes.has(id)) addNode({ id, kind: "table", name: t, sub: tables.size ? "Table (not in schema)" : "Table", ev: eff.site.ev });
  return id;
}
function serviceNode(pkg) {
  const s = SERVICES[pkg];
  return addNode({ id: "service:" + s.name, kind: "service", name: s.name, sub: `Outside service · ${s.what}`, pkg }).id;
}
const routeIndex = routes.map((r) => ({ ...r, segs: r.route.split("/").filter(Boolean) }));
function matchRoute(u, method) {
  const hits = routeIndex.filter((r) => {
    if (r.segs.length !== u.segs.length && !r.segs.some((s) => s.endsWith("*"))) return false;
    return u.segs.every((s, i) => { const rs = r.segs[i]; if (rs === undefined) return false; return rs.startsWith(":") || s === "*" || s === rs; });
  });
  const exact = hits.filter((r) => r.method === method || r.method === "ANY");
  return { exact, anyMethod: hits };
}

// Routes
for (const r of routes) {
  const m = F.get(r.file);
  const id = `route:${r.method} ${r.route}`;
  const fn = m.fns.get(r.local);
  const node = addNode({ id, kind: "route", name: r.route, sub: r.method === "ANY" ? "Any method" : r.method, method: r.method, file: m.rel, line: fn ? lineOf(m.sf, fn) : 1, ev: fn ? ev(m, fn, 6) : null });
  const effects = unitEffects(m, r.local);
  node.effects = effects;
}
// Server actions
const actionId = (t) => `action:${t.local}() ${t.m.rel}`;
for (const m of F.values()) for (const local of m.fns.keys()) {
  if (!isAction(m, local)) continue;
  const fn = m.fns.get(local);
  const node = addNode({ id: actionId({ m, local }), kind: "action", name: local + "()", sub: "Server action", file: m.rel, line: lineOf(m.sf, fn), ev: ev(m, fn, 6) });
  node.effects = unitEffects(m, local);
}
// Pages
for (const p of pages) {
  const m = F.get(p.file);
  const files = reach(p.file);
  const client = [...files].some((f) => F.get(f)?.directives.has("use client"));
  const pageClient = m.directives.has("use client");
  const def = m.exportsMap.get("default");
  const fn = def ? m.fns.get(def.local) : null;
  const node = addNode({ id: (p.layout ? "layout:" : "page:") + p.route + (p.group ? " " + p.group : ""), kind: "page", layout: !!p.layout, name: p.layout ? (p.group ? `Frame around pages in ${p.group}${p.route === "/" ? "" : " under " + p.route}` : `Frame around ${p.route === "/" ? "every page" : p.route + "/…"}`) : p.route, route: p.route, sub: pageClient ? "Page · runs in the browser" : client ? "Page · server-built, interactive parts" : "Page · built on the server", file: m.rel, line: fn ? lineOf(m.sf, fn) : 1, ev: fn ? ev(m, fn, 4) : ev(m, m.sf.statements[0] || m.sf, 2), files: [...files].map(rel) });
  const effects = def ? unitEffects(m, def.local, new Set(), true).slice() : [];
  // de-duplicate effects that were reached through several functions
  const seen = new Set();
  // (two different tables read on one line, e.g. a select and its join, are two effects)
  node.effects = effects.filter((e) => { const k = [e.type, e.site.ev.file, e.site.ev.line, e.model, e.op, e.name, e.pkg, e.call, e.url?.path, e.conditional ? "cond" : ""].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  node.client = client; node.pageClient = pageClient;
}

let unknownCount = 0;
// ---------- static web apps: plain HTML pages + JS modules ----------
const staticInfo = { on: false };
{
  let vc = {}; try { vc = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")); } catch {}
  const webRoot = !appDir && !pagesDir ? [vc.outputDirectory, "public", "dist", "site", "www", "."].filter(Boolean).map((d) => path.resolve(root, d)).find((d) => fs.existsSync(path.join(d, "index.html"))) : null;
  if (webRoot) {
    Object.assign(staticInfo, { on: true, webRoot: rel(webRoot) || ".", cleanUrls: !!vc.cleanUrls });
    const routeOf = (f) => { let r = path.relative(webRoot, f).split(path.sep).join("/").replace(/\.html$/, ""); r = r.replace(/(^|\/)index$/, ""); return "/" + r + (vc.cleanUrls || !r ? "" : ".html"); };
    const htmlFiles = allFiles.filter((f) => f.endsWith(".html") && f.startsWith(webRoot + path.sep) && !/\/(node_modules|assets)\//.test(f));
    const moduleFiles = new Set(), loads = [], usedBy = new Map(), pageBase = new Map();
    // folder (under the web root) that a relative address points to, for each page that uses this module
    const assetDirs = (modFile, p) => {
      if (p.startsWith("/")) return [p.split("/").filter(Boolean)[0] || "/"];
      const bases = [...new Set([...(usedBy.get(modFile) || [])].map((pg) => pageBase.get(pg)).filter(Boolean))];
      return [...new Set((bases.length ? bases : [webRoot]).map((b) => path.relative(webRoot, path.resolve(b, p)).split(path.sep)[0]))];
    };
    for (const f of htmlFiles) {
      const html = fs.readFileSync(f, "utf8");
      const lineAt = (i) => html.slice(0, i).split("\n").length;
      const route = routeOf(f);
      const title = html.match(/<title>([^<]*)<\/title>/i);
      const baseHref = html.match(/<base\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
      const baseDir = baseHref ? (baseHref.startsWith("/") ? path.join(webRoot, baseHref) : path.resolve(path.dirname(f), baseHref)) : path.dirname(f);
      const resolveUrl = (u) => tryFile(u.startsWith("/") ? path.join(webRoot, u.split(/[?#]/)[0]) : path.resolve(baseDir, u.split(/[?#]/)[0]));
      let importMap = {};
      const im = html.match(/<script\b[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
      if (im) { try { importMap = JSON.parse(im[1]).imports || {}; } catch {} }
      // bare imports ("three", "three/addons/...") resolved through this page's import map
      const mapSpec = (spec) => {
        if (importMap[spec]) return resolveUrl(importMap[spec]);
        const pre = Object.keys(importMap).filter((k) => k.endsWith("/") && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
        return pre ? resolveUrl(importMap[pre] + spec.slice(pre.length)) : null;
      };
      const pageReach = (start) => {
        const seen = new Set([start]), q = [start];
        while (q.length) {
          const cur = q.shift(), cm = F.get(cur); if (!cm) continue;
          for (const imp of cm.imports) {
            if (imp.typeOnly) continue;
            let t = imp.resolved;
            if (!t && imp.pkg && Object.keys(importMap).length) { t = mapSpec(imp.spec); if (t) { imp.resolved = t; imp.viaImportMap = true; } }
            if (t && !seen.has(t)) { seen.add(t); q.push(t); }
          }
        }
        return seen;
      };
      const entries = [];
      for (const mt of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = mt[1], type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        if (type && !/module|javascript/i.test(type)) continue;
        const line = lineAt(mt.index), code = mt[0].split("\n")[0].slice(0, 160);
        const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
        if (src) {
          if (/^(https?:)?\/\//.test(src)) { const host = src.replace(/^(https?:)?\/\//, "").split("/")[0]; entries.push({ host, ev: { file: rel(f), line, code } }); continue; }
          const target = resolveUrl(src);
          if (target) entries.push({ file: target, ev: { file: rel(f), line, code } });
        } else if (/module/i.test(type)) {
          const isf = ts.createSourceFile(f + ".inline.js", mt[2], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
          const addSpec = (spec, n) => { const t = /^[./]/.test(spec) ? resolveUrl(spec) : mapSpec(spec); if (t) entries.push({ file: t, ev: { file: rel(f), line: line + isf.getLineAndCharacterOfPosition(n.getStart(isf)).line, code: n.getText(isf).split("\n")[0].slice(0, 160) } }); };
          const v = (n) => { if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) addSpec(n.moduleSpecifier.text, n); if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) addSpec(n.arguments[0].text, n); ts.forEachChild(n, v); };
          v(isf);
        }
      }
      const files = new Set();
      for (const e of entries) if (e.file) for (const g of pageReach(e.file)) files.add(g);
      files.forEach((g) => { moduleFiles.add(g); (usedBy.get(g) || usedBy.set(g, new Set()).get(g)).add("page:" + route); });
      pageBase.set("page:" + route, baseHref ? baseDir : path.join(webRoot, path.dirname(path.relative(webRoot, f))));
      const node = addNode({ id: "page:" + route, kind: "page", name: route, route, sub: "Page · plain HTML", file: rel(f), line: title ? lineAt(title.index) : 1,
        ev: title ? { file: rel(f), line: lineAt(title.index), code: title[0] } : { file: rel(f), line: 1, code: html.split("\n")[0] }, files: [...files].map(rel) });
      node.client = node.pageClient = true; node.title = title?.[1]?.trim();
      loads.push({ page: node.id, entries });
    }
    // service workers and web workers registered from page code; their files are modules too
    const regs = [];
    for (const f of [...moduleFiles]) {
      const m = F.get(f);
      const v = (n) => {
        if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments?.[0]) {
          const callee = n.expression.getText(m.sf);
          const isSW = /serviceWorker\.register$/.test(callee), isW = ts.isNewExpression(n) && /^(Shared)?Worker$/.test(callee);
          if (isSW || isW) {
            let a = unwrap(n.arguments[0]);
            if (ts.isNewExpression(a) && a.expression.getText(m.sf) === "URL" && a.arguments?.[0]) a = a.arguments[0];
            if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
              const t = tryFile(a.text.startsWith("/") ? path.join(webRoot, a.text) : path.resolve(path.dirname(f), a.text));
              if (t) regs.push({ from: f, file: t, sw: isSW, ev: ev(m, n, 2) });
            }
          }
        }
        ts.forEachChild(n, v);
      };
      v(m.sf);
    }
    for (const r of regs) for (const g of reach(r.file)) { moduleFiles.add(g); for (const p of usedBy.get(r.from) || []) (usedBy.get(g) || usedBy.set(g, new Set()).get(g)).add(p); }
    const swSet = new Set(regs.filter((r) => r.sw).map((r) => r.file));
    staticInfo.serviceWorkers = [...swSet].map(rel);
    const modId = (f) => "module:" + rel(f);
    for (const f of moduleFiles) {
      const m = F.get(f); if (!m) continue;
      const n = addNode({ id: modId(f), kind: "module", name: path.basename(f), sub: swSet.has(f) ? "Service worker · offline cache" : regs.some((r) => r.file === f) ? "Web worker" : rel(path.dirname(f)) + "/", file: m.rel, line: 1, loc: m.lines.length,
        ev: { file: m.rel, line: 1, endLine: m.lines.length, code: m.lines.slice(0, 6).join("\n") + (m.lines.length > 6 ? "\n…" : "") } });
      n.usedBy = [...(usedBy.get(f) || [])];
      n.sw = swSet.has(f);
    }
    for (const l of loads) for (const e of l.entries) {
      if (e.host) { const hid = "host:" + e.host; addNode({ id: hid, kind: "host", name: e.host, sub: "Outside address · script" }); addEdge(l.page, hid, "load", e.ev, { label: "loads a script from" }); }
      else if (nodes.has(modId(e.file))) addEdge(l.page, modId(e.file), "load", e.ev, { label: "loads" });
    }
    for (const r of regs) if (nodes.has(modId(r.from)) && nodes.has(modId(r.file))) addEdge(modId(r.from), modId(r.file), "register", r.ev, { label: r.sw ? "installs as service worker" : "starts as worker" });
    // module imports
    for (const f of moduleFiles) {
      const m = F.get(f); if (!m) continue;
      for (const imp of m.imports) if (imp.resolved && !imp.typeOnly && nodes.has(modId(imp.resolved)))
        addEdge(modId(f), modId(imp.resolved), "import", { file: m.rel, line: imp.line, code: m.lines[imp.line - 1].trim().slice(0, 200), ...(imp.viaImportMap ? { note: `"${imp.spec}" is mapped to this file by the page's import map` } : {}) }, { label: imp.dynamic ? "loads on demand" : imp.reexport ? "re-exports" : imp.classic ? "loads (importScripts)" : "uses" });
    }
    // what each module does: network, saved data, links
    // Every text value an expression can take, as far as the code fixes it. Unknown parts become "*".
    const strsOf = (m, e, depth = 0) => {
      e = unwrap(e); if (!e || depth > 6) return [];
      const cap = (xs) => [...new Set(xs)].slice(0, 12);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
      if (ts.isTemplateExpression(e)) {
        let acc = [e.head.text];
        for (const sp of e.templateSpans) { const v = strsOf(m, sp.expression, depth + 1); const vs = v.length ? v : ["*"]; acc = cap(acc.flatMap((a) => vs.map((x) => a + x + sp.literal.text))); }
        return acc;
      }
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const l = strsOf(m, e.left, depth + 1), r = strsOf(m, e.right, depth + 1);
        if (!l.length && !r.length) return [];
        return cap((l.length ? l : ["*"]).flatMap((a) => (r.length ? r : ["*"]).map((b) => a + b)));
      }
      if (ts.isConditionalExpression(e)) return cap([...strsOf(m, e.whenTrue, depth + 1), ...strsOf(m, e.whenFalse, depth + 1)]);
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return cap([...strsOf(m, e.left, depth + 1), ...strsOf(m, e.right, depth + 1)]);
      if (ts.isCallExpression(e) && e.expression.getText(m.sf) === "Object.freeze" && e.arguments[0]) return strsOf(m, e.arguments[0], depth + 1);
      if (ts.isObjectLiteralExpression(e)) return cap(e.properties.filter(ts.isPropertyAssignment).flatMap((p) => strsOf(m, p.initializer, depth + 1)));
      if (ts.isElementAccessExpression(e) || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression))) {
        const objVals = constInit(m, e.expression);
        if (objVals) {
          const [om, init] = objVals; const o = unwrap(ts.isCallExpression(unwrap(init)) && unwrap(init).arguments?.[0] ? unwrap(init).arguments[0] : init);
          if (o && ts.isObjectLiteralExpression(o)) {
            if (ts.isPropertyAccessExpression(e)) { const p = o.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(om.sf) === e.name.text); return p ? strsOf(om, p.initializer, depth + 1) : []; }
            return strsOf(om, o, depth + 1);
          }
        }
        return [];
      }
      if (ts.isIdentifier(e)) { const ci = constInit(m, e); return ci ? strsOf(ci[0], ci[1], depth + 1) : []; }
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
        let fm = m, fn = m.fns.get(e.expression.text);
        const imp = m.importMap.get(e.expression.text);
        if (!fn && imp?.resolved) { const x = findExport(imp.resolved, imp.imported); if (x) { fm = x.m; fn = x.m.fns.get(x.local); } }
        if (fn?.body) {
          const rets = ts.isBlock(fn.body) ? [] : [fn.body];
          if (ts.isBlock(fn.body)) { const v = (n) => { if (ts.isReturnStatement(n) && n.expression) rets.push(n.expression); if (!ts.isFunctionLike(n)) ts.forEachChild(n, v); }; fn.body.statements.forEach(v); }
          return cap(rets.flatMap((r) => strsOf(fm, r, depth + 1)));
        }
      }
      return [];
    };
    // the initializer of a module-level const, following imports
    function constInit(m, id) {
      if (!ts.isIdentifier(id)) return null;
      for (let p = id.parent; p; p = p.parent) {
        const stmts = ts.isBlock(p) || ts.isSourceFile(p) ? p.statements : null;
        if (!stmts) continue;
        for (const st of stmts) if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const))
          for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer) return [m, d.initializer];
      }
      if (m.vars.has(id.text) && m.vars.get(id.text)) return [m, m.vars.get(id.text)];
      const imp = m.importMap.get(id.text);
      if (imp?.resolved) { const x = findExport(imp.resolved, imp.imported); if (x?.m.vars.get(x.local)) return [x.m, x.m.vars.get(x.local)]; }
      return null;
    }
    // A key that is a function parameter: look for defaults given to a parameter of the same name in this file.
    const paramDefaults = (m, e) => {
      e = unwrap(e); if (!ts.isIdentifier(e)) return null;
      let fn = e.parent; while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      if (!fn?.parameters?.some((p) => ts.isIdentifier(p.name) && p.name.text === e.text)) return null;
      const out = [];
      const v = (n) => { if ((ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer) for (const k of strsOf(m, n.initializer)) out.push({ key: k, ev: ev(m, n, 1) }); ts.forEachChild(n, v); };
      v(m.sf);
      return out;
    };
    const isVendor = (f) => /\/(vendor|vendors|lib\/third[-_]party|node_modules)\//.test(rel(f)) || /\.min\.js$/.test(f);
    for (const f of moduleFiles) if (isVendor(f) && nodes.has(modId(f))) { const n = nodes.get(modId(f)); n.vendor = true; n.sub = "Third-party library"; }
    for (const f of moduleFiles) {
      const m = F.get(f); if (!m) continue;
      const id = modId(f);
      if (isVendor(f)) continue;
      const fetchArgs = new Set();
      const eff = directEffects(m, "<module>", { body: m.sf, parameters: [] });
      for (const e of eff) {
        if (e.type === "fetch") {
          fetchArgs.add(e.site.node.arguments[0]);
          if (e.url.kind === "external") { const hid = "host:" + e.url.host; addNode({ id: hid, kind: "host", name: e.url.host, sub: "Outside address" }); addEdge(id, hid, "request", e.site.ev, { label: e.method }); }
          else if (e.url.kind === "asset" || e.url.kind === "internal") for (const dir of assetDirs(f, e.url.path)) { const aid = "asset:" + dir; addNode({ id: aid, kind: "asset", name: dir + "/", sub: "Files shipped with the app" }); const ed = addEdge(id, aid, "fetchfile", e.site.ev, { label: "fetches" }); (ed.paths ||= new Set()).add(e.url.path); }
          else if (e.url.kind === "unresolved" && strsOf(m, e.site.node.arguments[0]).some((x) => !x.startsWith("*"))) {
            for (const val of strsOf(m, e.site.node.arguments[0]).filter((x) => !x.startsWith("*"))) {
              const u = fromPattern(val.replace(/\*/g, "\u0000"), val);
              if (u.kind === "external") { const hid = "host:" + u.host; addNode({ id: hid, kind: "host", name: u.host, sub: "Outside address" }); addEdge(id, hid, "request", e.site.ev, { label: e.method }); }
              else if (u.kind === "asset" || u.kind === "internal") for (const dir of assetDirs(f, u.path || val)) { const aid = "asset:" + dir; addNode({ id: aid, kind: "asset", name: dir + "/", sub: "Files shipped with the app" }); const ed = addEdge(id, aid, "fetchfile", e.site.ev, { label: "fetches" }); (ed.paths ||= new Set()).add(u.path || val); }
            }
          }
          else if (swSet.has(f) && /request/i.test(e.url.expr)) { (nodes.get(id).facts ||= []).push({ text: "Answers the pages' own requests from its cache or the network.", evidence: [e.site.ev] }); }
          else {
            const key = e.url.source || e.url.expr;
            let un = [...nodes.values()].find((n) => n.kind === "unknown" && n.key === key);
            if (!un) { un = addNode({ id: "unknown:" + (++unknownCount), kind: "unknown", key, name: "Unresolved address", sub: "Built at runtime" }); unknowns.push({ node: un.id, expr: e.url.expr, source: e.url.source, evidence: [e.site.ev] }); }
            addEdge(id, un.id, "request", e.site.ev, { certainty: "unresolved", label: e.method });
          }
        } else if (e.type === "service") addEdge(id, serviceNode(e.pkg), "service", e.site.ev, { label: e.call.split(".").slice(1).join(".") });
      }
      const v = (n) => {
        if (ts.isCallExpression(n)) {
          const ch = chainOf(n.expression);
          const i = ch ? ch.findIndex((x) => x === "localStorage" || x === "sessionStorage") : -1;
          if (i >= 0 && /^(getItem|setItem|removeItem)$/.test(ch[i + 1] || "")) {
            const store = ch[i], op = ch[i + 1], arg = n.arguments[0];
            const kind = op === "getItem" ? "read" : "write", label = op === "getItem" ? "reads" : op === "setItem" ? "saves" : "deletes";
            let keys = arg ? strsOf(m, arg).map((k) => ({ key: k, certainty: "proven" })) : [];
            if (!keys.length && arg) { const d = paramDefaults(m, arg); if (d?.length) keys = d.map((x) => ({ key: x.key, certainty: "inferred", ev: x.ev, why: `The key is passed in as "${arg.getText(m.sf)}". In ${m.rel} it defaults to "${x.key}", so that's the key unless a caller picks another.` })); }
            if (!keys.length) keys = [{ key: null, certainty: "unresolved" }];
            for (const k of keys) {
              const name = k.key ?? "(key built at runtime)";
              const sid = `store:${store}:${name}`;
              const sn = addNode({ id: sid, kind: "storage", name, store, sub: `Saved in this browser · ${store}`, certain: k.key != null });
              if (k.key && k.certainty === "proven") sn.certain = true;
              const ed = addEdge(id, sid, kind, ev(m, n, 2), { label, certainty: k.certainty });
              if (k.certainty === "proven") ed.certainty = "proven";
              if (k.ev && !ed.evidence.some((x) => x.line === k.ev.line && x.file === k.ev.file)) ed.evidence.push({ ...k.ev, note: "the default key" });
              if (k.why && ed.certainty !== "proven") ed.why = k.why;
              (ed.ops ||= new Set()).add(op);
            }
          }
          if (ch && /^(indexedDB|caches)$/.test(ch[ch.length - 2] || "") && ch[ch.length - 1] === "open" && n.arguments[0]) {
            const key = strsOf(m, n.arguments[0])[0] ?? "(name built at runtime)";
            const sid = `store:${ch[ch.length - 2]}:${key}`;
            addNode({ id: sid, kind: "storage", name: key, store: ch[ch.length - 2], sub: ch[ch.length - 2] === "caches" ? "Offline cache in this browser" : "Database in this browser · IndexedDB" });
            addEdge(id, sid, "write", ev(m, n, 2), { label: "opens" });
          }
        }
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !fetchArgs.has(n) && /^https?:\/\/[^/\s]+/.test(n.text) && !/w3\.org|schema\.org|xmlns/.test(n.text)) {
          const host = n.text.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
          const hid = "host:" + host;
          addNode({ id: hid, kind: "host", name: host, sub: "Outside address" });
          const ed = addEdge(id, hid, "link", ev(m, n, 1), { label: "links to" });
          if (/REPLACE|YOUR_|TODO|example\.com/i.test(n.text)) ed.placeholder = true;
        }
        ts.forEachChild(n, v);
      };
      v(m.sf);
    }
    for (const e of edges.filter((e) => e.placeholder)) {
      findings.push({ rule: "placeholder-link", sev: "info", node: e.from, title: `Placeholder link to ${nodes.get(e.to).name}`, text: "This address still contains a placeholder, so following it won't reach a real page yet.", evidence: e.evidence });
    }
  }
}
// Cloudflare Workers: entry from wrangler.toml "main", handler from `export default { fetch }`
for (const w of allFiles.filter((f) => path.basename(f) === "wrangler.toml")) {
  const toml = fs.readFileSync(w, "utf8");
  const main = toml.match(/^\s*main\s*=\s*["']([^"']+)["']/m)?.[1];
  const name = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || path.basename(path.dirname(w));
  const entry = main ? tryFile(path.resolve(path.dirname(w), main)) : tryFile(path.join(path.dirname(w), "src/index")) || tryFile(path.join(path.dirname(w), "worker"));
  const m = entry && F.get(entry);
  if (!m) continue;
  for (const h of ["fetch", "scheduled", "queue", "email"]) {
    if (!m.fns.has("__default." + h)) continue;
    const id = `route:${h === "fetch" ? "ANY" : h.toUpperCase()} worker:${name}`;
    const node = addNode({ id, kind: "route", worker: true, name, route: "worker:" + name, method: h === "fetch" ? "ANY" : h, sub: `Cloudflare Worker · ${h} handler`, file: m.rel, line: lineOf(m.sf, m.fns.get("__default." + h)), ev: ev(m, m.fns.get("__default." + h), 4) });
    node.effects = unitEffects(m, "__default." + h);
    const ver = node.effects.find((e) => e.type === "verify" && /stripe/i.test(e.call));
    if (ver) {
      addNode({ id: "service:Stripe", kind: "service", name: "Stripe", sub: "Outside service · payments" });
      addEdge("service:Stripe", id, "callback", null, { certainty: "inferred", label: "calls", why: `The worker checks a Stripe signature (${ver.call}), so Stripe is expected to call it. The address it calls is set in Stripe's dashboard, not in the code.` });
      node.verified = true;
    }
  }
}

// Effects -> edges, per node
for (const node of [...nodes.values()].filter((n) => n.kind === "route" || n.kind === "page" || n.kind === "action")) {
  for (const e of node.effects || []) {
    const chain = evChain(e);
    if (e.type === "action") {
      const ed = addEdge(node.id, actionId(e.target), "request", e.site.ev, { label: e.ref === "passes" ? `hands ${e.name}() to a form or button` : `calls ${e.name}()`,
        ...(e.conditional ? { certainty: "inferred", why: `Chosen in the code by the condition ${e.conditional.slice(0, 60)}, which Plainsight doesn't evaluate for each page.` } : {}) });
      // the same action reached unconditionally elsewhere on this page is proven
      if (!e.conditional && ed.certainty === "inferred" && ed.why?.startsWith("Chosen in the code")) { ed.certainty = "proven"; delete ed.why; }
      if (chain.length > 1) ed.evidence = chain;
      continue;
    }
    if (e.type === "fetch") {
      if (e.url.kind === "internal") {
        const { exact, anyMethod } = matchRoute(e.url, e.method);
        if (exact.length) for (const r of exact) addEdge(node.id, `route:${r.method} ${r.route}`, "request", e.site.ev, { label: `${e.method} ${e.url.path}` });
        else if (e.url.path.startsWith("/api") || anyMethod.length) {
          findings.push({ rule: "missing-route", sev: "warn", node: node.id, title: anyMethod.length ? `Calls ${e.method} ${e.url.path}, which has no ${e.method} handler` : `Calls ${e.url.path}, which doesn't exist`,
            text: anyMethod.length ? `The route exists but only handles ${anyMethod.map((r) => r.method).join(", ")}. This request will fail.` : "No route file in the app matches this address, so this request will fail.", evidence: chain });
        }
      } else if (e.url.kind === "external") {
        const hid = "host:" + e.url.host;
        addNode({ id: hid, kind: "host", name: e.url.host, sub: "Outside address" });
        addEdge(node.id, hid, "request", e.site.ev, { label: e.method });
      } else {
        const key = e.url.source || e.url.expr;
        let un = [...nodes.values()].find((n) => n.kind === "unknown" && n.key === key);
        if (!un) {
          un = addNode({ id: "unknown:" + (++unknownCount), kind: "unknown", key, name: "Unresolved address", sub: e.url.source ? "Set outside the code" : "Built at runtime" });
          unknowns.push({ node: un.id, expr: e.url.expr, source: e.url.source, evidence: [...chain, ...(e.url.sourceEv ? [e.url.sourceEv] : [])] });
        }
        addEdge(node.id, un.id, "request", e.site.ev, { certainty: "unresolved", label: e.method, evidence: [] });
        const edge = edges.find((x) => x.from === node.id && x.to === un.id);
        edge.evidence = chain;
      }
    } else if (e.type === "db") {
      const tid = tableNodeFor(e.model, e);
      const ed = addEdge(node.id, tid, e.write ? "write" : "read", chain[chain.length - 1], { label: e.write ? "writes" : "reads" });
      (ed.ops ||= new Set()).add(e.op);
      if (e.admin) { ed.admin = true; ed.adminEv = e.adminEv; }
    } else if (e.type === "service") {
      const sid = serviceNode(e.pkg);
      const ed = addEdge(node.id, sid, "service", chain[chain.length - 1], { label: e.call.split(".").slice(1).join(".") });
      (ed.calls ||= new Set()).add(e.call.split(".").slice(1).join("."));
      ed.label = [...ed.calls].slice(0, 2).join(", ") + (ed.calls.size > 2 ? ` +${ed.calls.size - 2}` : "");
      const vt = viaText(e); if (vt.length) ed.via = vt;
    }
  }
}
// Webhook routes: who calls them can't be proven from code. Infer from naming, and say so.
for (const node of nodes.values()) {
  if (node.kind !== "route" || !/webhook/i.test(node.name)) continue;
  for (const s of [...nodes.values()].filter((n) => n.kind === "service")) {
    if (node.name.toLowerCase().includes(s.name.toLowerCase())) addEdge(s.id, node.id, "callback", null, { certainty: "inferred", label: "calls back", why: `Only the route's name says ${s.name} calls it. That's set in ${s.name}'s dashboard, which isn't in the code.` });
  }
}

// ---------- guards & findings ----------
for (const node of nodes.values()) {
  if (node.kind !== "route" && node.kind !== "page" && node.kind !== "action") continue;
  // a login lookup inside a helper that only runs on one branch says nothing about this request's login
  const authE = (node.effects || []).filter((e) => e.type === "auth" && !e.conditional && !e.via.some((v) => v.ref === "passes"));
  const counts = (e) => e.enforced && (e.via.length === 0 || e.stop === "throw" || e.via[0]?.ref === "wraps");
  const enforced = authE.find((e) => counts(e) && e.full) || authE.find(counts);
  const mw = node.kind === "action" ? null : middlewareGuard(node.route || node.name);
  const where = (e) => e.via.length ? `in ${e.via.map((v) => v.fn + "()").join(" → ")}` : "in this handler";
  if (enforced?.full) node.guard = { status: "checked", where: where(enforced), how: enforced.how, certainty: enforced.certainty, evidence: evChain(enforced) };
  else if (mw && !mw.unknown) node.guard = { status: "checked", where: "by middleware", how: mw.how, certainty: "proven", evidence: [mw.ev, mw.authEv].filter(Boolean) };
  else if (mw?.unknown && !enforced) node.guard = { status: "external", how: mw.how, certainty: "unresolved", evidence: [mw.ev].filter(Boolean) };
  else if (enforced) node.guard = { status: "partial", where: where(enforced), how: enforced.how, certainty: enforced.certainty, evidence: evChain(enforced) };
  else if (authE.length) node.guard = { status: "unenforced", how: `calls ${authE[0].name}() but never stops the request when nobody is logged in`, evidence: evChain(authE[0]) };
  else node.guard = { status: "none" };
  // an API key or secret read from the request and handed to a library: the check happens where Plainsight can't see
  if (node.guard.status === "none" && node.file) {
    // only this handler's own lines count (not other handlers or outbound keys elsewhere in the file)
    const src = [...F.values()].find((x) => x.rel === node.file);
    const from = (node.ev?.line || 1) - 1, to = node.ev?.endLine || from + 1;
    const own = src ? src.lines.slice(from, to) : [];
    const at = (re) => { const i = own.findIndex((l) => re.test(l)); return i < 0 ? -1 : from + i; };
    // a key read from the incoming request's headers, not an API key the code sends out
    const hit = at(/\.get\(\s*["'](authorization|x-api-key)["']\s*\)/i);
    const ipHit = own.some((l) => /\b(throw|return)\b/.test(l)) ? at(/isIpInRange|ip_?ranges|allowed_?ips|ip_?allow/i) : -1;
    if (ipHit >= 0) node.guard = { status: "external", how: "only accepts requests from a list of IP addresses", certainty: "inferred", evidence: [{ file: node.file, line: ipHit + 1, code: src.lines[ipHit].trim() }] };
    else if (hit >= 0) node.guard = { status: "external", how: "reads a key from the request's headers and hands it on; the check itself isn't in this code", certainty: "unresolved", evidence: [{ file: node.file, line: hit + 1, code: src.lines[hit].trim() }] };
  }
}
for (const node of nodes.values()) {
  if (node.kind !== "route" && node.kind !== "action") continue;
  const eff = node.effects || [];
  const dbE = eff.filter((e) => e.type === "db");
  // an incoming webhook receives POSTs from another service; routes that manage webhook settings behind a login are not one
  const isWebhook = node.kind === "route" && /webhook/i.test(node.name) && /^(POST|ANY)$/.test(node.method) && node.guard.status !== "checked";
  if (isWebhook) {
    const verified = eff.some((e) => (e.type === "service" && e.verify) || (e.type === "verify" && e.enforced));
    node.verified = verified;
    if (!verified && dbE.length) findings.push({ rule: "unsigned-webhook", sev: "warn", node: node.id, title: "Accepts messages without checking who sent them",
      text: `This webhook changes the database (${[...new Set(dbE.map((e) => tableName(e.model)))].join(", ")}) but never verifies a signature. Anyone who finds the address can send a fake message.`, evidence: dbE.map((e) => evChain(e)).flat() });
    continue;
  }
  if (node.guard.status !== "checked") {
    // a check that only applies to private records is usually a deliberate public mode: list it for review
    const undefFilter = dbE.filter((e) => e.whereOptionalAuth);
    const publicMode = node.guard.status === "partial" && /public|visib|publish|shared|private/i.test(node.guard.how);
    if (node.guard.status === "partial") findings.push({ rule: "partial-login", sev: publicMode ? "info" : "warn", node: node.id, title: "Login check only covers one case", text: `It ${node.guard.how}. Other requests go through without a login.`, evidence: node.guard.evidence });
    if (undefFilter.length) {
      const writes = [...new Set(dbE.filter((e) => e.write).map((e) => tableName(e.model)))];
      findings.push({ rule: "logged-out-owner", sev: "crit", node: node.id, title: "Logged-out visitors pass the ownership check",
        text: `The login is only used inside a database filter (${undefFilter[0].whereOptionalAuth.code.replace(/\s+/g, " ").slice(0, 80)}). When nobody is logged in that value is undefined, and Prisma drops filters that are undefined, so the check matches the record anyway${writes.length ? ` and the request goes on to change ${writes.join(", ")}` : ""}. Stop the request when there's no login before querying.`,
        evidence: [...undefFilter.map((e) => evChain(e)).flat(), undefFilter[0].whereOptionalAuth] });
    }
    const fromReq = undefFilter.length ? [] : dbE.filter((e) => e.whereFromRequest);
    // sign-up, sign-in and payment return routes look records up by what the visitor sends, by design
    const byDesign = /sign.?up|sign.?in|log.?in|register|forgot|reset|verify|invit|oauth|callback|checkout|magic|unsubscribe|track|public|embed|share|preview|well-?known|\/og\b|send.?otp|create.?user|account.?exists|email.?change|confirm/i.test(node.name + " " + (node.file || ""));
    // "other people's records" only makes sense for tables with an owner column
    const owned = (model) => (tables.get(tableName(model))?.fields || []).some((f) => /^(user|author|owner|account|team|workspace|project|org|organization|tenant|creator|member)(_?id)?$|(user|owner|author|team|workspace|project|org|tenant)_?id$/i.test(f));
    const tbls = [...new Set(fromReq.map((e) => tableName(e.model)))].join(", ");
    const ownedReq = fromReq.filter((e) => owned(e.model) || !tables.has(tableName(e.model)));
    const external = node.guard.status === "external";
    if (fromReq.length && (publicMode || byDesign || external || !ownedReq.length)) findings.push({ rule: "public-lookup", sev: "info", node: node.id, title: `Looks up ${tbls} records by what the request sends, without a login`,
      text: external ? `It ${node.guard.how}. Check that a missing or wrong key is turned away.` : publicMode ? "The login check covers private records only, so this is likely a deliberate public mode. Check that public records are the only ones it returns."
        : byDesign ? "That's normal for sign-up, sign-in, tracking and payment return flows, which is what this looks like from its name. Check it only returns or changes what it should."
        : "None of these tables has a column naming an owner (like userId), so this may be public data. Check it only returns or changes what it should.", evidence: fromReq.map((e) => evChain(e)).flat() });
    else if (fromReq.length) findings.push({ rule: "others-records", sev: "crit", node: node.id, title: `Anyone can ${fromReq.some((e) => e.write) ? "change" : "read"} other people's ${tbls} records`,
      text: "Which records it uses comes straight from the request, and nothing checks who is asking. Changing a value in the request gets someone else's data.", evidence: fromReq.map((e) => evChain(e)).flat() });
    else if (dbE.length && node.guard.status === "none") findings.push({ rule: "open-route", sev: "info", node: node.id, title: "Open to anyone, no login check", text: "This route uses the database without checking a login. That can be intended (sign-up, public data), so it's listed for review, not as a bug.", evidence: [node.ev].filter(Boolean) });
    // only a problem worth fixing when the request can change something; otherwise list it for review
    if (node.guard.status === "unenforced" && !undefFilter.length) findings.push({ rule: "login-not-enforced", sev: dbE.some((e) => e.write) ? "warn" : "info", node: node.id, title: "Looks up the login but doesn't act on it", text: node.guard.how + (dbE.some((e) => e.write) ? ", and it changes data" : ""), evidence: node.guard.evidence });
  }
  // external call after a write, with no error handling
  const firstWrite = dbE.filter((e) => e.write).sort((a, b) => a.entry.pos - b.entry.pos)[0];
  if (firstWrite) {
    const later = eff.filter((e) => (e.type === "service" || e.type === "fetch") && e.entry.pos > firstWrite.entry.pos && !e.entry.inTry && !e.site.inTry);
    for (const e of later) {
      const who = e.type === "service" ? SERVICES[e.pkg].name : e.url.kind === "external" ? e.url.host : "an unresolved address";
      findings.push({ rule: "fails-after-save", sev: "info", node: node.id, title: `If ${who} fails, the request fails after data was saved`,
        text: `The call to ${who} isn't wrapped in error handling and happens after the ${tableName(firstWrite.model)} write. A failure there shows the user an error even though the record already exists.`, evidence: [...evChain(firstWrite), ...evChain(e)] });
    }
  }
}
// secrets: browser-bound if reachable from any "use client" file
const browserFiles = new Set();
for (const m of F.values()) if (m.directives.has("use client")) for (const f of reach(m.file)) browserFiles.add(f);
for (const m of F.values()) for (const s of m.secrets) {
  const inBrowser = browserFiles.has(m.file);
  // a key in a test or fixture is almost always a planted fake; only a browser-bound one is still worth raising
  if (!inBrowser && isTest(m.rel)) continue;
  const who = [...nodes.values()].filter((n) => n.kind === "page" && n.files?.includes(m.rel));
  findings.push({ rule: inBrowser ? "secret-in-browser" : "secret-in-code", sev: inBrowser ? "crit" : "warn", node: who[0]?.id || null, file: m.rel, title: inBrowser ? `${s.label} is sent to the browser` : `${s.label} is written into the code`,
    text: inBrowser ? `${m.rel} contains a ${s.label} and is imported by code that runs in the browser${who.length ? ` (${who.map((w) => w.name).join(", ")})` : ""}. Anyone can open developer tools and copy it.` : `${m.rel} contains a ${s.label}. Anyone with access to the code has it. Move it to an environment variable.`,
    evidence: [{ ...ev(m, s.node, 1), code: m.lines[lineOf(m.sf, s.node) - 1].trim().replace(/(sk_(live|test)_|sk-|AKIA|ghp_|xox.-|re_)([A-Za-z0-9]{4})[A-Za-z0-9_-]+/, "$1$3…") }] });
}

// ---------- coverage ----------
const mapped = new Set();
for (const n of nodes.values()) {
  if (n.kind === "page") n.files.forEach((f) => mapped.add(f));
  if (n.kind === "route" || n.kind === "action") { mapped.add(n.file); for (const f of reach(path.join(root, n.file))) mapped.add(rel(f)); }
}
if (middleware) for (const f of reach(middleware.file)) mapped.add(rel(f));
for (const n of nodes.values()) if (n.kind === "module") mapped.add(n.file);
for (const p of pages) { const dir = path.dirname(p.file); for (const f of sourceFiles) if (/\/(layout|loading|error|not-found|template)\.[jt]sx?$/.test(f) && dir.startsWith(path.dirname(f))) { for (const g of reach(f)) mapped.add(rel(g)); } }
const srcRel = sourceFiles.map(rel);
const tooling = srcRel.filter((r) => !mapped.has(r) && (isToolingConfig(r) || isScripts(r)));
const tests = srcRel.filter((r) => !mapped.has(r) && !isToolingConfig(r) && !isScripts(r) && isTest(r));
const docs = srcRel.filter((r) => !mapped.has(r) && !isToolingConfig(r) && !isScripts(r) && !isTest(r) && isDocs(r));
const unmapped = srcRel.filter((r) => !mapped.has(r) && !isToolingConfig(r) && !isScripts(r) && !isTest(r) && !isDocs(r));

// ---------- plain-English sentences, built only from facts ----------
const list = (xs) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const nodeName = (id) => nodes.get(id)?.name || id;
for (const n of nodes.values()) {
  const out = edges.filter((e) => e.from === n.id), inn = edges.filter((e) => e.to === n.id);
  const S = [];
  if (n.kind === "page" && n.sub === "Page · plain HTML") {
    const direct = out.filter((e) => e.kind === "load");
    S.push({ text: `A page at ${n.name}${n.title ? `, titled "${n.title}"` : ""}. It's a plain HTML file that runs in the visitor's browser.`, evidence: [n.ev] });
    if (direct.length) S.push({ text: `It loads ${list(direct.map((e) => nodeName(e.to)))} directly, which brings in ${n.files.length} script file${n.files.length === 1 ? "" : "s"} in total.`, evidence: direct.flatMap((e) => e.evidence) });
    else S.push({ text: "It doesn't load any scripts. It's static content.", evidence: [] });
  } else if (n.kind === "module") {
    const imps = out.filter((e) => e.kind === "import"), usedIn = inn.filter((e) => e.kind === "import" || e.kind === "load");
    if (n.vendor) { S.push({ text: `A third-party library bundled with the app (${n.file}). Plainsight draws who uses it but doesn't look inside.`, evidence: [] }); const users = inn.filter((e) => e.kind === "import" || e.kind === "load"); if (users.length) S.push({ text: `Used directly by ${list([...new Set(users.map((e) => nodeName(e.from)))].slice(0, 6))}.`, evidence: users.flatMap((e) => e.evidence).slice(0, 6) }); n.explain = S; continue; }
    S.push({ text: n.sw ? `The service worker (${n.file}, ${n.loc} lines). The browser installs it so the game keeps working offline.` : `A script that runs in the visitor's browser: ${n.file}, ${n.loc} lines.`, evidence: [n.ev] });
    const pages = (n.usedBy || []).map((id) => nodeName(id));
    if (pages.length) S.push({ text: pages.length === 1 ? `Only ${pages[0]} uses it.` : `${pages.length} pages use it: ${list(pages.slice(0, 6))}${pages.length > 6 ? ` and ${pages.length - 6} more` : ""}.`, evidence: [] });
    if (imps.length) S.push({ text: `It uses ${imps.length} other module${imps.length === 1 ? "" : "s"}: ${list(imps.slice(0, 6).map((e) => nodeName(e.to)))}${imps.length > 6 ? ` and ${imps.length - 6} more` : ""}.`, evidence: imps.flatMap((e) => e.evidence).slice(0, 8) });
    if (usedIn.length) S.push({ text: `${usedIn.length} part${usedIn.length === 1 ? "" : "s"} use${usedIn.length === 1 ? "s" : ""} it directly.`, evidence: usedIn.flatMap((e) => e.evidence).slice(0, 8) });
    const saves = out.filter((e) => e.to.startsWith("store:") && e.kind === "write"), reads = out.filter((e) => e.to.startsWith("store:") && e.kind === "read");
    const keyName = (e) => nodeName(e.to) + (e.certainty === "inferred" ? " (by default; callers can pass another key)" : "");
    if (saves.length) S.push({ text: `Saves to this browser: ${list(saves.map(keyName))}.`, evidence: saves.flatMap((e) => e.evidence) });
    if (reads.length) S.push({ text: `Reads from this browser: ${list(reads.map(keyName))}.`, evidence: reads.flatMap((e) => e.evidence) });
    const files = out.filter((e) => e.kind === "fetchfile");
    if (files.length) S.push({ text: `Downloads game files from ${list(files.map((e) => nodeName(e.to)))}.`, evidence: files.flatMap((e) => e.evidence) });
    const net = out.filter((e) => e.kind === "request");
    if (net.length) S.push({ text: `Sends requests to ${list(net.map((e) => nodeName(e.to)))}.`, evidence: net.flatMap((e) => e.evidence) });
    const links = out.filter((e) => e.kind === "link");
    if (links.length) S.push({ text: `Contains links to ${list([...new Set(links.map((e) => nodeName(e.to)))])}.`, evidence: links.flatMap((e) => e.evidence) });
    (n.facts || []).forEach((f) => S.push(f));
    if (!imps.length && !saves.length && !reads.length && !files.length && !net.length) S.push({ text: "It doesn't use other modules, saved data or the network on its own.", evidence: [] });
  } else if (n.kind === "storage") {
    const w = inn.filter((e) => e.kind === "write"), r = inn.filter((e) => e.kind === "read");
    S.push({ text: n.store === "caches" ? `An offline cache named "${n.name}" in the visitor's browser.` : n.certain === false ? `Data saved in the visitor's browser (${n.store}) under a key the code builds while running.` : `Data saved in the visitor's browser (${n.store}) under the key "${n.name}". It never leaves that browser by itself.`, evidence: [] });
    const who = (es) => list([...new Set(es.map((e) => nodeName(e.from) + (e.certainty === "inferred" ? " (by default)" : "")))]);
    if (w.length) S.push({ text: `Written by ${who(w)}.`, evidence: w.flatMap((e) => e.evidence) });
    if (r.length) S.push({ text: `Read by ${who(r)}.`, evidence: r.flatMap((e) => e.evidence) });
  } else if (n.kind === "asset") {
    const paths = [...new Set(inn.flatMap((e) => [...(e.paths || [])]))];
    S.push({ text: `Files that ship with the app, in the ${n.name} folder. Requested as: ${list(paths.slice(0, 4))}${paths.length > 4 ? " and more" : ""}.`, evidence: inn.flatMap((e) => e.evidence) });
  } else if (n.kind === "page") {
    if (n.layout) S.push({ text: `The shared frame (layout) drawn around ${n.route === "/" ? "every page" : "every page under " + n.route}, such as the navigation bar.`, evidence: [n.ev].filter(Boolean) });
    else S.push({ text: `A page at ${n.name}.`, evidence: [n.ev].filter(Boolean) });
    S.push({ text: `${n.pageClient ? "It runs in the visitor's browser" : n.client ? "It's built on the server, and some parts of it run in the visitor's browser" : "It's built on the server before it's sent"}.`, evidence: [] });
    const reqs = out.filter((e) => e.kind === "request");
    const acts = reqs.filter((e) => e.to.startsWith("action:")), apis = reqs.filter((e) => !e.to.startsWith("action:"));
    if (apis.length) S.push({ text: `It sends requests to ${list(apis.map((e) => `${e.label}`))}.`, evidence: apis.flatMap((e) => e.evidence) });
    const actsSure = acts.filter((e) => e.certainty === "proven"), actsMaybe = acts.filter((e) => e.certainty !== "proven");
    if (actsSure.length) S.push({ text: `It triggers server actions: ${list(actsSure.map((e) => nodeName(e.to)))}.`, evidence: actsSure.flatMap((e) => e.evidence) });
    if (actsMaybe.length) S.push({ text: `It may trigger ${list(actsMaybe.map((e) => nodeName(e.to)))}: which one is picked by a condition in the code that Plainsight doesn't evaluate.`, evidence: actsMaybe.flatMap((e) => e.evidence) });
    if (!reqs.length) S.push({ text: "It doesn't send any requests to your server.", evidence: [] });
    const dbs = out.filter((e) => e.kind === "read" || e.kind === "write");
    if (dbs.length) S.push({ text: `While building the page, the server ${list(dbs.map((e) => `${e.label} ${nodeName(e.to)}`))}.`, evidence: dbs.flatMap((e) => e.evidence) });
    const g = n.guard;
    if (g.status === "checked") S.push({ text: `Only logged-in visitors get it: ${g.where === "by middleware" ? g.how : "it " + g.how}.`, evidence: g.evidence || [] });
    else if (g.status === "partial") S.push({ text: `It ${g.how}. Otherwise anyone can open it.`, evidence: g.evidence || [] });
    else if (g.status === "unenforced") S.push({ text: "It looks up who's logged in, but shows the page to everyone.", evidence: g.evidence || [] });
    else if (!n.layout) S.push({ text: "Anyone can open it. No login check was found in its code or in middleware.", evidence: [] });
  } else if (n.kind === "route") {
    if (n.worker) S.push({ text: `A Cloudflare Worker named ${n.name}: a small server that runs on Cloudflare, separate from the website.`, evidence: [n.ev].filter(Boolean) });
    else S.push({ text: `Handles ${n.method === "ANY" ? "any" : n.method} requests to ${n.name}.`, evidence: [n.ev].filter(Boolean) });
    const ext = out.filter((e) => e.kind === "request" && e.to.startsWith("host:"));
    if (ext.length) S.push({ text: `Sends requests to ${list(ext.map((e) => nodeName(e.to)))}.`, evidence: ext.flatMap((e) => e.evidence) });
    const reads = out.filter((e) => e.kind === "read"), writes = out.filter((e) => e.kind === "write");
    if (reads.length) S.push({ text: `Reads from ${list(reads.map((e) => nodeName(e.to)))}.`, evidence: reads.flatMap((e) => e.evidence) });
    if (writes.length) S.push({ text: `Saves changes to ${list(writes.map((e) => nodeName(e.to)))}.`, evidence: writes.flatMap((e) => e.evidence) });
    const svc = out.filter((e) => e.kind === "service");
    if (svc.length) S.push({ text: `Uses ${list(svc.map((e) => nodeName(e.to) + (e.via ? ` (through ${e.via.join("() → ")}())` : "")))}.`, evidence: svc.flatMap((e) => e.evidence) });
    const unk = out.filter((e) => e.certainty === "unresolved");
    if (unk.length) S.push({ text: "Also sends data to an address the code doesn't spell out.", evidence: unk.flatMap((e) => e.evidence) });
    const g = n.guard;
    if (g.status === "partial") S.push({ text: `Looks up who's logged in ${g.where}, but it ${g.how}.`, evidence: g.evidence || [] });
    else if (g.status === "checked") S.push({ text: `Checks who's logged in ${g.where}: it ${g.how}.`, evidence: g.evidence || [] });
    else if (g.status === "unenforced") S.push({ text: `It ${g.how}.`, evidence: g.evidence });
    else if (g.status === "external") S.push({ text: `It ${g.how}.`, evidence: g.evidence });
    else if (n.worker && n.verified) S.push({ text: "It checks the sender's signature before doing anything, so only real messages are accepted.", evidence: (n.effects || []).filter((e) => e.type === "verify").flatMap((e) => evChain(e)) });
    else if (/webhook/i.test(n.name)) S.push({ text: n.verified ? "It verifies the sender's signature." : "It doesn't check a login or verify who sent the message.", evidence: [] });
    else S.push({ text: "It doesn't check who's logged in. No login lookup was found in this handler, the functions it calls, or middleware covering this path.", evidence: [] });
  } else if (n.kind === "action") {
    const callers = inn.filter((e) => e.kind === "request");
    S.push({ text: `A server action: a function in ${n.file} that the browser can trigger directly, like a hidden API route.`, evidence: [n.ev].filter(Boolean) });
    const callerName = (e) => (nodes.get(e.from).layout ? "" : "page ") + nodeName(e.from);
    const callersSure = callers.filter((e) => e.certainty === "proven"), callersMaybe = callers.filter((e) => e.certainty !== "proven");
    if (callersSure.length) S.push({ text: `Triggered from ${list([...new Set(callersSure.map(callerName))])}.`, evidence: callersSure.flatMap((e) => e.evidence) });
    if (callersMaybe.length) S.push({ text: `May be triggered from ${list([...new Set(callersMaybe.map(callerName))])}, depending on a condition in the code.`, evidence: callersMaybe.flatMap((e) => e.evidence) });
    if (!callers.length) S.push({ text: "No page in the app triggers it.", evidence: [] });
    const reads = out.filter((e) => e.kind === "read"), writes = out.filter((e) => e.kind === "write"), svc = out.filter((e) => e.kind === "service");
    if (reads.length) S.push({ text: `Reads from ${list(reads.map((e) => nodeName(e.to)))}.`, evidence: reads.flatMap((e) => e.evidence) });
    if (writes.length) S.push({ text: `Saves changes to ${list(writes.map((e) => nodeName(e.to)))}.`, evidence: writes.flatMap((e) => e.evidence) });
    if (svc.length) S.push({ text: `Uses ${list(svc.map((e) => nodeName(e.to) + (e.via ? ` (through ${e.via.join(" → ")})` : "")))}.`, evidence: svc.flatMap((e) => e.evidence) });
    const g = n.guard;
    if (g.status === "partial") S.push({ text: `Looks up who's logged in ${g.where}, but it ${g.how}.`, evidence: g.evidence || [] });
    else if (g.status === "checked") S.push({ text: `Checks who's logged in ${g.where}: it ${g.how}.`, evidence: g.evidence || [] });
    else if (g.status === "unenforced") S.push({ text: `It ${g.how}.`, evidence: g.evidence });
    else if (g.status === "external") S.push({ text: `It ${g.how}.`, evidence: g.evidence });
    else S.push({ text: "It doesn't check who's logged in.", evidence: [] });
  } else if (n.kind === "table") {
    const users = inn.filter((e) => e.kind === "read" || e.kind === "write");
    S.push({ text: `A database table${n.fields ? ` with ${n.fields.length} fields: ${list(n.fields)}` : ""}.`, evidence: [n.ev].filter(Boolean) });
    const rel = edges.filter((e) => e.kind === "relation" && e.from === n.id);
    rel.forEach((e) => S.push({ text: `Each ${n.name} belongs to one ${nodeName(e.to)}.`, evidence: e.evidence }));
    (n.external || []).forEach((x) => S.push({ text: x.to === "auth.users" ? `Each row is tied to a login account in Supabase's built-in users list (through ${x.field}).` : `Links to ${x.to} through ${x.field}.`, evidence: [{ file: n.ev.file, line: x.line, code: x.code }] }));
    if (n.rls?.enabled) S.push({ text: n.rls.policies.length ? `Row-level security is on. The database itself only allows: ${list(n.rls.policies.map((p) => `"${p.name}" (${p.for})`))}.` : "Row-level security is on with no policies, so the public key can't read or change any row.", evidence: [n.rls.ev, ...n.rls.policies.map((p) => p.ev)] });
    else if (n.rls) S.push({ text: "Row-level security is not turned on in the schema files, so the database doesn't restrict who can read or change rows.", evidence: [] });
    const adm = inn.filter((e) => e.admin);
    if (adm.length) S.push({ text: `${list([...new Set(adm.map((e) => (nodes.get(e.from).method && nodes.get(e.from).method !== "ANY" ? nodes.get(e.from).method + " " : "") + nodeName(e.from)))])} use${adm.length === 1 ? "s" : ""} the admin key here, which skips row-level security.`, evidence: [adm[0].adminEv].filter(Boolean) });
    if (users.length) S.push({ text: `Used by ${list([...new Set(users.map((e) => `${nodes.get(e.from).kind === "page" ? "page " : ""}${nodes.get(e.from).method && nodes.get(e.from).method !== "ANY" ? nodes.get(e.from).method + " " : ""}${nodeName(e.from)}`))])}.`, evidence: [] });
    else S.push({ text: "Nothing in the app reads or writes it yet.", evidence: [] });
  } else if (n.kind === "service") {
    const users = inn.filter((e) => e.kind === "service");
    const cb = out.filter((e) => e.kind === "callback");
    S.push({ text: n.pkg ? `An outside company, reached through the "${n.pkg}" package.` : "An outside company. The code never calls it directly.", evidence: [] });
    cb.forEach((e) => S.push({ text: e.why, evidence: [] }));
    if (users.length) S.push({ text: `Called by ${list(users.map((e) => `${nodes.get(e.from).method || ""} ${nodeName(e.from)}`.trim()))}.`, evidence: users.flatMap((e) => e.evidence) });
  } else if (n.kind === "host") {
    const req = inn.filter((e) => e.kind === "request" || e.kind === "load"), lk = inn.filter((e) => e.kind === "link");
    if (req.length) S.push({ text: `An outside address your code calls directly, from ${list([...new Set(req.map((e) => nodeName(e.from)))])}.`, evidence: req.flatMap((e) => e.evidence) });
    if (lk.length) S.push({ text: `The code links to it${lk.some((e) => e.placeholder) ? ", but the link still holds a placeholder" : ""}. Visitors go there; your code doesn't call it.`, evidence: lk.flatMap((e) => e.evidence) });
  } else if (n.kind === "unknown") {
    const u = unknowns.find((x) => x.node === n.id);
    S.push({ text: u.source ? `The code sends data here, but the address comes from ${u.source}, which is only known when the app runs.` : `The code sends data to an address built at runtime (${u.expr}).`, evidence: u.evidence });
    S.push({ text: "It's left unresolved instead of guessed. Connecting live traffic would fill it in.", evidence: [] });
  }
  n.explain = S;
}

// ---------- write ----------
let commit = null;
try { commit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
const pkgJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { return {}; } })();
const clean = (n) => { const { effects, files, key, ...rest } = n; return { ...rest, files }; };
const graph = {
  app: name || pkgJson.name || path.basename(root), commit, generatedAt: new Date().toISOString(), analyzer: "plainsight " + VERSION,
  stack: { static: staticInfo.on ? staticInfo : null, nextAppRouter: !!appDir, nextPagesRouter: !!pagesDir, prisma: !!schemaFile, sqlSchema: sqlFiles.map(rel), middleware: middleware?.rel || null, middlewareMatchers: middleware?.matchers || null },
  nodes: [...nodes.values()].map(clean),
  edges: edges.map((e) => ({ ...e, ops: e.ops ? [...e.ops] : undefined, calls: e.calls ? [...e.calls] : undefined, paths: e.paths ? [...e.paths] : undefined })),
  findings: findings.sort((a, b) => ["crit", "warn", "info"].indexOf(a.sev) - ["crit", "warn", "info"].indexOf(b.sev)),
  unknowns,
  coverage: { sourceFiles: srcRel.length, mapped: srcRel.length - unmapped.length - tooling.length - tests.length - docs.length, tooling, tests, docs, unmapped, schema: schemaFile ? rel(schemaFile) : null },
  limits: [
    "Reads TypeScript/JavaScript structure only. It does not run the code.",
    "Understands Next.js routes and pages, Prisma, Drizzle (pgTable/mysqlTable/sqliteTable schemas, select/insert/update/delete, joins and db.query with `with`), Supabase, and the service packages in its list. Other libraries show up as plain code, not as parts.",
    "Calls made through require(), dynamic import(), or values passed around as arguments may be missed.",
    "Regex-style middleware matchers are not evaluated.",
    ...(staticInfo.on ? ["For plain HTML pages, only <script> tags and their imports are followed. Pages linking to each other are not drawn.", "Saved-data keys are shown when the key is a fixed text or built by a simple function; other keys appear as built at runtime."] : []),
  ],
};
for (const f of graph.findings) f.fix = fixPrompt(f, graph);
return graph;
}
