# Contributing

Thanks for helping make Plainsight more accurate.

## The rule

Plainsight's whole value is that its drawing and findings are **true**. A change is welcome if it makes Plainsight see more of an app, or say something more precisely, without claiming anything the code doesn't prove. When in doubt, label it *inferred* or list it for review instead of "Fix now".

## Reporting a wrong finding

Open an issue with:

1. The finding as printed (title, part, file and line).
2. The smallest piece of code that reproduces it (a route plus the helper it calls is usually enough).
3. Why it's wrong: the check you expected Plainsight to see, or the reason the data is safe.

Every confirmed false alarm or miss becomes a fixture and a test.

## Working on the code

```bash
npm install
npm test                                   # regression tests
node bin/plainsight.mjs fixtures/tidy --open
npm run site                               # rebuild docs/demo.html
```

- `src/analyze.mjs` reads the repo with the TypeScript compiler API. Findings are built at the end, in the "guards & findings" section.
- `fixtures/tidy` is a sample app with planted bugs; `fixtures/drizzle-app` covers Drizzle, wrappers and Prisma's undefined filter. Add a fixture file and a test for every new pattern.
- `viewer/template.html` is the whole report UI (no build step).

Please keep plain-English text short, concrete and free of jargon: "Anyone can read other people's Habit records", not "IDOR in GET handler".
