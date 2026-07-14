import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://www.googleapis.com/webfonts/v1/webfonts";
const SITE_METADATA_URL = "https://fonts.google.com/metadata/fonts";
const DOCS_URL = "https://developers.google.com/fonts/docs/developer_api";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");
const OUTPUT_FILE = resolve(PROJECT_DIR, "data", "fonts-cyrillic.json");
const API_KEY = process.env.GOOGLE_FONTS_API_KEY?.trim();

const WEIGHT_NAMES = new Map([
  [100, "Thin"],
  [200, "ExtraLight"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
  [900, "Black"]
]);

if (!API_KEY || API_KEY.includes("вставьте_ключ")) {
  fail("В файле .env отсутствует GOOGLE_FONTS_API_KEY.");
}

console.log("uFont: получаю каталог Google Fonts…");

const standardCatalog = await requestCatalog([], "основной каталог");
const variableCatalog = await requestCatalog(["VF"], "variable-данные", true);
const tagsCatalog = await requestCatalog(["FAMILY_TAGS"], "теги", true);
const siteMetadata = await requestSiteMetadata();

const variableByFamily = indexByFamily(variableCatalog.items);
const tagsByFamily = indexByFamily(tagsCatalog.items);
const metadataByFamily = new Map((siteMetadata.familyMetadataList || []).map((font) => [font.family, font]));

const families = standardCatalog.items
  .filter(supportsCyrillic)
  .map((font) => normalizeFamily(
    font,
    variableByFamily.get(font.family),
    tagsByFamily.get(font.family),
    metadataByFamily.get(font.family)
  ))
  .sort((a, b) => a.family.localeCompare(b.family, "en"));

const categoryCounts = countValues(families.map((font) => font.category));
const subsetCounts = countValues(families.flatMap((font) => font.subsets));

const database = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  source: {
    name: "Google Fonts Developer API",
    api: API_URL,
    designerMetadata: SITE_METADATA_URL,
    documentation: DOCS_URL
  },
  criteria: {
    description: "Семейства, заявляющие поддержку cyrillic или cyrillic-ext",
    acceptedSubsets: ["cyrillic", "cyrillic-ext"]
  },
  counts: {
    allGoogleFamilies: standardCatalog.items.length,
    cyrillicFamilies: families.length,
    variableCyrillicFamilies: families.filter((font) => font.variable).length,
    categories: categoryCounts,
    subsets: subsetCounts
  },
  families
};

await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(database, null, 2)}\n`, "utf8");

console.log(`uFont: найдено кириллических семейств: ${families.length}`);
console.log(`uFont: variable-семейств: ${database.counts.variableCyrillicFamilies}`);
console.log(`uFont: база сохранена: ${OUTPUT_FILE}`);

async function requestCatalog(capabilities, label, optional = false) {
  const url = new URL(API_URL);
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("sort", "alpha");
  for (const capability of capabilities) {
    url.searchParams.append("capability", capability);
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const apiMessage = body?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(apiMessage);
    }

    if (!Array.isArray(body?.items)) {
      throw new Error("API вернул ответ без массива items.");
    }

    return body;
  } catch (error) {
    if (optional) {
      console.warn(`uFont: не удалось получить ${label}: ${error.message}`);
      console.warn("uFont: продолжаю без этих дополнительных данных.");
      return { items: [] };
    }
    fail(`Не удалось получить ${label}: ${error.message}`);
  }
}

function supportsCyrillic(font) {
  return font.subsets?.includes("cyrillic") || font.subsets?.includes("cyrillic-ext");
}

function normalizeFamily(font, variableFont, taggedFont, siteFont) {
  const axes = normalizeAxes(variableFont?.axes);
  const styles = (font.variants || [])
    .map((variant) => normalizeVariant(variant, font.files?.[variant], font.family))
    .filter(Boolean)
    .sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));

  return {
    id: slugify(font.family),
    family: font.family,
    designer: normalizeDesigner(siteFont?.designers || font.designer),
    category: font.category || "unknown",
    version: font.version || null,
    lastModified: font.lastModified || null,
    subsets: [...new Set(font.subsets || [])].sort(),
    variable: axes.length > 0,
    axes,
    styles,
    googleTags: normalizeTags(taggedFont?.tags),
    menuUrl: secureUrl(font.menu),
    familyPageUrl: `https://fonts.google.com/specimen/${encodeURIComponent(font.family)}`,
    variableFiles: Object.fromEntries(
      Object.entries(variableFont?.files || {}).map(([variant, url]) => [variant, secureUrl(url)])
    )
  };
}

async function requestSiteMetadata() {
  try {
    const response = await fetch(SITE_METADATA_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    const jsonStart = text.indexOf("{");
    const body = JSON.parse(jsonStart >= 0 ? text.slice(jsonStart) : text);
    if (!Array.isArray(body?.familyMetadataList)) throw new Error("ответ не содержит familyMetadataList");
    return body;
  } catch (error) {
    console.warn(`uFont: не удалось получить имена дизайнеров: ${error.message}`);
    console.warn("uFont: продолжаю без дизайнерских метаданных.");
    return { familyMetadataList: [] };
  }
}

function normalizeDesigner(value) {
  const names = Array.isArray(value) ? value : value ? [value] : [];
  const clean = [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
  return clean.length ? clean.join(", ") : null;
}

function normalizeVariant(variant, fileUrl, family) {
  let weight;
  let italic;

  if (variant === "regular") {
    weight = 400;
    italic = false;
  } else if (variant === "italic") {
    weight = 400;
    italic = true;
  } else {
    const match = /^(\d+)(italic)?$/.exec(variant);
    if (!match) return null;
    weight = Number(match[1]);
    italic = Boolean(match[2]);
  }

  const weightName = WEIGHT_NAMES.get(weight) || String(weight);
  const name = italic
    ? weight === 400 ? "Italic" : `${weightName} Italic`
    : weightName;

  return {
    id: variant,
    name,
    weight,
    italic,
    stretch: inferStretch(family),
    ttfUrl: secureUrl(fileUrl),
    suggestedFileName: `${fileSafeName(family)}-${fileSafeName(name)}.ttf`
  };
}

function inferStretch(family) {
  if (/\b(condensed|narrow|compressed|compact)\b/i.test(family)) return "condensed";
  if (/\b(expanded|extended|wide)\b/i.test(family)) return "expanded";
  return "normal";
}

function normalizeAxes(axes) {
  if (!Array.isArray(axes)) return [];
  return axes
    .filter((axis) => axis?.tag)
    .map((axis) => ({
      tag: axis.tag,
      min: Number(axis.start),
      max: Number(axis.end)
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === "string") return { name: tag, weight: null };
      const name = tag?.name || tag?.tag;
      if (!name) return null;
      return { name, weight: Number.isFinite(Number(tag.weight)) ? Number(tag.weight) : null };
    })
    .filter(Boolean)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.name.localeCompare(b.name));
}

function indexByFamily(items = []) {
  return new Map(items.map((font) => [font.family, font]));
}

function countValues(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map())]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  );
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fileSafeName(value) {
  return value.replace(/[^\p{L}\p{N}]+/gu, "");
}

function secureUrl(value) {
  return typeof value === "string" ? value.replace(/^http:/, "https:") : null;
}

function fail(message) {
  console.error(`uFont: ошибка: ${message}`);
  process.exit(1);
}
