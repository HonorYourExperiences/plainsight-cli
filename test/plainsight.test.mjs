// Regression tests: the sample app's planted bugs must keep being found, with receipts,
// and nothing outside the code may be claimed as proven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.mjs";
import { renderReport } from "../src/report.mjs";
import { fixPrompt, redact } from "../src/fixprompt.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tidy = path.join(root, "fixtures", "tidy");
const g = analyze(tidy);
const find = (title) => g.findings.find((f) => f.title === title);

test("finds the three planted bugs in the sample app", () => {
  const read = find("Anyone can read other people's Habit records");
  assert.equal(read?.sev, "crit");
  assert.equal(read.node, "route:GET /api/habits");
  assert.equal(find("Stripe secret key is sent to the browser")?.sev, "crit");
  assert.equal(find("Accepts messages without checking who sent them")?.sev, "warn");
});

test("every finding and every proven pipe points at real lines", () => {
  for (const f of g.findings) {
    assert.ok(f.evidence?.length, `no receipts for "${f.title}"`);
    for (const e of f.evidence) {
      const lines = fs.readFileSync(path.join(tidy, e.file), "utf8").split("\n");
      assert.ok(e.line >= 1 && e.line <= lines.length, `${e.file}:${e.line} is out of range`);
    }
  }
  for (const e of g.edges.filter((e) => e.certainty === "proven" && e.kind !== "callback")) assert.ok(e.evidence.length, `proven pipe ${e.from} -> ${e.to} has no receipt`);
});

test("knows what it can't prove", () => {
  assert.equal(g.unknowns.length, 1, "the analytics address comes from a setting and must stay unresolved");
  const cb = g.edges.find((e) => e.kind === "callback");
  assert.equal(cb?.certainty, "inferred", "Stripe calling the webhook is not provable from code");
});

test("login checks are read from the code", () => {
  const guard = (id) => g.nodes.find((n) => n.id === id)?.guard?.status;
  assert.equal(guard("route:POST /api/checkout"), "checked");
  assert.equal(guard("route:POST /api/habits/:id/check"), "checked");
  assert.equal(guard("route:GET /api/habits"), "none");
  assert.equal(guard("page:/pro"), "checked", "middleware covers /pro");
});

test("coverage lists the unused component", () => {
  assert.deepEqual(g.coverage.unmapped, ["components/OldBanner.tsx"]);
});

