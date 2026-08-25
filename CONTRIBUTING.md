# Contributing

## Local loop

```bash
npm install
npm run build       # hits the live CDP discovery API
npm test
npm run serve
```

Once `.cache/registry.jsonl` exists, use `npm run build:offline` to iterate on
the UI without re-fetching 152 pages.

## Where things live

| Path | Purpose |
| --- | --- |
| `scripts/config.mjs` | network names, asset tickers, token decimals, category regexes |
| `scripts/fetch.mjs` | paginated fetch with retry and dedupe |
| `scripts/transform.mjs` | classification, dictionary encoding, history append |
| `scripts/build.mjs` | stamps `__BUILD_ID__` / `__SITE_URL__` and copies `src/` to `dist/` |
| `src/app.js` | the whole client: indexing, filtering, virtual list, drawer |
| `scripts/smoke.mjs` | headless render assertions, runs in CI |

## Common changes

**A network shows as `chain 1234`.** Add it to `NETWORKS` in `scripts/config.mjs`.

**An asset's price looks 10^12 too large.** It is an 18-decimal token missing
from `DECIMALS_18` in `scripts/config.mjs`.

**Category is wrong for a listing.** Adjust the ordered `CATEGORIES` regexes.
Order matters — the first match wins, so specific intents belong above generic
ones. Re-run `npm run build:offline` and check the counts in the rail.

**Adding a column to the listing table.** The row array is positional. Add the
field to `FIELDS` in `scripts/transform.mjs`, push the value in the same
position, and add a matching constant at the top of `src/app.js`. `npm test`
asserts the arity matches, so a mismatch fails CI.

## Style

Plain ES modules, no build step, no runtime dependencies. `linkedom` is the only
devDependency and exists purely for the smoke test. Keep it that way unless
there is a strong reason not to.
