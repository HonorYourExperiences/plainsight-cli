# Plainsight website

An optional website on top of the CLI: people sign in with **Google, GitHub or email**, pick one of their GitHub repos (or type any public one), and see its map and findings. GitHub workflows can send each run's map to the dashboard, and AI agents can read the maps through an API token.

The CLI stays the main product and stays fully local. The website is for people who'd rather click than run a command, and for teams who want every push's map in one place.

## What it does

| Page | What's there |
|---|---|
| `/` | Sign in: Google, GitHub, or a one-time email link (no passwords) |
| `/dashboard` | Pick a repo from your GitHub account (or type `owner/name`), scan it, and see your saved maps |
| `/maps/:id` | The full Plainsight report, in a sandboxed frame |
| `/settings` | API tokens, plus copy-paste setup for the GitHub Action, Claude Code / Cursor (MCP) and the REST API |

**API** (send `Authorization: Bearer psk_...`):

| Call | Does |
|---|---|
| `GET /api/v1/maps` | Your maps, newest first |
| `GET /api/v1/maps/:id` | One map's summary and numbered findings (`?finding=N` for one finding with receipts and fix prompt, `?graph=1` for the raw graph) |
| `POST /api/v1/maps` | Save a map made elsewhere: `{ repo, commit?, run?, graph }` (what `plainsight --upload` sends) |
| `DELETE /api/v1/maps/:id` | Delete a map |
| `POST /api/v1/analyze` | Scan a GitHub repo: `{ "repo": "owner/name" }` |

## How it keeps code and accounts safe

- **Code is not kept.** A scan downloads one snapshot of the repo, runs the CLI on it in a separate process, and deletes the files when it finishes, whether it worked or not. Only the map is stored, and it includes the code snippets behind each finding. Users can delete maps.
- **Scanned code can't reach accounts.** Reports are served with `Content-Security-Policy: sandbox` and shown in a sandboxed frame, so even a repo crafted to inject script into its report can't read the site's cookies.
- **Tokens** are shown once and stored only as SHA-256 hashes. A wrong token is refused outright; it never falls back to the browser session. Changes through the API need a token, so another site can't make them with a visitor's cookie.
- **Least GitHub access by default.** GitHub sign-in asks only for `read:user` and `user:email`, which is enough to list public repos. Private repos need GitHub's `repo` scope, which also grants write access, so it's off until you set `PLAINSIGHT_GITHUB_PRIVATE_REPOS=1`. (A GitHub App with read-only "Contents" access is the better long-term answer.)
- **Limits.** 40 scans per user per day, 2 scans at a time per server, 150 MB downloads, 10 MB maps.
- **No telemetry.** Better Auth's telemetry is switched off.

## Run it locally

Needs Node 22.13 or newer (for the built-in SQLite).

```bash
npm ci                 # in the repo root, for the CLI
cd web && npm ci
cp .env.example .env.local   # set BETTER_AUTH_SECRET: openssl rand -base64 32
npm run dev
```

Open http://localhost:3000 and sign in by email. With no email provider set, the sign-in link is printed in the terminal and saved to `web/.data/last-sign-in-link.txt`. Google and GitHub buttons appear once their keys are in `.env.local`.

## Deploy it

Any host that runs a long-lived Node server with `tar` and a writable temp folder works: Railway, Render, Fly.io, a VPS. Scans can take up to a couple of minutes, so short serverless time limits are a poor fit.

1. **Database:** a Postgres URL in `DATABASE_URL` (Neon, Supabase, Railway). Tables are created on first start.
2. **Secret and address:** `BETTER_AUTH_SECRET` (32+ random characters) and `BETTER_AUTH_URL` (the public `https://` address).
3. **Google:** Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web). Authorised redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. **GitHub:** github.com/settings/developers → New OAuth App. Callback URL: `<BETTER_AUTH_URL>/api/auth/callback/github`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
5. **Email:** a [Resend](https://resend.com) API key in `RESEND_API_KEY`, and `EMAIL_FROM` on a domain you've verified there.
6. Build with `npm ci && npm run build` in `web/` (after `npm ci` in the repo root), and start with `npm start`.

## Tests

`npm test` covers tokens, map ownership, upload checks and the repo list. The CLI's tests (`npm test` in the repo root) cover `plainsight mcp` and `--upload`.
