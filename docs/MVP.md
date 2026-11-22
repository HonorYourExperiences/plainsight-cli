# Plainsight MVP

## The problem

AI tools let people ship real apps without reading the code they ship. The app works in the demo, so it looks done. What the builder can't see:

- **Holes.** A route that returns anyone's records when you change an ID in the address. A secret key bundled into the browser. A webhook that trusts any sender. These are the bugs that end up in the news, and they are exactly the bugs AI code generators write most often.
- **Shape.** Which pages call which routes, what touches the database, what talks to Stripe. Without a picture, every next prompt is a guess, and every bug fix risks breaking something they didn't know was connected.

Existing tools don't fit this person. Linters and SAST scanners speak to security engineers in rule IDs. Diagramming tools draw what you tell them, not what the code does. AI explanations sound confident and can be wrong.

## Who it's for

**Primary:** solo builders and small teams who ship Next.js apps written mostly with AI (Cursor, Claude Code, v0, Bolt, Lovable exports), on Supabase, Prisma or Drizzle, often with Stripe. They can run a terminal command. Many can't comfortably review a pull request.

**Secondary:** developers who inherit or review one of those apps (agencies, freelancers, a first engineering hire), and anyone with a plain HTML + JS site.

## The promise

> Run one command. See what you built. Find the holes before your users do.
> Every box, line and sentence links to the code that proves it.

Three things make that promise believable, and the MVP must keep all three:

1. **Accurate, not decorated.** Every part and pipe is traced from the code. Anything the code can't prove is labeled *inferred* or *unresolved*, never drawn as fact. A wrong "Fix now" costs more trust than a missed one, so "Fix now" fires only on patterns the analyzer can show end to end.
2. **Plain language.** Findings say what can happen ("Anyone can read other people's Habit records"), not a rule ID. Each one shows the exact lines, in order, from the entry point to the problem.
3. **Local.** The code never leaves the machine. No account, no upload, no telemetry. The report is a single HTML file that works offline.

## What's in the MVP (v0.3)

| Area | In |
|---|---|
| Install & run | `npx plainsight-cli` in any folder, a git URL or `owner/name`. Node 18+. About 1–4 seconds on real apps. |
| Reads | Next.js App + Pages Router (pages, layouts, API routes, server actions, middleware); Prisma, Drizzle and Supabase (tables, relations, row-level security, admin key); service SDKs (Stripe, Resend, OpenAI…); plain HTML/JS sites; Cloudflare Workers. |
| Finds (Fix now) | Records named by the request with no login check; Prisma's undefined filter (`session?.user.id`) letting logged-out visitors through; secret keys reaching the browser. |
| Finds (Fix soon) | Webhooks that never verify the sender; login checks that only cover one case; looking up the login but not acting on it when the request changes data; calls to routes that don't exist. |
| Report | Single offline HTML file: a 3D hologram of the app's layers (towers = load, beams = data flow, Run pulse that stops at the first problem), a flat Map, three zoom levels for big apps, plain-English explanation of every part with receipts, Upstream/Downstream trace, coverage of what was and wasn't read. |
| CI | `--fail-on crit`, `--markdown` summary, JSON output, and a GitHub Action that writes the findings table into the check's summary and uploads the report. |

## What's out (on purpose)

- Hosted service, accounts, dashboards, telemetry.
- Frameworks beyond Next.js and static sites (Remix, SvelteKit, Express, Rails…).
- Auto-fix and AI-written explanations. Every sentence today comes from a template filled with facts the analyzer proved.
- Runtime testing. Plainsight reads code; it never runs the app.

## Known limits (say them up front)

- It reads structure, not behavior: a check done *after* the lookup (for example a shared-dashboard password checked after loading the record) isn't recognised.
- Custom auth libraries are recognised by common names (`getSession`, `auth`, `currentUser`, wrappers that call them) and by `verify…Token/Signature` helpers. Unusual names are missed and reported as "no login check".
- "Other people's records" requires a table with an owner column (`userId`, `teamId`, `workspaceId`…); others are listed for review.

## Proof it works (accuracy bar for launch)

Every launch claim must hold on public repos, re-checked by hand:

| Repo | Result | Verdict |
|---|---|---|
| fixtures/tidy (sample) | 2 Fix now, 1 Fix soon | All planted bugs found |
| shadcn-ui/taxonomy | 2 Fix now: logged-out visitors pass the post ownership check (Prisma undefined filter) | Real bug, verified by reading the code |
| nextjs/saas-starter (Drizzle) | 1 Fix soon (signOut uses the login without checking it), rest review | Accurate |
| vercel/ai-chatbot (Drizzle) | 0 Fix now; public-chat mode listed for review | Accurate |
| mckaywrigley/chatbot-ui (Supabase) | 0 Fix now; 3 open routes for review | Accurate |
| vercel/nextjs-subscription-payments | No findings | Accurate |
| dub (apps/web, ~1,000 files) | 1 Fix now (shared dashboards, a known limit), down from 51 before the v0.3 accuracy pass | 1 false alarm left, documented |

Regression tests (`npm test`) lock in each pattern.

## How we'll know it's working

No telemetry, so the signals are public and voluntary:

- **Activation:** GitHub stars, npm weekly downloads, Action usage (dependents graph).
- **Value:** people sharing reports or screenshots; issues titled "it found…".
- **Trust:** false-positive reports. Target: under 1 in 10 "Fix now" findings disputed. Every disputed one becomes a regression test.
- **Pull:** requests for the next framework or check (decides the roadmap).

## Business model (hypothesis, not built)

- **Free forever:** the CLI, the report and the GitHub Action (MIT). This is the distribution.
- **Paid later, only if pull shows up:** *Plainsight for teams*: a PR bot that draws what a pull request changes ("this PR adds a route that reads Users with no login"), history across commits, and private hosted reports to share with a client. Priced per repo, aimed at agencies and small teams.

## Launch checklist

- [x] Accuracy pass on 7 public repos; regression tests for each pattern
- [x] npm package (`plainsight-cli`) packs and installs clean; `npx` works
- [x] GitHub Action with job summary + report artifact
- [x] README with quickstart, screenshots, what it finds, limits, privacy
- [x] Landing page and live demo report (`docs/`)
- [x] Launch copy (Show HN, Product Hunt, X/LinkedIn thread): `docs/LAUNCH.md`
- [x] Public repo, from a clean copy: [HonorYourExperiences/plainsight-cli](https://github.com/HonorYourExperiences/plainsight-cli), tagged v0.3.0
- [x] 0.3.1 merged and synced to the public repo
- [x] npm: [plainsight-cli](https://www.npmjs.com/package/plainsight-cli) 0.3.0 published, so `npx plainsight-cli` works
- [ ] **Owner:** release 0.3.1 through the tag workflow, not by hand: set up trusted publishing for `release.yml` on npm, then push `v0.3.1` (see [RELEASE.md](RELEASE.md) section 3, step 3)
- [x] GitHub Pages: https://honoryourexperiences.github.io/plainsight-cli/
- [ ] **Owner:** raise the GitHub Actions budget so CI runs
- [ ] **Owner:** report the taxonomy bug upstream before using it in launch posts
