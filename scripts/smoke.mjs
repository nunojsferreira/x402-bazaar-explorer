/**
 * Renders dist/index.html against the built data in a headless DOM and asserts
 * the table, facets, search and detail drawer all produce real output. Runs in
 * CI so a broken build never reaches Pages.
 */
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";
import { OUT_DIR, DATA_DIR } from "./config.mjs";

const checks = [];
function ok(label, condition, detail) {
  checks.push({ label, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const html = fs.readFileSync(path.join(OUT_DIR, "index.html"), "utf8");
const registry = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "registry.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "meta.json"), "utf8"));
const history = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "history.json"), "utf8"));

ok("registry has rows", registry.rows.length > 1000, `${registry.rows.length} rows`);
ok("every row has the expected arity", registry.rows.every((r) => r.length === registry.fields.length));
ok("meta counts match registry", meta.listings === registry.rows.length);
ok("history is non-empty", history.length >= 1, `${history.length} point(s)`);

const { window, document } = parseHTML(html);
const payloads = {
  "data/meta.json": meta,
  "data/registry.json": registry,
  "data/history.json": history,
};

globalThis.window = window;
globalThis.document = document;
// Node exposes navigator/location as getter-only globals, so define over them.
for (const [name, value] of [
  ["navigator", window.navigator],
  ["location", window.location || { hash: "", pathname: "/", search: "" }],
  ["history", { replaceState() {} }],
]) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.URL = URL;
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
window.matchMedia = () => ({ matches: false });
globalThis.fetch = (url) => {
  const key = String(url).split("?")[0];
  if (!(key in payloads)) return Promise.reject(new Error(`unexpected fetch ${key}`));
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payloads[key]) });
};

// linkedom does not implement layout or a settable <select>.value.
const scroller = document.getElementById("scroller");
Object.defineProperty(scroller, "clientHeight", { get: () => 900 });
Object.defineProperty(scroller, "scrollTop", { get: () => 0, set() {} });
let sortValue = "calls";
Object.defineProperty(document.getElementById("sort"), "value", {
  get: () => sortValue, set(v) { sortValue = v; },
});

const appSource = fs.readFileSync(path.join(OUT_DIR, "app.js"), "utf8");
// currentScript is how app.js discovers the cache-busting build id.
Object.defineProperty(document, "currentScript", { get: () => ({ src: "app.js?v=test" }) });
new Function(appSource)();

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

await waitFor(() => document.querySelectorAll(".row").length > 0, "the table to render");

const rows = document.querySelectorAll(".row");
ok("rows rendered", rows.length > 5, `${rows.length} virtualised nodes`);
ok("first row has an endpoint path", /\S/.test(rows[0]?.querySelector(".path")?.textContent || ""));
ok("first row shows a price", /\S/.test(rows[0]?.querySelector(".price")?.textContent || ""));
ok("stats populated", (document.getElementById("stats").textContent || "").includes("Listings"));
ok("snapshot stamp set", document.getElementById("stamp").textContent.includes(meta.day));
ok("category facet built", document.getElementById("cats").querySelectorAll(".chip").length === registry.categories.length);
ok("network facet built", document.getElementById("nets").querySelectorAll(".chip").length > 3);
ok("scheme facet built", document.getElementById("schemes").querySelectorAll(".chip").length > 1);
ok("demand facet built", document.getElementById("demand").querySelectorAll(".segrow").length === 6);
ok("skeleton removed", !document.getElementById("skeleton"));
ok("failure state hidden", document.getElementById("failed").hidden);

const q = document.getElementById("q");
q.value = "sanctions";
q.dispatchEvent(new window.Event("input"));
await waitFor(() => /Showing [\d,]+ of/.test(document.getElementById("footl").textContent), "the search to narrow the view");
const footer = document.getElementById("footl").textContent;
ok("search narrows the view", /Showing [\d,]+ of/.test(footer), footer);

q.value = "";
q.dispatchEvent(new window.Event("input"));
await waitFor(() => /Showing all/.test(document.getElementById("footl").textContent), "the search to clear");

document.querySelectorAll(".row")[0].dispatchEvent(new window.Event("click"));
const drawer = document.getElementById("dbody").textContent;
ok("drawer renders payment rails", drawer.includes("Payment rails accepted"));
ok("drawer renders demand block", drawer.includes("Demand, 30 days to snapshot"));
ok("drawer renders a curl snippet", drawer.includes("curl -i -X"));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
