import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(ROOT, requested);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) return send(response, 403, "Forbidden");
    const info = await stat(filePath);
    if (!info.isFile()) return send(response, 404, "Not found");
    response.writeHead(200, {
      "Content-Type": TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": requested.endsWith(".json") ? "no-store" : "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    send(response, 404, "Not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`uFont запущен: http://localhost:${PORT}`);
  console.log("Для остановки нажмите Ctrl+C");
});

function send(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}
