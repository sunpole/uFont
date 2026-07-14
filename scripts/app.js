"use strict";

const STYLE_DEFS = [
  { id: "regular", name: "Regular", weight: 400, italic: false },
  { id: "italic", name: "Italic", weight: 400, italic: true },
  { id: "medium", name: "Medium", weight: 500, italic: false },
  { id: "semibold", name: "SemiBold", weight: 600, italic: false },
  { id: "bold", name: "Bold", weight: 700, italic: false },
  { id: "bold-italic", name: "Bold Italic", weight: 700, italic: true },
  { id: "black", name: "Black", weight: 900, italic: false },
  { id: "black-italic", name: "Black Italic", weight: 900, italic: true }
];

const FALLBACK_FONTS = [
  { family: "Roboto", category: "sans-serif", variable: false, tags: ["sans", "ui"] },
  { family: "Roboto Condensed", category: "sans-serif", variable: true, tags: ["sans", "condensed"] },
  { family: "Playfair Display", category: "serif", variable: true, tags: ["serif", "editorial"] }
].map((font) => addFontId({
  ...font,
  isCondensed: /\b(condensed|narrow|compressed)\b/i.test(font.family),
  styles: STYLE_DEFS.map((style) => style.id),
  cssStyles: STYLE_DEFS,
  downloads: {},
  familyPageUrl: `https://fonts.google.com/specimen/${encodeURIComponent(font.family)}`
}));

const DEFAULT_TEXT = "400 г. МАССА. Съешь ещё этих мягких французских булок.";
const STORAGE_KEY = "ufont-prototype-v1";
const TAG_DRAFT_STORAGE_KEY = "ufont-user-tags-draft-v1";
const $ = (selector) => document.querySelector(selector);

let FONTS = [];
let fontById = new Map();
let categories = [];
let filterTags = [];
let lazyFontObserver;
const loadedFontFamilies = new Set();

const state = {
  query: "",
  categories: new Set(),
  visibleStyles: new Set(STYLE_DEFS.map((style) => style.id)),
  requiredStyle: "",
  selectedTags: new Set(),
  customTags: new Map(),
  tagStoreWritable: false,
  tagStoreUpdatedAt: null,
  condensedOnly: false,
  variableOnly: false,
  favoritesOnly: false,
  sortOrder: "alphabetical",
  favorites: new Set(),
  previewText: DEFAULT_TEXT,
  previewSize: 26,
  previewPpi: 300,
  view: "table",
  inspector: {
    activeLayer: "top",
    topFamily: "",
    topStyle: "regular",
    topX: 48,
    topY: 80,
    topSize: 54,
    topOpacity: 100,
    topColor: "#171816",
    topBlend: "normal",
    bottomType: "none",
    bottomFamily: "",
    bottomStyle: "regular",
    bottomX: 28,
    bottomY: 220,
    bottomSize: 54,
    bottomOpacity: 55,
    bottomColor: "#b22f2f",
    bottomBlend: "multiply",
    imageUrl: "",
    imageName: ""
  }
};

let inspectorDrag = null;
let lastInspectorWheelAt = 0;

const catalog = $("#catalog");
const searchInput = $("#searchInput");
const previewInput = $("#previewInput");
const sizeRange = $("#sizeRange");
const ppiInput = $("#ppiInput");

initialize();

