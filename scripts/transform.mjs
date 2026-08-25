/**
 * Turns the raw discovery dump into the payloads the site loads at runtime:
 *
 *   dist/data/registry.json  dictionary-encoded listing table (the big one)
 *   dist/data/meta.json      snapshot stamp + headline counts, fetched first
 *   dist/data/history.json   one point per day, for the trend strip
 *
 * It also appends today's aggregate to data/history/daily.ndjson, which is the
 * only file the daily job commits back to the repo.
 */
import fs from "node:fs";
import path from "node:path";
import {
  RAW_FILE, DATA_DIR, HISTORY_FILE,
  CATEGORY_NAMES, categorize, networkName, assetTicker, decimalsFor,
} from "./config.mjs";

// Column order for a listing row. Kept in sync with FIELDS in src/app.js.
const FIELDS = [
  "url", "hostIdx", "name", "description", "minPrice", "categoryIdx",
  "calls30d", "payers30d", "lastCalled", "lastUpdated", "method",
  "curated", "tagIdxs", "accepts", "hasExample",
];

class Dictionary {
  constructor() { this.values = []; this.index = new Map(); }
  id(value) {
    const v = value == null ? "" : value;
    let i = this.index.get(v);
    if (i === undefined) { i = this.values.length; this.values.push(v); this.index.set(v, i); }
    return i;
  }
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return (url || "").split("/")[2] || url || "unknown"; }
}

function readRaw() {
  if (!fs.existsSync(RAW_FILE)) {
    throw new Error(`${RAW_FILE} not found - run "npm run fetch" first`);
  }
  return fs.readFileSync(RAW_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function build(listings) {
  const hosts = new Dictionary(), networks = new Dictionary(), schemes = new Dictionary();
  const assets = new Dictionary(), payTos = new Dictionary(), tags = new Dictionary();

  const rows = listings.map((it) => {
    const url = it.resource || "";
    const host = hostOf(url);
    const accepts = [];
    let minPrice = null;

    for (const a of it.accepts || []) {
      const raw = a.amount ?? a.maxAmountRequired ?? a.price;
      let value = raw == null ? null : Number(raw) / 10 ** decimalsFor(a);
      if (value != null && !Number.isFinite(value)) value = null;
      if (value != null && (minPrice === null || value < minPrice)) minPrice = value;
      accepts.push([
        schemes.id(a.scheme || "?"),
        networks.id(networkName(a.network)),
        assets.id(assetTicker(a.extra?.name)),
        value == null ? null : Math.round(value * 1e6) / 1e6,
        payTos.id(a.payTo || a.recipient || ""),
        a.maxTimeoutSeconds ?? null,
      ]);
    }

    const tagList = [...new Set((it.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 8);
    const description = (it.description || "").replace(/\s+/g, " ").trim().slice(0, 320);
    const bazaar = it.extensions?.bazaar?.info;
    const quality = it.quality || {};
    const example = bazaar?.output?.example;

    return [
      url,
      hosts.id(host),
      it.serviceName || "",
      description,
      minPrice,
      categorize(`${description} ${url} ${tagList.join(" ")}`.toLowerCase()),
      quality.l30DaysTotalCalls ?? 0,
      quality.l30DaysUniquePayers ?? 0,
      quality.lastCalledAt ? quality.lastCalledAt.slice(0, 10) : "",
      (it.lastUpdated || "").slice(0, 10),
      bazaar?.input?.method || (it.accepts || []).find((a) => a.method)?.method || "",
      it.curated ? 1 : 0,
      tagList.map((t) => tags.id(t)),
      accepts,
      example && Object.keys(example).length ? 1 : 0,
    ];
  });

  rows.sort((a, b) => b[6] - a[6]);
  return { rows, hosts, networks, schemes, assets, payTos, tags };
}

function summarize(rows, dicts) {
  const prices = [];
  const hostSet = new Set();
  const byCategory = {};
  const byNetwork = {};
  const bySchemeName = {};
  let calls = 0, payers = 0, curated = 0;

  for (const r of rows) {
    calls += r[6];
    payers += r[7];
    if (r[11]) curated++;
    hostSet.add(r[1]);
    if (r[4] != null) prices.push(r[4]);
    const cat = CATEGORY_NAMES[r[5]];
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const nets = new Set(), schs = new Set();
    for (const a of r[13]) { nets.add(a[1]); schs.add(a[0]); }
    for (const n of nets) { const k = dicts.networks.values[n]; byNetwork[k] = (byNetwork[k] || 0) + 1; }
    for (const s of schs) { const k = dicts.schemes.values[s]; bySchemeName[k] = (bySchemeName[k] || 0) + 1; }
  }

  const sorted = prices.slice().sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);
  const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

  return {
    listings: rows.length,
    providers: hostSet.size,
    curated,
    calls30d: calls,
    payers30d: payers,
    priceP10: at(0.1),
    priceMedian: at(0.5),
    priceP90: at(0.9),
    active10: rows.filter((r) => r[6] >= 10).length,
    active100: rows.filter((r) => r[6] >= 100).length,
    active1000: rows.filter((r) => r[6] >= 1000).length,
    multiPayer10: rows.filter((r) => r[7] >= 10).length,
    byCategory: Object.fromEntries(rank(byCategory)),
    byNetwork: Object.fromEntries(rank(byNetwork).slice(0, 15)),
    byScheme: Object.fromEntries(rank(bySchemeName)),
  };
}

function appendHistory(day, summary) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const existing = fs.existsSync(HISTORY_FILE)
    ? fs.readFileSync(HISTORY_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const point = {
    day,
    listings: summary.listings,
    providers: summary.providers,
    calls30d: summary.calls30d,
    payers30d: summary.payers30d,
    active10: summary.active10,
    priceMedian: summary.priceMedian,
  };
  const merged = existing.filter((p) => p.day !== day).concat(point).sort((a, b) => a.day.localeCompare(b.day));
  fs.writeFileSync(HISTORY_FILE, merged.map((p) => JSON.stringify(p)).join("\n") + "\n");
  return merged;
}

function run() {
  const listings = readRaw();
  const { rows, ...dicts } = build(listings);
  const summary = summarize(rows, dicts);

  const fetchMetaPath = ".cache/fetch-meta.json";
  const fetchedAt = fs.existsSync(fetchMetaPath)
    ? JSON.parse(fs.readFileSync(fetchMetaPath, "utf8")).fetchedAt
    : new Date().toISOString();
  const day = fetchedAt.slice(0, 10);

  const history = appendHistory(day, summary);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "registry.json"),
    JSON.stringify({
      version: 1,
      fields: FIELDS,
      fetchedAt,
      categories: CATEGORY_NAMES,
      hosts: dicts.hosts.values,
      networks: dicts.networks.values,
      schemes: dicts.schemes.values,
      assets: dicts.assets.values,
      payTos: dicts.payTos.values,
      tags: dicts.tags.values,
      rows,
    })
  );
  fs.writeFileSync(path.join(DATA_DIR, "meta.json"), JSON.stringify({ fetchedAt, day, ...summary }, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "history.json"), JSON.stringify(history));

  const size = fs.statSync(path.join(DATA_DIR, "registry.json")).size;
  console.log(
    `${rows.length} listings · ${summary.providers} providers · median ${summary.priceMedian} · ` +
      `${(size / 1048576).toFixed(2)}MB registry.json · ${history.length} history point(s)`
  );
}

run();
