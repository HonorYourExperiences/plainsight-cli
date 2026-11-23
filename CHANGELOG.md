# Changelog

## 0.3.1

- **For AI agents:** `plainsight mcp` runs Plainsight as an MCP server. Claude Code, Cursor and other agents can scan the app they're working on, read each finding's receipts and fix prompt, look up any part and its pipes, and rescan to confirm a fix. It reads code on your machine, like the CLI.
- **`--upload`** sends the map to a Plainsight website (`PLAINSIGHT_URL`, `PLAINSIGHT_TOKEN`), and the GitHub Action takes `upload-url` and `upload-token` to do the same on every run. Upload problems print a warning and never fail the check on their own.
- **Plainsight website** (`web/`, optional, self-hosted): sign in with Google, GitHub or an email link, pick a repo, see its map; API tokens for workflows and agents; a REST API. See `web/README.md`.
- A key written into a test file (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) or a fixture or sample app (`fixtures/`, `__fixtures__/`) is no longer a "Fix soon": those are almost always planted fakes. A key that reaches the browser is still a "Fix now" wherever it lives, and coverage now counts fixtures and `.mjs`/`.cjs` tests as tests.
- **Copy fix prompt.** Every finding in the report has a button that copies a ready-to-paste prompt for Claude, Cursor or Lovable: the problem, the part and the exact file and line, the code involved, what a real fix looks like for that kind of problem, and a request to plan first, reuse the app's own helpers and change nothing else. The same prompt is in `--json` output and, folded, in the `--markdown` summary.
- Secret keys are masked in every prompt, so pasting one into an AI chat never hands over a key.
- Each finding now has a stable `rule` id (for example `others-records`, `secret-in-browser`, `unsigned-webhook`).
- A page no longer loses a table when two reads share a line (a select and its join): `/dashboard/activity` in saas-starter now shows both `users` and `activityLogs`.
- A request-driven `where()` on a joined Drizzle table's own columns counts as request-driven for that table (a filter on the main table doesn't).
- A verifier that rejects through a helper of its own (`rejectInvalidToken(t)`) is recognised as throwing, unless the helper is async and not awaited, or its error is caught and ignored.
- Verifiers are judged more strictly, so a check that can be skipped no longer hides a "Fix now":
  - A throw only counts when it rejects the input itself, not missing configuration (`if (!process.env.KEY) throw`), even when nested inside an input check. An early success return (`if (t === "ok") return; throw …`) and destructured inputs (`const { token } = input`) count.
  - A `catch` passes a failure on only when every path through it throws or redirects; a `return` (even before a rethrow) swallows it.
  - A verifier skipped when its value is missing (`if (t) verify(t)`) isn't a guard, while one on every branch of a method switch still is.
  - A helper called twice with different inputs is followed both times.
- `sql`` filters on a joined Drizzle table count when the joined column and the request value are in the same predicate.
- Explanations say when a page→action link is inferred ("It may trigger …"), and an action with callers is no longer also called unused.
- SECURITY.md lists the library options that load web content (`offline: false`, `webFonts: true`).

## 0.3.0 — first public release

**Accuracy pass on real apps** (taxonomy, saas-starter, ai-chatbot, chatbot-ui, nextjs-subscription-payments, dub).

- New check: **Logged-out visitors pass the ownership check** (Prisma drops `undefined` filters, so `authorId: session?.user.id` matches any record when nobody is logged in).
- **Drizzle** support: `pgTable` / `mysqlTable` / `sqliteTable` schemas and relations, `select().from()`, `insert` / `update` / `delete`, `db.query.x.findFirst/findMany`.
- Login checks are recognised inside wrappers (`withUser(async …)`), chained action clients (`authActionClient.inputSchema().action()`), assignments to an existing variable, signed tokens and signatures, API keys handed to a library, and IP allowlists.
- Far fewer false alarms: helpers only count as "using records named by the request" when the caller passes request data; `getUser(email)` is a lookup, not a login check; webhook management routes aren't incoming webhooks; "other people's records" needs a table with an owner column; sign-up, tracking and payment-return flows are listed for review.
- Hologram view (now the default): layers you can orbit, towers sized by incoming pipes, flowing pipes, an assembly sequence, Run, Upstream/Downstream trace, an inspector, plan/iso/side views and keyboard controls.
- `--markdown` summary output and a **GitHub Action** (`uses: HonorYourExperiences/plainsight-cli@v0.3.0`).
- Offline reports load nothing from the internet (no web fonts).
- The CLI names the part next to each finding.
- Published as `plainsight-cli` (the command is still `plainsight`). MIT license.

## 0.2.0

- Command-line tool, offline single-file report, zoom levels for big apps, "Fix now" items highlighted on the drawing, static sites and Cloudflare Workers.

## 0.1.0

- Prototype analyzer and viewer for Next.js + Prisma/Supabase.
