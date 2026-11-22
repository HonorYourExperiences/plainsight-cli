# Releasing Plainsight (owner checklist)

Everything in the repo is ready. These steps need the owner's accounts, so they aren't automated.

## 1. Make the repo safe to publish

An early commit contains `real/mb.graph.json`, the analysis of a private project, with snippets of its code. It's deleted from the current files but still in git history, **and in GitHub's pull request refs** (`refs/pull/*`), which nobody can rewrite with a push. Making this repo public would expose it through those PRs even after a history rewrite.

**Do this:** publish from a fresh repo that has only the current files.

```bash
git clone https://github.com/HonorYourExperiences/plainsight-cli.git plainsight-public
cd plainsight-public
git checkout main            # after PR #6 is merged
rm -rf .git && git init -b main && git add -A && git commit -m "Plainsight 0.3.0"
git log --all --name-only | grep -c mb.graph.json   # must print 0
```

Create a new empty public repo on GitHub, push this one to it, and keep the current repo private (or delete it). If the new repo has a different name, update the URLs in `package.json`, `README.md`, `action.yml` examples, `docs/index.html` and `docs/LAUNCH.md`.

(Rewriting this repo's history with `git filter-repo` is not enough on its own: filter-repo removes the `origin` remote, so it has to be added back before force-pushing branches **and** tags, and the PR refs keep the old commits until GitHub Support purges them. The fresh repo above avoids all of that.)

## 2. Turn on the website

Settings → Pages → Build and deployment → Deploy from a branch → `main`, folder `/docs`.
The site is then at `https://honoryourexperiences.github.io/plainsight-cli/`, with the demo at `/demo.html`.

## 3. Publish to npm and tag the release (one step, automated)

npm retired classic automation tokens in December 2025, so set up **trusted publishing** (no secret to store or rotate):

1. Publish the first version by hand so the package exists: `npm login`, then from `main`:
   ```bash
   npm install && npm test && npm publish --access public
   ```
2. Shortly before your first automated release (a new trusted-publisher setup expires if it isn't used within two days, and the hand publish above doesn't count): on npmjs.com open package `plainsight-cli` → Settings → Trusted publishing → GitHub Actions. Owner `HonorYourExperiences`, repository `plainsight-cli` (the public repo), workflow `release.yml`, and allow **direct publishing** (the workflow runs `npm publish`). If it expires, delete it, add it again and release within two days.
3. For every later release, bump `version` in `package.json` and add a `CHANGELOG.md` section, commit and push them, then tag that commit:
   ```bash
   git add package.json CHANGELOG.md && git commit -m "Release v0.3.1" && git push origin main
   ```
   ```bash
   git tag v0.3.1 && git push origin v0.3.1
   ```

The `release` workflow runs the tests, checks the tag matches `package.json`, publishes with provenance through trusted publishing, and creates the GitHub release from the changelog. It needs the Actions budget from step 4.

For v0.3.0 itself (published by hand in step 1), push the tag to create the release and make `uses: HonorYourExperiences/plainsight-cli@v0.3.0` work; the workflow's publish step will report that 0.3.0 already exists, so create the GitHub release from the changelog by hand this once.

Prefer a token? Create a **granular access token** with read-and-write access to `plainsight-cli` and "bypass 2FA" enabled for automation, and save it as the `NPM_TOKEN` repository secret.

Check: `npx plainsight-cli --version` prints the new version. Then edit the release and tick "Publish this Action to the GitHub Marketplace" (category: Security / Code quality).

## 4. CI

Raise the GitHub Actions budget (Settings → Billing) so the `test` workflow runs on pull requests.

## 5. Before posting about the taxonomy finding

Plainsight found that logged-out visitors pass the post ownership check in `shadcn-ui/taxonomy` (`app/api/posts/[postId]/route.ts`, Prisma's undefined filter). Report it to the project privately (or confirm it's already known) before using it in launch posts.

Repo settings worth filling in: description ("See what you built. Plainsight draws your Next.js app as a living schematic and finds the security holes, with receipts."), website (the Pages URL), topics: `nextjs`, `security`, `static-analysis`, `supabase`, `prisma`, `drizzle`, `vibe-coding`, `developer-tools`.
