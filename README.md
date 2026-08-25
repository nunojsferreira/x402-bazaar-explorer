# x402 Bazaar Explorer

A daily snapshot and browsable explorer of every service listed in the
[Coinbase CDP x402 Bazaar](https://docs.cdp.coinbase.com/x402) discovery registry.

The registry answers "what can an agent buy over x402 today?" — but only as a
paginated JSON API with no filtering, no aggregates and no history. This project
pulls the whole thing once a day, classifies it, and serves it as a single
static page you can search, filter and export.

**Live site:** https://nunojsferreira.github.io/x402-bazaar-explorer

---

## What it shows

| | |
| --- | --- |
| Listings | every resource returned by `/x402/discovery/resources` |
| Price | cheapest accepted rail, normalised to the asset's decimals |
| Rails | scheme, network, asset, timeout and payee for every `accepts` entry |
| Demand | 30-day call count and distinct payer count, as reported by CDP |
| Category | 14 buckets derived from description, URL and seller tags |

Filters cover demand, category, settlement network, scheme, price band, CDP
curation, whether the seller documented a response example, and recency. Every
filter combination is encoded in the URL, so a filtered view is a shareable link.
The filtered set exports to CSV.

## Snapshot of 2026-08-25

| Metric | Value |
| --- | --- |
| Listings | 15,147 |
| Provider hosts | 1,604 |
| Curated by CDP | 88 |
| Price p10 / median / p90 | $0.001 / $0.01 / $0.15 |
| 30d calls, whole registry | 304,282 |
| 30d unique payers, whole registry | 42,986 |

Demand is extremely concentrated. Of 15,147 listings:

| Threshold | Listings | Share |
| --- | --- | --- |
| ≥ 10 calls / 30d | 1,316 | 8.7% |
| ≥ 100 calls / 30d | 266 | 1.8% |
| ≥ 1,000 calls / 30d | 31 | 0.2% |
| ≥ 10 distinct payers | 240 | 1.6% |

Call volume is not the same as adoption: the highest-volume listing in this
snapshot serves tens of thousands of calls to a single payer. Sort by unique
payers to see which services have an actual market.

Settlement is Base-dominated (14,918 listings) with Solana second (5,525).
`exact` covers 15,044 listings; `upto` and `batch-settlement` are the only other
schemes with meaningful uptake.

## How it works

```
scripts/fetch.mjs      paginate the discovery API -> .cache/registry.jsonl
scripts/transform.mjs  classify + dictionary-encode -> dist/data/*.json
                       and append one aggregate point to data/history/daily.ndjson
scripts/build.mjs      stamp and copy src/ -> dist/
scripts/smoke.mjs      render dist/ in a headless DOM and assert it works
```

The page loads `data/meta.json` first (small, for the header), then the
dictionary-encoded `data/registry.json` (~5.9 MB raw, ~1.6 MB gzipped) and
renders 15k rows through a fixed-height virtual list. No framework, no runtime
dependencies.

`data/history/daily.ndjson` is the only generated file committed back to the
repo. It is one line per day and drives the trend strip in the footer.

## Running locally

```bash
npm install
npm run build     # fetch + transform + assemble
npm test          # headless render + assertions
npm run serve     # http://localhost:4402
```

`npm run build:offline` skips the network and rebuilds from `.cache/`.

## Deploying

1. Push to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Optional: set repository variable `SITE_URL` to the final URL, so canonical
   tags and the sitemap are correct. It defaults to
   `https://<owner>.github.io/<repo>`.

`.github/workflows/daily.yml` then rebuilds and redeploys at 06:17 UTC daily,
commits the day's history point, and writes a snapshot summary to the run page.
It can also be triggered manually from the Actions tab.

## Data notes and caveats

- **Source of truth is CDP.** Quality metrics (`l30DaysTotalCalls`,
  `l30DaysUniquePayers`, `lastCalledAt`) are self-reported by the facilitator.
  Nothing here is independently verified onchain.
- **Token decimals are inferred.** The `extra` block rarely carries `decimals`.
  USDC-family assets are treated as 6 decimals; the known 18-decimal exceptions
  are listed in `scripts/config.mjs`. A new 18-decimal asset would show inflated
  prices until it is added there.
- **Categories are heuristic.** Ordered regexes over description, URL and tags,
  first match wins. `Other` is left visible rather than force-fitted — it is the
  largest bucket, and that is a fact about the registry, not a bug.
- **Listings are not endorsements.** A large share of the registry has never
  been called. Nothing here has been tested for whether it returns useful data.
- **The API paginates over a live table**, so a listing can appear on two pages.
  Duplicates are dropped by resource URL during fetch.

## Licence

MIT. The registry data belongs to Coinbase and the listing sellers; this project
only fetches, reshapes and displays it.