async function initialize() {
  loadState();
  catalog.innerHTML = `<div class="empty-state"><strong>Загружаю базу шрифтов…</strong>Читаю data/fonts-cyrillic.json</div>`;

  try {
    const response = await fetch("data/fonts-cyrillic.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const database = await response.json();
    if (!Array.isArray(database?.families) || !database.families.length) throw new Error("В JSON отсутствует массив families.");
    FONTS = database.families.map(normalizeDatabaseFont).filter((font) => font.styles.length);
    showNotice(`Загружена база: ${FONTS.length} кириллическое семейство. Шрифты подгружаются по мере прокрутки.`, false);
  } catch (error) {
    FONTS = FALLBACK_FONTS;
    const hint = location.protocol === "file:"
      ? "Откройте проект через npm start, а не двойным щелчком по index.html."
      : "Проверьте наличие data/fonts-cyrillic.json.";
    showNotice(`Полная база не загрузилась: ${error.message}. ${hint} Пока показаны 3 тестовых семейства.`, true);
  }

  await loadCentralTags();

  fontById = new Map(FONTS.map((font) => [font.id, font]));
  categories = [...new Set(FONTS.map((font) => font.category))].sort();
  filterTags = collectTopTags(FONTS, 36);
  buildControls();
  bindEvents();
  render();
}

function normalizeDatabaseFont(font) {
  const cssStyles = (font.styles || [])
    .filter((style) => Number.isFinite(Number(style.weight)))
    .map((style) => ({ weight: Number(style.weight), italic: Boolean(style.italic) }));
  const downloads = {};
  const styles = [];

  for (const style of font.styles || []) {
    const id = styleId(Number(style.weight), Boolean(style.italic));
    if (!id) continue;
    styles.push(id);
    if (style.ttfUrl) downloads[id] = { url: style.ttfUrl, fileName: style.suggestedFileName || `${font.family}-${style.name}.ttf` };
  }

  const googleTags = (font.googleTags || [])
    .map((tag) => String(tag?.name || tag || "").replace(/^\/+/, "").toLocaleLowerCase("ru"))
    .filter(Boolean);
  const derivedTags = [font.category, font.variable ? "variable" : "", ...(font.subsets || []).filter((subset) => subset.startsWith("cyrillic"))];
  const axes = Array.isArray(font.axes) ? font.axes : [];
  const condensedSignal = [font.family, ...googleTags].join(" ");
  const isCondensed = /\b(condensed|narrow|compressed|compact)\b/i.test(condensedSignal)
    || axes.some((axis) => axis?.tag === "wdth" && Number(axis.min) < 100);
  if (isCondensed) derivedTags.push("condensed");

  return addFontId({
    family: font.family,
    category: font.category || "unknown",
    variable: Boolean(font.variable),
    isCondensed,
    tags: [...new Set([...derivedTags, ...googleTags].filter(Boolean))],
    styles: [...new Set(styles)],
    cssStyles,
    downloads,
    familyPageUrl: font.familyPageUrl || `https://fonts.google.com/specimen/${encodeURIComponent(font.family)}`,
    lastModified: font.lastModified || null
  });
}

function styleId(weight, italic) {
  if (weight === 400) return italic ? "italic" : "regular";
  if (weight === 500 && !italic) return "medium";
  if (weight === 600 && !italic) return "semibold";
  if (weight === 700) return italic ? "bold-italic" : "bold";
  if (weight === 900) return italic ? "black-italic" : "black";
  return null;
}

function addFontId(font) {
  return { ...font, id: slugify(font.family) };
}

function collectTopTags(fonts, limit) {
  const counts = new Map();
  for (const font of fonts) for (const tag of font.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state.visibleStyles = new Set((saved.visibleStyles || []).filter((id) => STYLE_DEFS.some((style) => style.id === id)));
    if (!state.visibleStyles.size) state.visibleStyles.add("regular");
    state.favorites = new Set(saved.favorites || []);
    state.sortOrder = ["alphabetical", "custom-tags", "condensed", "favorites"].includes(saved.sortOrder) ? saved.sortOrder : "alphabetical";
    state.previewText = typeof saved.previewText === "string" ? saved.previewText : DEFAULT_TEXT;
    const savedSize = Number(saved.previewSize);
    const sizeInPoints = saved.previewUnit === "pt" ? savedSize : Math.round(savedSize * 0.75);
    state.previewSize = Math.min(72, Math.max(8, sizeInPoints || 26));
    state.previewPpi = Math.min(2400, Math.max(72, Number(saved.previewPpi) || 300));
    state.view = ["table", "gallery", "inspector"].includes(saved.view) ? saved.view : "table";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    visibleStyles: [...state.visibleStyles],
    favorites: [...state.favorites],
    sortOrder: state.sortOrder,
    previewText: state.previewText,
    previewSize: state.previewSize,
    previewUnit: "pt",
    previewPpi: state.previewPpi,
    view: state.view
  }));
}