test("the report embeds the graph and works without a CDN", () => {
  const html = renderReport([g]);
  assert.ok(!html.includes("cdn.jsdelivr.net/npm/elkjs"), "layout engine should be built in");
  assert.ok(!/<(link|script|img|iframe)\b[^>]+(src|href)\s*=\s*["']?https?:\/\//i.test(html), "no <link>, <script>, <img> or <iframe> loads from the internet");
  assert.ok(!/@import\s+(url\()?["']?https?:/i.test(html), "no CSS @import from the internet");
  assert.ok(html.includes('"app":"tidy"'));
  assert.ok(!/<\/script>\s*<\/script>/.test(html));
});

test("the CLI writes a report and --fail-on crit fails", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-")), "r.html");
  const r = spawnSync(process.execPath, [path.join(root, "bin", "plainsight.mjs"), tidy, "-q", "-o", out, "--fail-on", "crit"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.ok(fs.existsSync(out));
  assert.match(r.stdout, /FIX NOW\s+Anyone can read other people's Habit records/);
  const ok = spawnSync(process.execPath, [path.join(root, "bin", "plainsight.mjs"), tidy, "-q", "--no-report"], { encoding: "utf8" });
  assert.equal(ok.status, 0);
});

// Drizzle, wrappers, lookups by key, and Prisma's undefined filter (fixtures/drizzle-app)
const dz = analyze(path.join(root, "fixtures", "drizzle-app"));
const dzFind = (node) => dz.findings.filter((f) => f.node === node);

test("reads Drizzle tables, relations and queries", () => {
  for (const t of ["users", "notes"]) assert.ok(dz.nodes.some((n) => n.id === "table:" + t), `table ${t}`);
  assert.ok(dz.edges.some((e) => e.kind === "relation" && e.from === "table:notes" && e.to === "table:users"));
  assert.ok(dz.edges.some((e) => e.from === "route:GET /api/notes/:id" && e.to === "table:notes" && e.kind === "read"), "db.query.notes.findFirst");
  assert.ok(dz.edges.some((e) => e.from.startsWith("action:deleteNote") && e.to === "table:notes" && e.kind === "write"), "db.delete(notes)");
});

test("a login check inside an action wrapper counts", () => {
  const a = dz.nodes.find((n) => n.id.startsWith("action:deleteNote"));
  assert.equal(a.guard.status, "checked");
  // this test covers the login check only; Plainsight doesn't yet check that a logged-in user owns the note
  assert.ok(!dzFind(a.id).some((f) => f.sev === "crit"));
});

test("getUser(email) is a lookup, not a login check, and sign-up lookups are for review only", () => {
  const r = dz.nodes.find((n) => n.id.startsWith("action:register"));
  assert.equal(r.guard.status, "none");
  assert.deepEqual(dzFind(r.id).map((f) => f.sev), ["info"]);
});

test("Prisma's undefined filter: session?.user.id lets logged-out visitors through", () => {
  const fs_ = dzFind("route:DELETE /api/posts/:id");
  assert.equal(fs_.length, 1, "one finding for one cause");
  assert.equal(fs_[0].sev, "crit");
  assert.equal(fs_[0].title, "Logged-out visitors pass the ownership check");
  assert.ok(fs_[0].evidence.some((e) => e.code.includes("session?.user.id")));
});

test("a helper only reads 'records named by the request' when the caller passes request data", () => {
  assert.deepEqual(dzFind("page:/settings"), [], "getNotesFor(user.id) uses the session's own id");
  assert.equal(dzFind("route:GET /api/notes/:id")[0]?.sev, "crit", "getNote(params.id) with no login");
});

// Review fixes (PR #6): each case is a tiny app written to a temp folder.
function tempApp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-case-"));
  const all = {
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0", "drizzle-orm": "0.36.0", "@prisma/client": "5.0.0", "next-auth": "4.24.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }),
    "lib/db/schema.ts": 'import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";\nexport const teams = pgTable("teams", { id: serial("id").primaryKey() });\nexport const notes = pgTable("notes", { id: serial("id").primaryKey(), userId: integer("user_id"), teamId: integer("team_id").references(() => teams.id), body: text("body") });\n',
    "lib/db/index.ts": 'import { drizzle } from "drizzle-orm/postgres-js";\nimport * as schema from "./schema";\nexport const db = drizzle(process.env.DATABASE_URL!, { schema });\n',
    ...files,
  };
  for (const [f, body] of Object.entries(all)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  return dir;
}
const crits = (g) => g.findings.filter((f) => f.sev === "crit");

test("Drizzle queries in middleware don't crash the scan", () => {
  const dir = tempApp({
    "lib/q.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nexport async function one(id: number) { return db.select().from(notes).where(eq(notes.id, id)); }\n',
    "middleware.ts": 'import { NextResponse } from "next/server";\nimport { one } from "@/lib/q";\nexport async function middleware(req: Request) { const n = await one(1); if (!n) return NextResponse.redirect(new URL("/", req.url)); return NextResponse.next(); }\nexport const config = { matcher: ["/x/:path*"] };\n',
    "app/x/page.tsx": "export default function X() { return null; }\n",
  });
  assert.doesNotThrow(() => analyze(dir));
});

test("session?.user.id ?? fallback keeps Prisma's filter, so no ownership finding", () => {
  const dir = tempApp({
    "prisma/schema.prisma": "model Post {\n  id String @id\n  authorId String\n}\n",
    "lib/prisma.ts": 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();\n',
    "app/api/posts/[id]/route.ts": 'import { getServerSession } from "next-auth";\nimport { prisma } from "@/lib/prisma";\nexport async function GET(req: Request, { params }: { params: { id: string } }) {\n  const session = await getServerSession();\n  const n = await prisma.post.count({ where: { id: params.id, authorId: session?.user.id ?? "none" } });\n  return Response.json(n);\n}\n',
  });
  assert.ok(!analyze(dir).findings.some((f) => f.title === "Logged-out visitors pass the ownership check"));
});

test("a discarded timingSafeEqual() doesn't count as verifying a webhook", () => {
  const dir = tempApp({
    "app/api/webhook/route.ts": 'import { timingSafeEqual } from "node:crypto";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nexport async function POST(req: Request) {\n  const body = await req.json();\n  timingSafeEqual(Buffer.from("a"), Buffer.from("a"));\n  await db.insert(notes).values({ body: body.text });\n  return new Response("ok");\n}\n',
  });
  assert.ok(analyze(dir).findings.some((f) => f.title === "Accepts messages without checking who sent them"));
});

test("a login check in an inline .use() on the action's own chain counts", () => {
  const dir = tempApp({
    "lib/safe.ts": 'export const actionClient = { use: (f: any) => actionClient, inputSchema: (s: any) => actionClient, action: (f: any) => f } as any;\n',
    "app/a/actions.ts": '"use server";\nimport { eq } from "drizzle-orm";\nimport { getServerSession } from "next-auth";\nimport { actionClient } from "@/lib/safe";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nexport const remove = actionClient\n  .use(async ({ next }: any) => { const session = await getServerSession(); if (!session) throw new Error("login"); return next(); })\n  .inputSchema({})\n  .action(async ({ parsedInput }: any) => { await db.delete(notes).where(eq(notes.id, parsedInput.id)); });\n',
    "app/a/page.tsx": 'import { remove } from "./actions";\nexport default function A() { return <form action={remove} />; }\n',
  });
  const g = analyze(dir);
  assert.equal(g.nodes.find((n) => n.id.startsWith("action:remove"))?.guard.status, "checked");
  assert.deepEqual(crits(g), []);
});

test("a page size from the request isn't a record filter", () => {
  const dir = tempApp({
    "app/api/feed/route.ts": 'import { db } from "@/lib/db";\nexport async function GET(req: Request) {\n  const limit = Number(new URL(req.url).searchParams.get("limit"));\n  return Response.json(await db.query.notes.findMany({ limit }));\n}\n',
  });
  assert.deepEqual(crits(analyze(dir)), []);
});

test("an outbound API key in the same file doesn't hide a missing login check", () => {
  const dir = tempApp({
    "app/api/notes/[id]/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nconst API_KEY = process.env.API_KEY;\nexport async function GET(req: Request, { params }: { params: { id: string } }) {\n  return Response.json(await db.select().from(notes).where(eq(notes.id, Number(params.id))));\n}\n',
  });
  assert.equal(crits(analyze(dir)).length, 1);
});

test("with: { team: true } reads the related table", () => {
  const dir = tempApp({
    "app/api/n/route.ts": 'import { db } from "@/lib/db";\nexport async function GET() { return Response.json(await db.query.notes.findFirst({ with: { team: true } })); }\n',
  });
  assert.ok(analyze(dir).edges.some((e) => e.from === "route:GET /api/n" && e.to === "table:teams"));
});

test("symbolic links pointing outside the repo are never read", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "plainsight-outside-"));
  fs.writeFileSync(path.join(outside, "secret.ts"), 'export const TOKEN = "sk_live_OUTSIDExNOTxREAL0Qx";\n');
  const dir = tempApp({ "app/page.tsx": "export default function P() { return null; }\n" });
  fs.symlinkSync(path.join(outside, "secret.ts"), path.join(dir, "app", "leak.ts"));
  fs.symlinkSync(outside, path.join(dir, "linked"));
  const g = analyze(dir);
  const refs = JSON.stringify([g.nodes.map((n) => n.file), g.findings.flatMap((f) => (f.evidence || []).map((e) => e.file)), g.coverage]);
  assert.ok(!refs.includes("leak.ts"), "the linked file is never read");
  assert.ok(!refs.includes("linked/"), "the linked folder is never walked");
});

// Review fixes, round 2 (CodeRabbit on PR #6)
test("middleware that turns away visitors without a session cookie protects its paths", () => {
  const dir = tempApp({
    "middleware.ts": 'import { NextResponse } from "next/server";\nconst protectedRoutes = "/dashboard";\nexport async function middleware(request: any) {\n  const sessionCookie = request.cookies.get("session");\n  const isProtected = request.nextUrl.pathname.startsWith(protectedRoutes);\n  if (isProtected && !sessionCookie) return NextResponse.redirect(new URL("/sign-in", request.url));\n  return NextResponse.next();\n}\nexport const config = { matcher: ["/((?!api|_next/static).*)"] };\n',
    "app/dashboard/page.tsx": "export default function D() { return null; }\n",
    "app/pricing/page.tsx": "export default function P() { return null; }\n",
  });
  const g = analyze(dir);
  assert.equal(g.nodes.find((n) => n.id === "page:/dashboard").guard.status, "checked");
  assert.equal(g.nodes.find((n) => n.id === "page:/pricing").guard.status, "none");
});

test("regex path rules are evaluated per page; ones that can't be evaluated make the page unknown, not public", () => {
  const app = (matcher) => tempApp({
    "middleware.ts": `import { auth } from "@/lib/auth";\nexport async function middleware(req: Request) { const s = await auth(); if (!s) throw new Error("login"); }\nexport const config = { matcher: [${JSON.stringify(matcher)}] };\n`,
    "lib/auth.ts": "export async function auth() { return null as any; }\n",
    "app/x/page.tsx": "export default function X() { return null; }\n",
    "app/dashboard/page.tsx": "export default function D() { return null; }\n",
  });
  const status = (g, id) => g.nodes.find((n) => n.id === id).guard.status;
  const inc = analyze(app("/((?!api|_next/static).*)"));
  assert.equal(status(inc, "page:/x"), "checked");
  const exc = analyze(app("/((?!dashboard).*)"));
  assert.equal(status(exc, "page:/dashboard"), "none", "the pattern excludes /dashboard, so middleware never runs there");
  assert.equal(status(exc, "page:/x"), "checked");
  const bad = analyze(app("/((?!api"));
  assert.equal(status(bad, "page:/x"), "external");
});

test("a cookie check with extra conditions isn't full protection", () => {
  const dir = tempApp({
    "middleware.ts": 'import { NextResponse } from "next/server";\nexport async function middleware(request: any) {\n  const sessionCookie = request.cookies.get("session");\n  if (request.nextUrl.pathname.startsWith("/dashboard") && !sessionCookie && request.headers.get("x-private") === "1") return NextResponse.redirect(new URL("/sign-in", request.url));\n  return NextResponse.next();\n}\n',
    "app/dashboard/page.tsx": "export default function D() { return null; }\n",
  });
  assert.notEqual(analyze(dir).nodes.find((n) => n.id === "page:/dashboard").guard.status, "checked");
});

test("session?.user.id ?? undefined is still the undefined-filter bug", () => {
  const dir = tempApp({
    "prisma/schema.prisma": "model Post {\n  id String @id\n  authorId String\n}\n",
    "lib/prisma.ts": 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();\n',
    "app/api/posts/[id]/route.ts": 'import { getServerSession } from "next-auth";\nimport { prisma } from "@/lib/prisma";\nexport async function DELETE(req: Request, { params }: { params: { id: string } }) {\n  const session = await getServerSession();\n  const n = await prisma.post.count({ where: { id: params.id, authorId: session?.user.id ?? undefined } });\n  if (n) await prisma.post.delete({ where: { id: params.id } });\n  return new Response(null);\n}\n',
  });
  assert.ok(analyze(dir).findings.some((f) => f.title === "Logged-out visitors pass the ownership check"));
});

test("verification failures that are caught and ignored, or not awaited, don't count", () => {
  const route = (body) => 'import { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { verifyWebhookSignature } from "@/lib/verify";\nexport async function POST(req: Request) {\n' + body + '\n  await db.insert(notes).values({ body: "x" });\n  return new Response("ok");\n}\n';
  const dir = tempApp({
    "lib/verify.ts": 'export async function verifyWebhookSignature(req: Request) { if (!req.headers.get("sig")) throw new Error("bad"); }\n',
    "app/api/webhook-a/route.ts": route("  try { await verifyWebhookSignature(req); } catch {}"),
    "app/api/webhook-b/route.ts": route("  verifyWebhookSignature(req);"),
    "app/api/webhook-c/route.ts": route("  await verifyWebhookSignature(req);"),
  });
  const g = analyze(dir);
  const warned = (id) => g.findings.some((f) => f.node === id && f.title === "Accepts messages without checking who sent them");
  assert.ok(warned("route:POST /api/webhook-a"), "caught and ignored");
  assert.ok(warned("route:POST /api/webhook-b"), "not awaited");
  assert.ok(!warned("route:POST /api/webhook-c"), "awaited and throws");
});

test("a wrapper's check only protects the handler if it runs first, and a helper's returned refusal doesn't count", () => {
  const handler = 'export const DELETE = withUser(async (req: Request, { params }: any) => { await db.delete(notes).where(eq(notes.id, Number(params.id))); return new Response(null); });\n';
  const imports = 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { withUser } from "@/lib/wrap";\n';
  const late = analyze(tempApp({
    "lib/wrap.ts": 'import { getServerSession } from "next-auth";\nexport function withUser(handler: any) {\n  return async (req: Request, ctx: any) => { const res = await handler(req, ctx); const s = await getServerSession(); if (!s) return new Response("no", { status: 401 }); return res; };\n}\n',
    "app/api/notes/[id]/route.ts": imports + handler,
  }));
  assert.notEqual(late.nodes.find((n) => n.id === "route:DELETE /api/notes/:id").guard.status, "checked", "check runs after the handler");
  const helper = analyze(tempApp({
    "lib/check.ts": 'import { getServerSession } from "next-auth";\nexport async function check() { const s = await getServerSession(); if (!s) return new Response("no", { status: 401 }); }\n',
    "lib/wrap.ts": 'import { check } from "./check";\nexport function withUser(handler: any) {\n  return async (req: Request, ctx: any) => { await check(); return handler(req, ctx); };\n}\n',
    "app/api/notes/[id]/route.ts": imports + handler,
  }));
  assert.notEqual(helper.nodes.find((n) => n.id === "route:DELETE /api/notes/:id").guard.status, "checked", "the wrapper ignores check()'s refusal");
});

test("layouts in route groups are separate parts", () => {
  const dir = tempApp({
    "app/layout.tsx": "export default function Root({ children }: any) { return children; }\n",
    "app/(dashboard)/layout.tsx": '"use client";\nexport default function Dash({ children }: any) { return children; }\n',
    "app/page.tsx": "export default function P() { return null; }\n",
  });
  const ids = analyze(dir).nodes.filter((n) => n.layout).map((n) => n.id).sort();
  assert.deepEqual(ids, ["layout:/", "layout:/ (dashboard)"]);
});

test("const ownerId = session?.user.id carried into a Prisma filter is still the undefined-filter bug", () => {
  const dir = tempApp({
    "prisma/schema.prisma": "model Post {\n  id String @id\n  authorId String\n}\n",
    "lib/prisma.ts": 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();\n',
    "app/api/posts/route.ts": 'import { getServerSession } from "next-auth";\nimport { prisma } from "@/lib/prisma";\nexport async function DELETE() {\n  const session = await getServerSession();\n  const ownerId = session?.user.id;\n  await prisma.post.deleteMany({ where: { authorId: ownerId } });\n  return new Response(null);\n}\n',
  });
  assert.ok(analyze(dir).findings.some((f) => f.title === "Logged-out visitors pass the ownership check" && f.sev === "crit"));
});

test("a check in a wrapper's helper that is never called doesn't count", () => {
  const dir = tempApp({
    "lib/wrap.ts": 'import { getServerSession } from "next-auth";\nexport function withUser(handler: any) {\n  async function check() { const s = await getServerSession(); if (!s) throw new Error("login"); }\n  return handler;\n}\n',
    "app/api/notes/[id]/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { withUser } from "@/lib/wrap";\nexport const DELETE = withUser(async (req: Request, { params }: any) => { await db.delete(notes).where(eq(notes.id, Number(params.id))); return new Response(null); });\n',
  });
  assert.notEqual(analyze(dir).nodes.find((n) => n.id === "route:DELETE /api/notes/:id").guard.status, "checked");
});

test("a wrapper that returns a refusal before calling the handler protects it", () => {
  const dir = tempApp({
    "lib/wrap.ts": 'import { getServerSession } from "next-auth";\nexport function withUser(handler: any) {\n  return async (req: Request, ctx: any) => { const s = await getServerSession(); if (!s) return new Response("no", { status: 401 }); return handler(req, ctx, s); };\n}\n',
    "app/api/notes/[id]/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { withUser } from "@/lib/wrap";\nexport const DELETE = withUser(async (req: Request, { params }: any) => { await db.delete(notes).where(eq(notes.id, Number(params.id))); return new Response(null); });\n',
  });
  const g = analyze(dir);
  assert.equal(g.nodes.find((n) => n.id === "route:DELETE /api/notes/:id").guard.status, "checked");
  assert.deepEqual(crits(g), []);
});

test("a login check in a helper called on only one branch doesn't protect the whole action", () => {
  const dir = tempApp({
    "lib/checkout.ts": 'import { getServerSession } from "next-auth";\nimport { redirect } from "next/navigation";\nexport async function checkout() { const s = await getServerSession(); if (!s) redirect("/sign-up"); }\n',
    "app/a/actions.ts": '"use server";\nimport { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { checkout } from "@/lib/checkout";\nexport async function save(data: FormData) {\n  await db.delete(notes).where(eq(notes.id, Number(data.get("id"))));\n  if (data.get("pay")) return checkout();\n}\n',
    "app/a/page.tsx": 'import { save } from "./actions";\nexport default function A() { return <form action={save} />; }\n',
  });
  const a = analyze(dir).nodes.find((n) => n.id.startsWith("action:save"));
  assert.equal(a.guard.status, "none");
});

test("a standalone verifyX() only counts when its code throws", () => {
  const dir = tempApp({
    "lib/tokens.ts": 'export function verifyToken(t: string | null) { return t === "ok"; }\nexport function verifyStrictToken(t: string | null) { if (t !== "ok") throw new Error("bad"); }\n',
    "app/api/a/[id]/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { verifyToken } from "@/lib/tokens";\nexport async function GET(req: Request, { params }: any) { verifyToken(req.headers.get("t")); return Response.json(await db.select().from(notes).where(eq(notes.id, Number(params.id)))); }\n',
    "app/api/b/[id]/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes } from "@/lib/db/schema";\nimport { verifyStrictToken } from "@/lib/tokens";\nexport async function GET(req: Request, { params }: any) { verifyStrictToken(req.headers.get("t")); return Response.json(await db.select().from(notes).where(eq(notes.id, Number(params.id)))); }\n',
  });
  const g = analyze(dir);
  assert.notEqual(g.nodes.find((n) => n.id === "route:GET /api/a/:id").guard.status, "checked", "returns false, never throws");
  assert.equal(g.nodes.find((n) => n.id === "route:GET /api/b/:id").guard.status, "checked");
});

test("explicit Drizzle joins read the joined tables", () => {
  const dir = tempApp({
    "app/api/j/route.ts": 'import { eq } from "drizzle-orm";\nimport { db } from "@/lib/db";\nimport { notes, teams } from "@/lib/db/schema";\nexport async function GET() { return Response.json(await db.select().from(notes).leftJoin(teams, eq(notes.teamId, teams.id))); }\n',
  });
  assert.ok(analyze(dir).edges.some((e) => e.from === "route:GET /api/j" && e.to === "table:teams"));
});

test("every finding has a rule and a fix prompt with its receipts", () => {
  for (const f of g.findings) {
    assert.ok(f.rule, `no rule id for "${f.title}"`);
    assert.ok(f.fix?.includes(f.title), `fix prompt doesn't name "${f.title}"`);
    for (const e of f.evidence || []) assert.ok(f.fix.includes(`${e.file}:${e.line}`), `fix prompt for "${f.title}" misses ${e.file}:${e.line}`);
  }
  const read = find("Anyone can read other people's Habit records");
  assert.match(read.fix, /Where: GET \/api\/habits · app\/api\/habits\/route\.ts:6/);
  assert.match(read.fix, /How to fix it: /);
});

test("every rule that can be fixed tells the AI how", () => {
  for (const f of g.findings) assert.match(f.fix, /How to fix it: \S/, `no fix guidance for rule "${f.rule}"`);
});

test("fix prompts never carry a full secret key", () => {
  assert.equal(redact('new Stripe("sk_live_51NabcdEFGHijkl123456")'), 'new Stripe("sk_live_51Na…")');
  assert.equal(redact("key = 'sk-ant-api03-abcdefghijklmnop'"), "key = 'sk-ant-api0…'");
  const leaky = { sev: "crit", rule: "secret-in-browser", title: "t", text: "x", evidence: [{ file: "a.ts", line: 1, code: 'const k = "sk_live_51NabcdEFGHijkl123456"; const w = "whsec_abcdEFGH12345678";' }] };
  const p = fixPrompt(leaky, {});
  assert.ok(!p.includes("sk_live_51NabcdEFGHijkl123456") && !p.includes("whsec_abcdEFGH12345678"), "a full key reached the prompt");
  for (const f of g.findings) assert.ok(!/sk_live_[A-Za-z0-9]{12,}/.test(f.fix), `full key in prompt for "${f.title}"`);
});

test("the report has a copy button for each fix prompt", () => {
  const html = renderReport([g]);
  assert.ok(html.includes('class="fixcopy"'), "no Copy fix prompt button in the report");
  assert.ok(html.includes("Copy fix prompt"));
});

test("keys in a finding's title, text or a private key never reach the prompt", () => {
  const p = fixPrompt({ sev: "info", rule: "fails-after-save", title: "If https://sk_live_abcdefghijklmnop@api.example.com fails, the request fails after data was saved",
    text: "Calls https://sk_live_abcdefghijklmnop@api.example.com after saving.", evidence: [] }, {});
  assert.ok(!p.includes("sk_live_abcdefghijklmnop"), "a key in the title or text reached the prompt");
  const pem = 'const k = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n";';
  const q = fixPrompt({ sev: "warn", rule: "secret-in-code", title: "private key is written into the code", text: "x", evidence: [{ file: "a.ts", line: 1, code: pem }] }, {});
  assert.ok(!q.includes("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"), "private key body reached the prompt");
  assert.ok(q.includes("-----BEGIN PRIVATE KEY----- … (key removed)"));
  const multi = redact("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----");
  assert.ok(!multi.includes("MIIEpAIBAAKCAQEA"));
});

test("webhook guidance keeps the raw body for signature checks", () => {
  const f = find("Accepts messages without checking who sent them");
  assert.match(f.fix, /raw request body/);
  assert.doesNotMatch(f.fix, /before reading the body/);
});

test("a partial login check that may be public on purpose asks before locking it down", () => {
  const review = fixPrompt({ sev: "info", rule: "partial-login", title: "Login check only covers one case", text: "x", evidence: [] }, {});
  assert.match(review, /ask me whether that is intended/);
  const fix = fixPrompt({ sev: "warn", rule: "partial-login", title: "Login check only covers one case", text: "x", evidence: [] }, {});
  assert.match(fix, /cover every case/);
});

test("the Markdown summary has a prompt for every finding, including ones to review", () => {
  const out = path.join(os.tmpdir(), `plainsight-md-${process.pid}.md`);
  const r = spawnSync(process.execPath, [path.join(root, "bin", "plainsight.mjs"), tidy, "--no-report", "--markdown", out, "-q"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(out, "utf8");
  for (const f of g.findings) assert.ok(md.includes(`Fix prompt: ${f.title}`), `no prompt in Markdown for "${f.title}"`);
  fs.rmSync(out, { force: true });
});

test("findings that aren't tied to a part still get a copy button", () => {
  const html = renderReport([g]);
  assert.ok(html.includes("data-fixall"), "no copy control for findings without a part");
});

test("a private key cut after its first line doesn't swallow the rest of the prompt", () => {
  const p = fixPrompt({ sev: "warn", rule: "secret-in-code", title: "private key is written into the code", text: "x",
    evidence: [{ file: "a.ts", line: 1, code: "const key = `-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkq" }] }, {});
  assert.ok(!p.includes("MIIEvQIBADANBgkq"), "key body reached the prompt");
  assert.match(p, /How to fix it: /);
  assert.match(p, /npx plainsight-cli/, "the end of the prompt was removed");
});
