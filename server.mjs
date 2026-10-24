import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4",
};
http
  .createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end("Read-only static server");
      }
      let relative =
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/^\/+/, "") || "index.html";
      const parts = relative.split("/");
      if (parts.some((p) => p.startsWith(".")) || parts.includes("..")) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      let file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(
    Number(process.env.PORT || 4173),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        `Onely Launchpad → http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 4173}`,
      ),
  );