function buildControls() {
  $("#categoryFilters").innerHTML = categories.map((category) => `
    <label class="check"><input type="checkbox" value="${escapeHtml(category)}"> ${escapeHtml(category)}</label>
  `).join("");
  $("#styleFilters").innerHTML = STYLE_DEFS.map((style) => `
    <label class="check"><input type="checkbox" value="${style.id}" ${state.visibleStyles.has(style.id) ? "checked" : ""}> ${escapeHtml(style.name)}</label>
  `).join("");
  $("#requireStyle").innerHTML = `<option value="">Любые начертания</option>${STYLE_DEFS.map((style) => `<option value="${style.id}">${escapeHtml(style.name)}</option>`).join("")}`;
  $("#tagFilters").innerHTML = filterTags.map((tag) => `<button class="tag-button" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
  renderCustomTagFilters();
  previewInput.value = state.previewText;
  sizeRange.value = String(state.previewSize);
  ppiInput.value = String(state.previewPpi);
  document.querySelectorAll("#sortOrder option").forEach((option) => option.toggleAttribute("selected", option.value === state.sortOrder));
  updateSize();
  updateViewButtons();
}

function filteredFonts() {
  const query = state.query.trim().toLocaleLowerCase("ru");
  return FONTS.filter((font) => {
    const tags = allTags(font);
    const haystack = [font.family, font.category, ...tags].join(" ").toLocaleLowerCase("ru");
    if (query && !haystack.includes(query)) return false;
    if (state.categories.size && !state.categories.has(font.category)) return false;
    if (state.requiredStyle && !font.styles.includes(state.requiredStyle)) return false;
    if (state.selectedTags.size && [...state.selectedTags].some((tag) => !tags.includes(tag))) return false;
    if (state.condensedOnly && !font.isCondensed) return false;
    if (state.variableOnly && !font.variable) return false;
    if (state.favoritesOnly && !state.favorites.has(font.family)) return false;
    return true;
  }).sort(compareFonts);
}

function compareFonts(a, b) {
  const byName = () => a.family.localeCompare(b.family, "ru");
  if (state.sortOrder === "custom-tags") return Number(customTagsFor(b).length > 0) - Number(customTagsFor(a).length > 0) || byName();
  if (state.sortOrder === "condensed") return Number(b.isCondensed) - Number(a.isCondensed) || byName();
  if (state.sortOrder === "favorites") return Number(state.favorites.has(b.family)) - Number(state.favorites.has(a.family)) || byName();
  return byName();
}

function render() {
  const fonts = filteredFonts();
  const visibleStyles = STYLE_DEFS.filter((style) => state.visibleStyles.has(style.id));
  $("#resultCount").textContent = `Найдено: ${fonts.length} из ${FONTS.length}`;
  $("#clearSearch").classList.toggle("is-hidden", !state.query);

  if (!fonts.length) {
    catalog.innerHTML = `<div class="empty-state"><strong>Ничего не найдено</strong>Попробуйте убрать часть фильтров или изменить запрос.</div>`;
    return;
  }
  if (state.view === "inspector") {
    renderInspector(fonts);
    observeRenderedFonts();
    return;
  }
  state.view === "gallery" ? renderGallery(fonts, visibleStyles) : renderTable(fonts, visibleStyles);
  observeRenderedFonts();
}

function renderTable(fonts, visibleStyles) {
  if (!visibleStyles.length) {
    catalog.innerHTML = `<div class="empty-state"><strong>Не выбраны столбцы</strong>Отметьте хотя бы одно начертание.</div>`;
    return;
  }
  catalog.innerHTML = `<div class="table-card"><div class="font-table-scroll"><div class="font-table" style="--visible-cols:${visibleStyles.length}">
    <div class="table-row header-row"><div class="header-cell">Семейство</div>${visibleStyles.map((style) => `<div class="header-cell">${escapeHtml(style.name)}</div>`).join("")}</div>
    ${fonts.map((font) => `<article class="table-row" data-font-id="${escapeHtml(font.id)}">${renderNameCell(font)}${visibleStyles.map((style) => renderFontCell(font, style)).join("")}</article>`).join("")}
  </div></div></div>`;
}

function renderGallery(fonts, visibleStyles) {
  const galleryStyle = visibleStyles[0] || STYLE_DEFS[0];
  catalog.innerHTML = `<div class="gallery">${fonts.map((font) => `
    <article class="gallery-card" data-font-id="${escapeHtml(font.id)}">
      <div class="family-line"><div><div class="family-name">${escapeHtml(font.family)}</div><div class="meta">${escapeHtml(font.category)}${font.isCondensed ? " · Condensed" : ""}${font.variable ? " · Variable" : ""}</div></div>${familyActions(font)}</div>
      <div class="sample" style="${fontStyle(font, galleryStyle)}">${escapeHtml(state.previewText || " ")}</div>
      <div class="style-pills">${STYLE_DEFS.filter((style) => font.styles.includes(style.id)).map((style) => `<span class="style-pill">${escapeHtml(style.name)}</span>`).join("")}</div>
      <a class="family-page-link" href="${escapeHtml(font.familyPageUrl)}" target="_blank" rel="noopener">Открыть в Google Fonts ↗</a>
      <div class="row-tags">${renderFontTags(font, 6)}</div>
    </article>`).join("")}</div>`;
}

function renderInspector(fonts) {
  const inspector = state.inspector;
  const pool = fonts.length ? fonts : FONTS;
  if (!pool.some((font) => font.family === inspector.topFamily)) inspector.topFamily = pool[0].family;
  const topFont = fontById.get(slugify(inspector.topFamily)) || pool[0];
  const bottomFont = fontById.get(slugify(inspector.bottomFamily)) || topFont;
  const topIndex = Math.max(0, pool.findIndex((font) => font.family === topFont.family));
  const bottomLayer = inspector.bottomType === "image" && inspector.imageUrl
    ? `<img class="inspector-layer inspector-layer-image ${inspector.activeLayer === "bottom" ? "active" : ""}" data-inspector-layer="bottom" src="${escapeHtml(inspector.imageUrl)}" alt="${escapeHtml(inspector.imageName || "Нижний слой")}" style="${inspectorLayerStyle("bottom")};z-index:1">`
    : inspector.bottomType === "font"
      ? `<div class="inspector-layer ${inspector.activeLayer === "bottom" ? "active" : ""}" data-inspector-layer="bottom" data-font-id="${escapeHtml(bottomFont.id)}" style="${inspectorLayerStyle("bottom", bottomFont)};z-index:1">${escapeHtml(state.previewText || " ")}</div>`
      : "";

  catalog.innerHTML = `<div class="inspector-layout">
    <section class="inspector-stage-card">
      <div class="inspector-stage" id="inspectorStage" aria-label="Сцена сравнения слоёв">
        ${bottomLayer}
        <div class="inspector-layer ${inspector.activeLayer === "top" ? "active" : ""}" data-inspector-layer="top" data-font-id="${escapeHtml(topFont.id)}" style="${inspectorLayerStyle("top", topFont)};z-index:2">${escapeHtml(state.previewText || " ")}</div>
      </div>
      <div class="inspector-stage-help"><span>Перетаскивайте слой мышью. Стрелки — точная настройка.</span><span>Колесо мыши меняет верхний шрифт.</span></div>
    </section>
    <aside class="inspector-panel" aria-label="Настройки инспектора">
      <div class="inspector-panel-head"><div class="meta">Верхний шрифт · ${topIndex + 1} из ${pool.length}</div><div class="inspector-current-font">${escapeHtml(topFont.family)}</div></div>
      <div class="inspector-layer-tabs">
        <button type="button" class="${inspector.activeLayer === "top" ? "active" : ""}" data-inspector-select-layer="top">Верхний слой</button>
        <button type="button" class="${inspector.activeLayer === "bottom" ? "active" : ""}" data-inspector-select-layer="bottom">Нижний слой</button>
      </div>
      <div class="inspector-controls">${inspector.activeLayer === "top" ? inspectorTopControls(topFont, pool) : inspectorBottomControls(bottomFont, pool)}</div>
    </aside>
    <datalist id="inspectorFonts">${pool.map((font) => `<option value="${escapeHtml(font.family)}"></option>`).join("")}</datalist>
    <input class="is-hidden" id="inspectorImageFile" type="file" accept="image/*">
  </div>`;
}

function inspectorTopControls(font, pool) {
  return `${inspectorFontChooser("top", font, pool)}${inspectorLayerControls("top", true)}`;
}

function inspectorBottomControls(font, pool) {
  const inspector = state.inspector;
  const sourceControls = `<div class="inspector-control"><div class="inspector-control-label">Содержимое нижнего слоя</div>
    <div class="inspector-control-row"><button class="inspector-action" type="button" data-inspector-action="bottom-from-top">Закрепить верхний шрифт</button><button class="inspector-action" type="button" data-inspector-action="upload-image">Загрузить изображение</button></div>
    <button class="inspector-action danger" type="button" data-inspector-action="clear-bottom">Очистить нижний слой</button></div>`;
  if (inspector.bottomType === "font") return `${sourceControls}${inspectorFontChooser("bottom", font, pool)}${inspectorLayerControls("bottom", true)}`;
  if (inspector.bottomType === "image") return `${sourceControls}<div class="meta">Изображение: ${escapeHtml(inspector.imageName || "без названия")}</div>${inspectorLayerControls("bottom", false)}`;
  return `${sourceControls}<div class="empty-state" style="padding:24px 12px"><strong style="font-size:15px">Нижний слой пуст</strong>Добавьте изображение или закрепите текущий верхний шрифт.</div>`;
}

function inspectorFontChooser(layer, font, pool) {
  const key = layer === "top" ? "top" : "bottom";
  const styleIdValue = state.inspector[`${key}Style`];
  return `<div class="inspector-control"><label for="inspector-${key}-font">Шрифт</label><input class="control" id="inspector-${key}-font" list="inspectorFonts" value="${escapeHtml(font.family)}" data-inspector-font="${key}" autocomplete="off"></div>
    <div class="inspector-control"><label for="inspector-${key}-style">Начертание</label><select class="control" id="inspector-${key}-style" data-inspector-setting="${key}Style">${STYLE_DEFS.filter((style) => font.styles.includes(style.id)).map((style) => `<option value="${style.id}" ${style.id === styleIdValue ? "selected" : ""}>${escapeHtml(style.name)}</option>`).join("")}</select></div>`;
}

function inspectorLayerControls(layer, isFont) {
  const inspector = state.inspector;
  const prefix = layer === "top" ? "top" : "bottom";
  const blendOptions = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"];
  return `${isFont ? `<div class="inspector-control-row"><div class="inspector-control"><label>Размер, pt</label><input class="inspector-number" type="number" min="6" max="300" step="1" value="${inspector[`${prefix}Size`]}" data-inspector-setting="${prefix}Size"></div><div class="inspector-control"><label>Цвет</label><input class="inspector-color" type="color" value="${inspector[`${prefix}Color`]}" data-inspector-setting="${prefix}Color"></div></div>` : ""}
    <div class="inspector-control"><label>Прозрачность, %</label><input type="range" min="0" max="100" step="1" value="${inspector[`${prefix}Opacity`]}" data-inspector-setting="${prefix}Opacity"><output>${inspector[`${prefix}Opacity`]}%</output></div>
    <div class="inspector-control"><label>Наложение</label><select class="control" data-inspector-setting="${prefix}Blend">${blendOptions.map((mode) => `<option value="${mode}" ${mode === inspector[`${prefix}Blend`] ? "selected" : ""}>${mode}</option>`).join("")}</select></div>
    <div class="inspector-control-row"><div class="inspector-control"><label>X, px</label><input class="inspector-number" type="number" step="1" value="${inspector[`${prefix}X`]}" data-inspector-setting="${prefix}X"></div><div class="inspector-control"><label>Y, px</label><input class="inspector-number" type="number" step="1" value="${inspector[`${prefix}Y`]}" data-inspector-setting="${prefix}Y"></div></div>
    <div class="inspector-arrows" aria-label="Точная настройка позиции"><button type="button" data-nudge="up">↑</button><button type="button" data-nudge="left">←</button><button type="button" data-nudge="down">↓</button><button type="button" data-nudge="right">→</button></div>`;
}

function inspectorLayerStyle(layer, font) {
  const inspector = state.inspector;
  const prefix = layer === "top" ? "top" : "bottom";
  const base = `transform:translate(${inspector[`${prefix}X`]}px,${inspector[`${prefix}Y`]}px);opacity:${inspector[`${prefix}Opacity`] / 100};mix-blend-mode:${inspector[`${prefix}Blend`]}`;
  if (!font) return base;
  const style = STYLE_DEFS.find((item) => item.id === inspector[`${prefix}Style`]) || STYLE_DEFS[0];
  return `${base};font-family:&quot;${escapeHtml(font.family)}&quot;,${escapeHtml(font.category)};font-size:${inspector[`${prefix}Size`]}pt;font-weight:${style.weight};font-style:${style.italic ? "italic" : "normal"};color:${inspector[`${prefix}Color`]}`;
}

function renderNameCell(font) {
  return `<div class="font-name-cell"><div class="family-line"><div class="family-name">${escapeHtml(font.family)}</div>${familyActions(font)}</div>
    <div class="meta">${escapeHtml(font.category)}${font.isCondensed ? " · Condensed" : ""}${font.variable ? " · Variable" : ""}${font.lastModified ? `<br>Обновлён: ${escapeHtml(font.lastModified)}` : ""}</div>
    <a class="family-page-link" href="${escapeHtml(font.familyPageUrl)}" target="_blank" rel="noopener">Google Fonts ↗</a>
    <div class="row-tags">${renderFontTags(font, 5)}</div></div>`;
}

function familyActions(font) {
  return `<div class="family-actions"><button class="add-tag-button" type="button" data-edit-tags="${escapeHtml(font.family)}" aria-label="Изменить пользовательские теги">＋ тег</button>${favoriteButton(font)}</div>`;
}

function renderFontTags(font, limit) {
  const custom = customTagsFor(font).map((tag) => `<button class="mini-tag custom" type="button" data-tag="${escapeHtml(tag)}" title="Пользовательский тег">${escapeHtml(tag)}</button>`);
  const builtIn = font.tags.filter((tag) => !customTagsFor(font).includes(tag)).map(tagButton);
  return [...custom, ...builtIn].slice(0, limit).join("");
}

function tagButton(tag) {
  return `<button class="mini-tag" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
}

function customTagsFor(font) {
  return state.customTags.get(font.family) || [];
}

function allTags(font) {
  return [...new Set([...font.tags, ...customTagsFor(font)])];
}

function sanitizeCustomTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag).trim().toLocaleLowerCase("ru")).filter(Boolean))].slice(0, 20);
}

