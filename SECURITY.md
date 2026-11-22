# Security

Plainsight reads code; it never runs the app it analyzes and makes no network requests except `git clone` when given a repo URL. Reports make no network requests when opened, unless they were generated with `--cdn`: those load the layout engine from cdn.jsdelivr.net and IBM Plex fonts from Google Fonts.

If you find a security problem in Plainsight itself (for example a report that runs code from the analyzed repo, or a crafted repo that escapes the temp folder), please report it privately through GitHub's **Report a vulnerability** button on this repo's Security tab rather than in a public issue.

If Plainsight finds a real vulnerability in someone else's public project, please report it to that project privately before sharing it.
