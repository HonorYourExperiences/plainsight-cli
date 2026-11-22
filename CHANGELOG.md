# Changelog

## 0.3.0 — first public release

**Accuracy pass on real apps** (taxonomy, saas-starter, ai-chatbot, chatbot-ui, nextjs-subscription-payments, dub).

- New check: **Logged-out visitors pass the ownership check** (Prisma drops `undefined` filters, so `authorId: session?.user.id` matches any record when nobody is logged in).
- **Drizzle** support: `pgTable` / `mysqlTable` / `sqliteTable` schemas and relations, `select().from()`, `insert` / `update` / `delete`, `db.query.x.findFirst/findMany`.
- Login checks are recognised inside wrappers (`withUser(async …)`), chained action clients (`authActionClient.inputSchema().action()`), assignments to an existing variable, signed tokens and signatures, API keys handed to a library, and IP allowlists.
- Far fewer false alarms: helpers only count as "using records named by the request" when the caller passes request data; `getUser(email)` is a lookup, not a login check; webhook management routes aren't incoming webhooks; "other people's records" needs a table with an owner column; sign-up, tracking and payment-return flows are listed for review.
- Hologram view (now the default): layers you can orbit, towers sized by incoming pipes, flowing pipes, an assembly sequence, Run, Upstream/Downstream trace, an inspector, plan/iso/side views and keyboard controls.
- `--markdown` summary output and a **GitHub Action** (`uses: HonorYourExperiences/plainsight@v0.3.0`).
- Offline reports load nothing from the internet (no web fonts).
- The CLI names the part next to each finding.
- Published as `plainsight-cli` (the command is still `plainsight`). MIT license.

## 0.2.0

- Command-line tool, offline single-file report, zoom levels for big apps, "Fix now" items highlighted on the drawing, static sites and Cloudflare Workers.

## 0.1.0

- Prototype analyzer and viewer for Next.js + Prisma/Supabase.
