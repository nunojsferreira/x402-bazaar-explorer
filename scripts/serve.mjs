/** Minimal static server for local review: node scripts/serve.mjs [port] */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR } from "./config.mjs";

const port = Number(process.argv[2] || process.env.PORT || 4402);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.resolve(OUT_DIR, rel);
  if (!file.startsWith(path.resolve(OUT_DIR))) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(buf);
  });
}).listen(port, () => console.log(`serving ${OUT_DIR}/ on http://localhost:${port}`));