async function loadCentralTags() {
  let database;
  try {
    const apiResponse = await fetch("api/user-tags", { cache: "no-store" });
    if (!apiResponse.ok) throw new Error(String(apiResponse.status));
    database = await apiResponse.json();
    state.tagStoreWritable = true;
  } catch {
    try {
      const staticResponse = await fetch("data/user-tags.json", { cache: "no-store" });
      if (!staticResponse.ok) throw new Error(String(staticResponse.status));
      database = await staticResponse.json();
    } catch {
      database = { families: {} };
    }
    state.tagStoreWritable = false;
  }

  state.customTags = normalizeTagDatabase(database?.families);
  if (!state.tagStoreWritable) {
    try {
      const draft = JSON.parse(localStorage.getItem(TAG_DRAFT_STORAGE_KEY));
      state.customTags = mergeTagMaps(state.customTags, normalizeTagDatabase(draft?.families));
    } catch {
      localStorage.removeItem(TAG_DRAFT_STORAGE_KEY);
    }
  }
  state.tagStoreUpdatedAt = database?.updatedAt || null;
  updateTagStoreStatus();
}

function updateTagStoreStatus() {
  const status = $("#tagStoreStatus");
  if (!status) return;
  status.textContent = state.tagStoreWritable
    ? "Редактирование включено: изменения записываются в data/user-tags.json."
    : "Статический режим: изменения сохраняются как черновик в браузере. Экспортируйте JSON для переноса на рабочий ПК.";
}

