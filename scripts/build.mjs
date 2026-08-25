/**
 * Copies the static site into dist/ and stamps it with the snapshot id so a
 * new daily deploy busts caches for index.html, app.js and the data payloads.
 */
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, DATA_DIR } from "./config.mjs";

const SITE_URL = process.env.SITE_URL || "https://example.github.io/x402-bazaar-explorer";

function readMeta() {
  const p = path.join(DATA_DIR, "meta.json");
  if (!fs.existsSync(p)) throw new Error('dist/data/meta.json missing - run "npm run transform" first');
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function stamp(text, buildId) {
  return text.replaceAll("__BUILD_ID__", buildId).replaceAll("__SITE_URL__", SITE_URL.replace(/\/$/, ""));
}

function run() {
  const meta = readMeta();
  const buildId = meta.fetchedAt.replace(/[^0-9]/g, "").slice(0, 12);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of fs.readdirSync("src")) {
    const from = path.join("src", file);
    const to = path.join(OUT_DIR, file);
    if (/\.(html|txt|xml|css|js|svg)$/.test(file)) {
      fs.writeFileSync(to, stamp(fs.readFileSync(from, "utf8"), buildId));
    } else {
      fs.copyFileSync(from, to);
    }
  }

  // GitHub Pages would otherwise run the output through Jekyll.
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
  fs.writeFileSync(
    path.join(OUT_DIR, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL.replace(/\/$/, "")}/</loc><lastmod>${meta.day}</lastmod></url>\n</urlset>\n`
  );

  const bytes = fs.readdirSync(DATA_DIR).reduce((sum, f) => sum + fs.statSync(path.join(DATA_DIR, f)).size, 0);
  console.log(`built ${OUT_DIR}/ for snapshot ${meta.day} (build ${buildId}) · data ${(bytes / 1048576).toFixed(2)}MB`);
}

run();
