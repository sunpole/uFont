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
    const preferences = normalizePreferences(input?.preferences);
    const database = {
      schemaVersion: 3,
      updatedAt: new Date().toISOString(),
      families,
      tagMeta,
      preferences
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

function normalizePreferences(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("preferences must be an object");
  const output = {};
  const arrayLimits = { visibleStyles: [8, 30], favorites: [3000, 160], rareFonts: [3000, 160], categories: [20, 60], requiredStyles: [8, 30], selectedTags: [99, 60] };
  for (const [key, [limit, length]] of Object.entries(arrayLimits)) output[key] = normalizeStringArray(value[key], limit, length);
  const strings = { fontScope: 20, sortOrder: 30, previewText: 160, previewUnit: 10, view: 20, tagSort: 10, query: 160 };
  for (const [key, length] of Object.entries(strings)) if (typeof value[key] === "string") output[key] = value[key].slice(0, length);
  const numbers = { previewSize: [8, 72], previewPpi: [72, 2400], tagScale: [50, 200] };
  for (const [key, [min, max]] of Object.entries(numbers)) output[key] = clampNumber(value[key], min, max);
  output.invertTagFilter = Boolean(value.invertTagFilter);
  output.condensedOnly = Boolean(value.condensedOnly);
  output.variableOnly = Boolean(value.variableOnly);
  output.inspector = normalizeInspector(value.inspector);
  return output;
}

function normalizeInspector(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  const limits = { moveStep: [1, 10000], topX: [-100000, 100000], topY: [-100000, 100000], bottomX: [-100000, 100000], bottomY: [-100000, 100000], topSize: [6, 300], bottomSize: [6, 300], topScale: [10, 1000], bottomScale: [10, 1000], topOpacity: [0, 100], bottomOpacity: [0, 100] };
  for (const [key, [min, max]] of Object.entries(limits)) output[key] = clampNumber(value[key], min, max);
  for (const key of ["activeLayer", "topFamily", "topStyle", "topColor", "topBlend", "bottomType", "bottomFamily", "bottomStyle", "bottomColor", "bottomBlend"]) if (typeof value[key] === "string") output[key] = value[key].slice(0, 160);
  return output;
}

function normalizeStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, limit).map((item) => item.slice(0, maxLength));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
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
