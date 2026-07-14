import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
const TAGS_FILE = resolve(ROOT, "data", "user-tags.json");
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
    if (pathname === "/api/user-tags") return handleUserTags(request, response);
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

async function handleUserTags(request, response) {
  if (request.method === "GET") {
    const content = await readFile(TAGS_FILE, "utf8");
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(content);
    return;
  }

  if (request.method !== "PUT") {
    response.writeHead(405, { Allow: "GET, PUT", "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const input = JSON.parse(await readRequestBody(request, 512_000));
    const families = normalizeTagFamilies(input?.families);
    const tagMeta = normalizeTagMeta(input?.tagMeta);
    const database = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      families,
      tagMeta
    };
    await writeFile(TAGS_FILE, `${JSON.stringify(database, null, 2)}\n`, "utf8");
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(database));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}

function normalizeTagFamilies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("families must be an object");
  const output = {};
  for (const [family, tags] of Object.entries(value)) {
    if (!family.trim() || !Array.isArray(tags)) continue;
    const cleanTags = [...new Set(tags.map((tag) => String(tag).trim().toLocaleLowerCase("ru")).filter(Boolean))].slice(0, 99);
    if (cleanTags.length) output[family.slice(0, 160)] = cleanTags.map((tag) => tag.slice(0, 60));
  }
  return output;
}

function normalizeTagMeta(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("tagMeta must be an object");
  const output = {};
  for (const [inputTag, metadata] of Object.entries(value)) {
    const tag = String(inputTag).trim().toLocaleLowerCase("ru").slice(0, 60);
    if (!tag) continue;
    const inputColor = String(metadata?.color || "").toLowerCase();
    output[tag] = { color: /^#[0-9a-f]{6}$/.test(inputColor) ? inputColor : "#d9b83f" };
  }
  return output;
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