function normalizeTagDatabase(families) {
  const output = new Map();
  if (!families || typeof families !== "object" || Array.isArray(families)) return output;
  for (const [inputFamily, inputTags] of Object.entries(families)) {
    const family = canonicalFamilyName(inputFamily);
    const tags = sanitizeCustomTags(inputTags);
    if (!family || !tags.length) continue;
    output.set(family, [...new Set([...(output.get(family) || []), ...tags])]);
  }
  return output;
}

function canonicalFamilyName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  return FONTS.find((font) => font.family.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))?.family || name.slice(0, 160);
}

function mergeTagMaps(base, incoming) {
  const merged = new Map([...base].map(([family, tags]) => [family, [...tags]]));
  for (const [family, tags] of incoming) merged.set(family, sanitizeCustomTags([...(merged.get(family) || []), ...tags]));
  return merged;
}

function tagDatabaseObject() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    families: Object.fromEntries([...state.customTags].sort(([a], [b]) => a.localeCompare(b, "ru")))
  };
}

function saveTagDraft() {
  localStorage.setItem(TAG_DRAFT_STORAGE_KEY, JSON.stringify(tagDatabaseObject()));
}

async function saveTagsToCurrentStore() {
  if (!state.tagStoreWritable) {
    saveTagDraft();
    return;
  }
  const response = await fetch("api/user-tags", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tagDatabaseObject())
  });
  if (!response.ok) throw new Error(String(response.status));
  const saved = await response.json();
  state.tagStoreUpdatedAt = saved.updatedAt || null;
}

