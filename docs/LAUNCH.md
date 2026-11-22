# Launch kit

Positioning in one line: **See what you built. Find the holes before your users do.**

Who it's for: people shipping Next.js apps written mostly with AI (Cursor, Claude Code, v0, Bolt, Lovable), on Supabase, Prisma or Drizzle.

Proof points (all true, all checkable):

- One command, ~1–4 seconds on real apps, nothing leaves your machine, no account.
- Every finding shows the exact lines from the entry point to the problem.
- It labels what it can't prove (*inferred*, *unresolved*) instead of guessing.
- On 7 public apps, hand-checked: the planted bugs found, a real ownership-check bug in a popular template (disclose first, see RELEASE.md), and no "Fix now" false alarms on the AI-template apps.

Assets: `docs/img/hologram.jpg` (hero), `finding.jpg`, `skyline.jpg`, `terminal.jpg`, the live demo (`docs/demo.html`). Record a 30-second screen capture of the demo: assembly sequence → click /dashboard → Run → pulse stops in red → "Show the problem" → code.

---

## Show HN

**Title:** Show HN: Plainsight – see the app your AI wrote, with receipts for every claim

I've watched friends ship apps they built with Cursor and v0 that worked perfectly in the demo and returned anyone's data if you changed an ID in the URL. They couldn't see it, because they'd never read the code, and they couldn't ask the AI, because it wrote the bug.

Plainsight is a CLI that reads a Next.js app (App or Pages Router, server actions, Prisma/Drizzle/Supabase, Stripe and friends) with the TypeScript compiler API and draws it as a schematic: pages, routes, tables, outside services, and the pipes between them. It runs a handful of checks for the holes AI code writes most often: records looked up by request input with no login check, secrets bundled into the browser, unverified webhooks, and one I hadn't seen discussed much: `where: { authorId: session?.user.id }` in Prisma. When nobody's logged in that's `undefined`, Prisma drops the filter, and the ownership check passes for anyone.

The rule I set for it: nothing decorative. Every box, line and sentence links to the lines of code that prove it, and anything the code can't prove (who calls a webhook, an address built at runtime) is labeled inferred or unresolved. The report is one offline HTML file; there's a 3D "hologram" view where you can send a pulse through the app and watch it stop at the first problem, which turned out to be the fastest way to explain a bug to someone who doesn't read code.

Runs locally, no account, MIT. `npx plainsight-cli` in your app folder. There's also a GitHub Action that fails the PR on "Fix now" findings.

Limits: it reads structure, not behavior, so checks done after a lookup are missed, and it only knows Next.js and static sites so far. I'd love wrong findings: every one becomes a test.

Demo: <demo URL> · Repo: <repo URL>

---

## Product Hunt

- **Name:** Plainsight
- **Tagline (60):** See the app your AI built, and the holes in it
- **Description (260):** One command turns your Next.js app into a living schematic: every page, route, table and service, and the pipes between them. It finds the security holes AI code writes most, explains them in plain English, and links every claim to the code. Local, free, MIT.
- **First comment:** the Show HN text, shortened to the first three paragraphs, plus "What should it read next? Remix, SvelteKit, Express?"
- **Gallery:** hologram.jpg, finding.jpg, terminal.jpg, skyline.jpg, the 30-second capture.

---

## X / LinkedIn thread

1. You shipped an app with AI. It works. Do you know what it does when someone changes the ID in the URL? I built Plainsight to show you. 🧵
2. `npx plainsight-cli` reads your Next.js app and draws it: pages, routes, tables, Stripe, and every pipe between them. [hologram.jpg]
3. Then it checks for the holes AI code writes most: data anyone can read by changing an ID, secret keys bundled into the browser, webhooks that trust any sender. [terminal.jpg]
4. Every finding shows the exact lines, from the page to the problem. Nothing is drawn that the code doesn't prove; anything it can't prove is labeled. [finding.jpg]
5. My favorite catch: `authorId: session?.user.id` in a Prisma query. Logged out, that's undefined, Prisma drops the filter, and the ownership check passes for anyone.
6. Press Run and a pulse travels through your app and stops at the first problem. It's the fastest way I've found to explain a bug to someone who doesn't read code. [gif]
7. Local, no account, nothing uploaded, MIT. There's a GitHub Action to block PRs that open a hole. Try it on your app and tell me what it gets wrong. <repo URL>

---

## Where to post

Show HN (weekday morning US Eastern), r/nextjs, r/webdev, r/SideProject, the Supabase and Cursor community forums/Discords, Indie Hackers, Product Hunt (a week after HN, with the feedback folded in).

## First-week plan

- Answer every issue within a day; turn each confirmed false alarm into a fixture + test and ship a patch release.
- Track: stars, npm downloads, Action dependents, disputed "Fix now" rate (target < 1 in 10).
- Ask the people whose reports found something real if they'll share a screenshot.