function exportTagsFile() {
  const blob = new Blob([`${JSON.stringify(tagDatabaseObject(), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ufont-user-tags-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importTagsFile(file) {
  if (!file) return;
  try {
    const database = JSON.parse(await file.text());
    const incoming = normalizeTagDatabase(database?.families);
    if (!incoming.size) throw new Error("В файле нет пользовательских тегов.");
    const before = countAssignedTags(state.customTags);
    state.customTags = mergeTagMaps(state.customTags, incoming);
    const added = countAssignedTags(state.customTags) - before;
    await saveTagsToCurrentStore();
    renderCustomTagFilters();
    syncFilterUI();
    render();
    window.alert(`Импорт завершён. Добавлено новых связей «шрифт — тег»: ${added}. Дубли пропущены.`);
  } catch (error) {
    window.alert(`Не удалось импортировать теги: ${error.message}`);
  }
}

function countAssignedTags(tagMap) {
  return [...tagMap.values()].reduce((total, tags) => total + tags.length, 0);
}

function renderCustomTagFilters() {
  const tags = [...new Set([...state.customTags.values()].flat())].sort((a, b) => a.localeCompare(b, "ru"));
  $("#customTagFilters").innerHTML = tags.length
    ? tags.map((tag) => `<button class="tag-button custom" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="user-tags-empty">Добавьте тег кнопкой «＋ тег» возле семейства.</span>`;
}

async function editCustomTags(family) {
  const current = state.customTags.get(family) || [];
  const answer = window.prompt(`Мои теги для ${family}\nВведите через запятую. Чтобы удалить все — оставьте поле пустым.`, current.join(", "));
  if (answer === null) return;
  const tags = sanitizeCustomTags(answer.split(","));
  tags.length ? state.customTags.set(family, tags) : state.customTags.delete(family);
  try {
    await saveTagsToCurrentStore();
  } catch (error) {
    current.length ? state.customTags.set(family, current) : state.customTags.delete(family);
    window.alert(`Не удалось записать базу тегов: ${error.message}`);
    return;
  }
  const availableTags = new Set([...state.customTags.values()].flat());
  state.selectedTags = new Set([...state.selectedTags].filter((tag) => filterTags.includes(tag) || availableTags.has(tag)));
  renderCustomTagFilters();
  syncFilterUI();
  render();
}

function favoriteButton(font) {
  const active = state.favorites.has(font.family);
  return `<button class="favorite ${active ? "active" : ""}" type="button" data-favorite="${escapeHtml(font.family)}" aria-label="${active ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${active}">${active ? "★" : "☆"}</button>`;
}

function renderFontCell(font, style) {
  if (!font.styles.includes(style.id)) return `<div class="font-cell"><div class="style-top"><div class="style-label">Нет начертания</div></div><div class="missing">—</div></div>`;
  const download = font.downloads[style.id];
  return `<div class="font-cell"><div class="style-top"><div class="style-label">${style.weight} · ${style.italic ? "курсив" : "прямое"}</div>
    ${download ? `<button class="download-link" type="button" data-download-url="${escapeHtml(download.url)}" data-download-name="${escapeHtml(download.fileName)}">↓ TTF</button>` : ""}</div>
    <div class="sample" style="${fontStyle(font, style)}">${escapeHtml(state.previewText || " ")}</div></div>`;
}

function fontStyle(font, style) {
  return `font-family:&quot;${escapeHtml(font.family)}&quot;,${escapeHtml(font.category)};font-weight:${style.weight};font-style:${style.italic ? "italic" : "normal"}`;
}

function observeRenderedFonts() {
  lazyFontObserver?.disconnect();
  const rows = [...catalog.querySelectorAll("[data-font-id]")];
  if (!("IntersectionObserver" in window)) {
    rows.slice(0, 20).forEach((row) => loadFontForElement(row));
    return;
  }
  lazyFontObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      loadFontForElement(entry.target);
      lazyFontObserver.unobserve(entry.target);
    }
  }, { rootMargin: "500px 0px" });
  rows.forEach((row) => lazyFontObserver.observe(row));
}

function loadFontForElement(element) {
  const font = fontById.get(element.dataset.fontId);
  if (!font || loadedFontFamilies.has(font.family)) return;
  const request = googleCssRequest(font);
  if (!request) return;
  loadedFontFamilies.add(font.family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = request;
  link.dataset.ufontFamily = font.family;
  link.addEventListener("error", () => loadedFontFamilies.delete(font.family), { once: true });
  document.head.appendChild(link);
}

function googleCssRequest(font) {
  const styles = [...new Map(font.cssStyles.map((style) => [`${Number(style.italic)},${style.weight}`, style])).values()]
    .sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
  if (!styles.length) return null;
  const family = encodeURIComponent(font.family).replace(/%20/g, "+");
  const hasItalic = styles.some((style) => style.italic);
  const specification = hasItalic
    ? `ital,wght@${styles.map((style) => `${Number(style.italic)},${style.weight}`).join(";")}`
    : `wght@${[...new Set(styles.map((style) => style.weight))].join(";")}`;
  return `https://fonts.googleapis.com/css2?family=${family}:${specification}&display=swap`;
}

async function downloadFont(button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "…";
  try {
    const response = await fetch(button.dataset.downloadUrl);
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = button.dataset.downloadName || "font.ttf";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(button.dataset.downloadUrl, "_blank", "noopener");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function updateSize() {
  state.previewSize = Number(sizeRange.value);
  state.previewPpi = Math.min(2400, Math.max(72, Number(ppiInput.value) || 300));
  document.documentElement.style.setProperty("--preview-size", `${state.previewSize}pt`);
  $("#sizeOutput").value = `${state.previewSize} pt`;
  const millimeters = state.previewSize * 25.4 / 72;
  const printPixels = state.previewSize * state.previewPpi / 72;
  const pixelsPerMillimeter = state.previewPpi / 25.4;
  $("#sizeConversion").innerHTML = `<strong>${millimeters.toFixed(2)} мм</strong> · ≈${Math.round(printPixels)} px при ${state.previewPpi} PPI<br>${pixelsPerMillimeter.toFixed(3)} px на 1 мм`;
}

function updateViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
}

function syncFilterUI() {
  document.querySelectorAll("#categoryFilters input").forEach((input) => { input.checked = state.categories.has(input.value); });
  document.querySelectorAll("#styleFilters input").forEach((input) => { input.checked = state.visibleStyles.has(input.value); });
  document.querySelectorAll("#tagFilters [data-tag]").forEach((button) => button.classList.toggle("active", state.selectedTags.has(button.dataset.tag)));
  document.querySelectorAll("#customTagFilters [data-tag]").forEach((button) => button.classList.toggle("active", state.selectedTags.has(button.dataset.tag)));
  document.querySelectorAll("#requireStyle option").forEach((option) => option.toggleAttribute("selected", option.value === state.requiredStyle));
  $("#condensedOnly").checked = state.condensedOnly;
  $("#variableOnly").checked = state.variableOnly;
  $("#favoritesOnly").checked = state.favoritesOnly;
  document.querySelectorAll("#sortOrder option").forEach((option) => option.toggleAttribute("selected", option.value === state.sortOrder));
  searchInput.value = state.query;
}

function resetFilters() {
  state.query = "";
  state.categories.clear();
  state.visibleStyles = new Set(STYLE_DEFS.map((style) => style.id));
  state.requiredStyle = "";
  state.selectedTags.clear();
  state.condensedOnly = false;
  state.variableOnly = false;
  state.favoritesOnly = false;
  state.sortOrder = "alphabetical";
  state.previewText = DEFAULT_TEXT;
  state.previewSize = 26;
  state.previewPpi = 300;
  state.view = "table";
  previewInput.value = state.previewText;
  sizeRange.value = String(state.previewSize);
  ppiInput.value = String(state.previewPpi);
  updateSize();
  updateViewButtons();
  syncFilterUI();
  saveState();
  render();
}

function bindEvents() {
  searchInput.addEventListener("input", (event) => { state.query = event.target.value; render(); });
  $("#clearSearch").addEventListener("click", () => { state.query = ""; searchInput.value = ""; searchInput.focus(); render(); });
  previewInput.addEventListener("input", (event) => { state.previewText = event.target.value; saveState(); render(); });
  sizeRange.addEventListener("input", () => { updateSize(); saveState(); });
  ppiInput.addEventListener("input", () => { updateSize(); saveState(); });
  ppiInput.addEventListener("change", () => { ppiInput.value = String(state.previewPpi); });
  $("#categoryFilters").addEventListener("change", (event) => { event.target.checked ? state.categories.add(event.target.value) : state.categories.delete(event.target.value); render(); });
  $("#styleFilters").addEventListener("change", (event) => { event.target.checked ? state.visibleStyles.add(event.target.value) : state.visibleStyles.delete(event.target.value); saveState(); render(); });
  $("#requireStyle").addEventListener("change", (event) => { state.requiredStyle = event.target.value; render(); });
  $("#condensedOnly").addEventListener("change", (event) => { state.condensedOnly = event.target.checked; render(); });
  $("#variableOnly").addEventListener("change", (event) => { state.variableOnly = event.target.checked; render(); });
  $("#favoritesOnly").addEventListener("change", (event) => { state.favoritesOnly = event.target.checked; render(); });
  $("#tagFilters").addEventListener("click", (event) => toggleTag(event.target.closest("[data-tag]")?.dataset.tag));
  $("#customTagFilters").addEventListener("click", (event) => toggleTag(event.target.closest("[data-tag]")?.dataset.tag));
  $("#exportTags").addEventListener("click", exportTagsFile);
  $("#importTags").addEventListener("click", () => $("#importTagsFile").click());
  $("#importTagsFile").addEventListener("change", async (event) => {
    await importTagsFile(event.target.files?.[0]);
    event.target.value = "";
  });
  $("#sortOrder").addEventListener("change", (event) => { state.sortOrder = event.target.value; saveState(); render(); });
  $("#resetButton").addEventListener("click", resetFilters);
  catalog.addEventListener("wheel", handleInspectorWheel, { passive: false });
  catalog.addEventListener("pointerdown", startInspectorDrag);
  catalog.addEventListener("input", handleInspectorSettingInput);
  catalog.addEventListener("change", handleInspectorChange);
  document.addEventListener("pointermove", moveInspectorDrag);
  document.addEventListener("pointerup", endInspectorDrag);

  document.addEventListener("click", (event) => {
    const download = event.target.closest("[data-download-url]");
    if (download) { downloadFont(download); return; }
    const editTags = event.target.closest("[data-edit-tags]");
    if (editTags) { editCustomTags(editTags.dataset.editTags); return; }
    const inspectorLayer = event.target.closest("[data-inspector-select-layer]");
    if (inspectorLayer) { state.inspector.activeLayer = inspectorLayer.dataset.inspectorSelectLayer; render(); return; }
    const inspectorAction = event.target.closest("[data-inspector-action]");
    if (inspectorAction) { handleInspectorAction(inspectorAction.dataset.inspectorAction); return; }
    const nudge = event.target.closest("[data-nudge]");
    if (nudge) { nudgeInspectorLayer(nudge.dataset.nudge, event.shiftKey ? 10 : 1); return; }
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      const family = favorite.dataset.favorite;
      state.favorites.has(family) ? state.favorites.delete(family) : state.favorites.add(family);
      saveState(); render(); return;
    }
    const miniTag = event.target.closest(".mini-tag[data-tag]");
    if (miniTag) { toggleTag(miniTag.dataset.tag, true); return; }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { state.view = viewButton.dataset.view; updateViewButtons(); saveState(); render(); return; }
    const clearButton = event.target.closest("[data-clear]");
    if (clearButton?.dataset.clear === "categories") state.categories.clear();
    if (clearButton?.dataset.clear === "tags") state.selectedTags.clear();
    if (clearButton?.dataset.clear === "custom-tags") state.selectedTags.clear();
    if (clearButton) { syncFilterUI(); render(); return; }
    if (event.target.closest("[data-action='all-styles']")) {
      state.visibleStyles = new Set(STYLE_DEFS.map((style) => style.id));
      syncFilterUI(); saveState(); render();
    }
  });
}

function handleInspectorWheel(event) {
  if (state.view !== "inspector" || !event.target.closest("#inspectorStage")) return;
  event.preventDefault();
  const now = Date.now();
  if (now - lastInspectorWheelAt < 80) return;
  lastInspectorWheelAt = now;
  const pool = filteredFonts();
  if (!pool.length) return;
  const currentIndex = Math.max(0, pool.findIndex((font) => font.family === state.inspector.topFamily));
  const direction = event.deltaY > 0 ? 1 : -1;
  const next = pool[(currentIndex + direction + pool.length) % pool.length];
  state.inspector.topFamily = next.family;
  if (!next.styles.includes(state.inspector.topStyle)) state.inspector.topStyle = next.styles[0] || "regular";
  render();
}

function startInspectorDrag(event) {
  if (state.view !== "inspector") return;
  const element = event.target.closest("[data-inspector-layer]");
  if (!element) return;
  const layer = element.dataset.inspectorLayer;
  const prefix = layer === "top" ? "top" : "bottom";
  state.inspector.activeLayer = layer;
  inspectorDrag = {
    pointerId: event.pointerId,
    layer,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: state.inspector[`${prefix}X`],
    startY: state.inspector[`${prefix}Y`],
    element
  };
  element.setPointerCapture?.(event.pointerId);
  element.classList.add("active");
}

function moveInspectorDrag(event) {
  if (!inspectorDrag || event.pointerId !== inspectorDrag.pointerId) return;
  const prefix = inspectorDrag.layer === "top" ? "top" : "bottom";
  state.inspector[`${prefix}X`] = Math.round(inspectorDrag.startX + event.clientX - inspectorDrag.startClientX);
  state.inspector[`${prefix}Y`] = Math.round(inspectorDrag.startY + event.clientY - inspectorDrag.startClientY);
  applyInspectorLayerStyle(inspectorDrag.layer, inspectorDrag.element);
}

function endInspectorDrag(event) {
  if (!inspectorDrag || event.pointerId !== inspectorDrag.pointerId) return;
  inspectorDrag.element.releasePointerCapture?.(event.pointerId);
  inspectorDrag = null;
  render();
}

function handleInspectorSettingInput(event) {
  const key = event.target.dataset.inspectorSetting;
  if (!key) return;
  const numeric = /(?:X|Y|Size|Opacity)$/.test(key);
  state.inspector[key] = numeric ? Number(event.target.value) : event.target.value;
  const layer = key.startsWith("top") ? "top" : "bottom";
  applyInspectorLayerStyle(layer);
  if (key.endsWith("Opacity") && event.target.nextElementSibling) event.target.nextElementSibling.textContent = `${event.target.value}%`;
}

function handleInspectorChange(event) {
  const fontLayer = event.target.dataset.inspectorFont;
  if (fontLayer) {
    const family = canonicalFamilyName(event.target.value);
    const font = FONTS.find((item) => item.family === family);
    if (!font) { render(); return; }
    state.inspector[`${fontLayer}Family`] = font.family;
    if (!font.styles.includes(state.inspector[`${fontLayer}Style`])) state.inspector[`${fontLayer}Style`] = font.styles[0] || "regular";
    render();
    return;
  }
  if (event.target.id === "inspectorImageFile") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (state.inspector.imageUrl) URL.revokeObjectURL(state.inspector.imageUrl);
    state.inspector.imageUrl = URL.createObjectURL(file);
    state.inspector.imageName = file.name;
    state.inspector.bottomType = "image";
    state.inspector.activeLayer = "bottom";
    render();
    return;
  }
  if (event.target.dataset.inspectorSetting) render();
}

function applyInspectorLayerStyle(layer, providedElement) {
  const element = providedElement || catalog.querySelector(`[data-inspector-layer="${layer}"]`);
  if (!element) return;
  const font = layer === "top"
    ? fontById.get(slugify(state.inspector.topFamily))
    : state.inspector.bottomType === "font" ? fontById.get(slugify(state.inspector.bottomFamily)) : null;
  const zIndex = layer === "top" ? 2 : 1;
  element.style.cssText = `${inspectorLayerStyle(layer, font)};z-index:${zIndex}`;
}

function handleInspectorAction(action) {
  if (action === "bottom-from-top") {
    state.inspector.bottomType = "font";
    state.inspector.bottomFamily = state.inspector.topFamily;
    state.inspector.bottomStyle = state.inspector.topStyle;
    state.inspector.bottomSize = state.inspector.topSize;
    state.inspector.bottomX = state.inspector.topX + 18;
    state.inspector.bottomY = state.inspector.topY + 18;
    state.inspector.activeLayer = "bottom";
  }
  if (action === "upload-image") catalog.querySelector("#inspectorImageFile")?.click();
  if (action === "clear-bottom") {
    if (state.inspector.imageUrl) URL.revokeObjectURL(state.inspector.imageUrl);
    state.inspector.imageUrl = "";
    state.inspector.imageName = "";
    state.inspector.bottomType = "none";
  }
  if (action !== "upload-image") render();
}

function nudgeInspectorLayer(direction, amount) {
  const prefix = state.inspector.activeLayer === "top" ? "top" : "bottom";
  if (direction === "left") state.inspector[`${prefix}X`] -= amount;
  if (direction === "right") state.inspector[`${prefix}X`] += amount;
  if (direction === "up") state.inspector[`${prefix}Y`] -= amount;
  if (direction === "down") state.inspector[`${prefix}Y`] += amount;
  render();
}

function toggleTag(tag, forceOn = false) {
  if (!tag) return;
  if (forceOn) state.selectedTags.add(tag);
  else state.selectedTags.has(tag) ? state.selectedTags.delete(tag) : state.selectedTags.add(tag);
  syncFilterUI();
  render();
}

function showNotice(message, isWarning) {
  const notice = $("#fontNotice");
  notice.textContent = message;
  notice.classList.add("show");
  notice.style.borderColor = isWarning ? "#ebd9a6" : "#b9d8c6";
  notice.style.background = isWarning ? "#fff8dd" : "#edf8f1";
  notice.style.color = isWarning ? "#64531f" : "#28543b";
}

function slugify(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}
