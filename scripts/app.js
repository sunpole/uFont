"use strict";

const STYLE_DEFS = [
  { id: "thin", name: "Thin", weight: 100, italic: false },
  { id: "thin-italic", name: "Thin Italic", weight: 100, italic: true },
  { id: "extralight", name: "ExtraLight", weight: 200, italic: false },
  { id: "extralight-italic", name: "ExtraLight Italic", weight: 200, italic: true },
  { id: "light", name: "Light", weight: 300, italic: false },
  { id: "light-italic", name: "Light Italic", weight: 300, italic: true },
  { id: "regular", name: "Regular", weight: 400, italic: false },
  { id: "italic", name: "Italic", weight: 400, italic: true },
  { id: "medium", name: "Medium", weight: 500, italic: false },
  { id: "medium-italic", name: "Medium Italic", weight: 500, italic: true },
  { id: "semibold", name: "SemiBold", weight: 600, italic: false },
  { id: "semibold-italic", name: "SemiBold Italic", weight: 600, italic: true },
  { id: "bold", name: "Bold", weight: 700, italic: false },
  { id: "bold-italic", name: "Bold Italic", weight: 700, italic: true },
  { id: "extrabold", name: "ExtraBold", weight: 800, italic: false },
  { id: "extrabold-italic", name: "ExtraBold Italic", weight: 800, italic: true },
  { id: "black", name: "Black", weight: 900, italic: false },
  { id: "black-italic", name: "Black Italic", weight: 900, italic: true }
];

const LEGACY_STYLE_IDS = new Set(["regular", "italic", "medium", "semibold", "bold", "bold-italic", "black", "black-italic"]);
const FILTERABLE_SUBSETS = ["latin", "latin-ext", "greek", "greek-ext", "vietnamese"];

const FALLBACK_FONTS = [
  { family: "Roboto", category: "sans-serif", variable: false, tags: ["sans", "ui"] },
  { family: "Roboto Condensed", category: "sans-serif", variable: true, tags: ["sans", "condensed"] },
  { family: "Playfair Display", category: "serif", variable: true, tags: ["serif", "editorial"] }
].map((font) => addFontId({
  ...font,
  designer: "",
  isCondensed: /\b(condensed|narrow|compressed)\b/i.test(font.family),
  isExpanded: false,
  subsets: ["cyrillic", "latin"],
  styles: STYLE_DEFS.map((style) => style.id),
  cssStyles: STYLE_DEFS,
  downloads: {},
  familyPageUrl: `https://fonts.google.com/specimen/${encodeURIComponent(font.family)}`
}));

const DEFAULT_TEXT = "400 г. МАССА. Съешь ещё этих мягких французских булок.";
const STORAGE_KEY = "ufont-prototype-v1";
const TAG_DRAFT_STORAGE_KEY = "ufont-user-tags-draft-v1";
const SIDEBAR_SECTION_IDS = ["categories", "styles", "required-styles", "google-tags", "custom-tags", "additional", "text-size"];
const $ = (selector) => document.querySelector(selector);

let FONTS = [];
let fontById = new Map();
let categories = [];
let availableSubsets = [];
let filterTags = [];
let lazyFontObserver;
let portableStateReady = false;
let portableSaveTimer;
const loadedFontFamilies = new Set();

const state = {
  query: "",
  categories: new Set(),
  visibleStyles: new Set(STYLE_DEFS.map((style) => style.id)),
  requiredStyles: new Set(),
  selectedSubsets: new Set(),
  selectedTags: new Set(),
  customTags: new Map(),
  tagMeta: new Map(),
  tagSort: "asc",
  invertTagFilter: false,
  googleTagScale: 100,
  customTagScale: 100,
  collapsedSections: new Set(),
  tagStoreWritable: false,
  tagStoreUpdatedAt: null,
  condensedOnly: false,
  expandedOnly: false,
  variableOnly: false,
  fontScope: "working",
  sortOrder: "alphabetical",
  favorites: new Set(),
  rareFonts: new Set(),
  previewText: DEFAULT_TEXT,
  previewSize: 26,
  previewPpi: 300,
  view: "table",
  inspector: {
    activeLayer: "top",
    moveStep: 1,
    topFamily: "",
    topStyle: "regular",
    topX: 48,
    topY: 80,
    topSize: 54,
    topScale: 100,
    topOpacity: 100,
    topColor: "#171816",
    topBlend: "normal",
    bottomType: "none",
    bottomFamily: "",
    bottomStyle: "regular",
    bottomX: 28,
    bottomY: 220,
    bottomSize: 54,
    bottomScale: 100,
    bottomOpacity: 55,
    bottomColor: "#b22f2f",
    bottomBlend: "multiply",
    imageUrl: "",
    imageName: ""
  }
};

let inspectorDrag = null;
let lastInspectorWheelAt = 0;
let inspectorTouchStartX = null;
let inspectorSuppressClickUntil = 0;
const tagEditorState = { family: "", selected: new Set(), query: "", pendingMeta: new Map() };

const catalog = $("#catalog");
const searchInput = $("#searchInput");
const previewInput = $("#previewInput");
const sizeRange = $("#sizeRange");
const ppiInput = $("#ppiInput");

initialize();

async function initialize() {
  loadState();
  configureEnvironmentLink();
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
  availableSubsets = FILTERABLE_SUBSETS.filter((subset) => FONTS.some((font) => font.subsets.includes(subset)));
  filterTags = collectTopTags(FONTS);
  buildControls();
  bindEvents();
  render();
}

function normalizeDatabaseFont(font) {
  const cssStyles = (font.styles || [])
    .filter((style) => Number.isFinite(Number(style.weight)))
    .map((style) => ({ weight: Number(style.weight), italic: Boolean(style.italic), stretch: normalizeStretch(style.stretch) }));
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
  const expandedSignal = [font.family, ...googleTags].join(" ");
  const isExpanded = /\b(expanded|extended|wide)\b/i.test(expandedSignal)
    || axes.some((axis) => axis?.tag === "wdth" && Number(axis.max) > 100);
  if (isCondensed) derivedTags.push("condensed");
  if (isExpanded) derivedTags.push("expanded");

  return addFontId({
    family: font.family,
    designer: font.designer || "",
    category: font.category || "unknown",
    variable: Boolean(font.variable),
    isCondensed,
    isExpanded,
    subsets: [...new Set(font.subsets || [])],
    axes,
    tags: [...new Set([...derivedTags, ...googleTags].filter(Boolean))],
    styles: [...new Set(styles)],
    cssStyles,
    downloads,
    familyPageUrl: font.familyPageUrl || `https://fonts.google.com/specimen/${encodeURIComponent(font.family)}`,
    lastModified: font.lastModified || null
  });
}

function styleId(weight, italic) {
  return STYLE_DEFS.find((style) => style.weight === weight && style.italic === italic)?.id || null;
}

function normalizeStretch(value) {
  const allowed = ["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"];
  return allowed.includes(value) ? value : "normal";
}

function addFontId(font) {
  return { ...font, id: slugify(font.family) };
}

function collectTopTags(fonts, limit) {
  const counts = new Map();
  for (const font of fonts) for (const tag of font.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  const ordered = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .map(([tag]) => tag);
  return Number.isFinite(limit) ? ordered.slice(0, limit) : ordered;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    applyPortablePreferences(saved);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function localStateObject() {
  return {
    visibleStyles: [...state.visibleStyles],
    favorites: [...state.favorites],
    rareFonts: [...state.rareFonts],
    fontScope: state.fontScope,
    sortOrder: state.sortOrder,
    previewText: state.previewText,
    previewSize: state.previewSize,
    previewUnit: "pt",
    previewPpi: state.previewPpi,
    view: state.view,
    tagSort: state.tagSort,
    invertTagFilter: state.invertTagFilter,
    googleTagScale: state.googleTagScale,
    customTagScale: state.customTagScale,
    collapsedSections: [...state.collapsedSections],
    query: state.query,
    categories: [...state.categories],
    requiredStyles: [...state.requiredStyles],
    selectedSubsets: [...state.selectedSubsets],
    selectedTags: [...state.selectedTags],
    condensedOnly: state.condensedOnly,
    expandedOnly: state.expandedOnly,
    variableOnly: state.variableOnly,
    inspector: portableInspectorObject()
  };
}

function portableInspectorObject() {
  const source = state.inspector;
  const keys = ["activeLayer", "moveStep", "topFamily", "topStyle", "topX", "topY", "topSize", "topScale", "topOpacity", "topColor", "topBlend", "bottomFamily", "bottomStyle", "bottomX", "bottomY", "bottomSize", "bottomScale", "bottomOpacity", "bottomColor", "bottomBlend"];
  const output = Object.fromEntries(keys.map((key) => [key, source[key]]));
  output.bottomType = source.bottomType === "font" ? "font" : "none";
  return output;
}

function portablePreferencesObject() {
  return localStateObject();
}

function applyPortablePreferences(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const styleIds = new Set(STYLE_DEFS.map((style) => style.id));
  const visibleStyles = cleanStringArray(input.visibleStyles, STYLE_DEFS.length, 30).filter((id) => styleIds.has(id));
  if (visibleStyles.length) {
    const legacyAllSelected = visibleStyles.length === LEGACY_STYLE_IDS.size && visibleStyles.every((id) => LEGACY_STYLE_IDS.has(id));
    state.visibleStyles = new Set(legacyAllSelected ? STYLE_DEFS.map((style) => style.id) : visibleStyles);
  }
  state.favorites = new Set(cleanStringArray(input.favorites, 3000, 160));
  state.rareFonts = new Set(cleanStringArray(input.rareFonts, 3000, 160));
  state.categories = new Set(cleanStringArray(input.categories, 20, 60));
  state.requiredStyles = new Set(cleanStringArray(input.requiredStyles, STYLE_DEFS.length, 30).filter((id) => styleIds.has(id)));
  state.selectedSubsets = new Set(cleanStringArray(input.selectedSubsets, FILTERABLE_SUBSETS.length, 30).filter((subset) => FILTERABLE_SUBSETS.includes(subset)));
  state.selectedTags = new Set(cleanStringArray(input.selectedTags, 99, 60));
  state.fontScope = ["working", "all", "favorites", "rare", "marked"].includes(input.fontScope) ? input.fontScope : state.fontScope;
  state.sortOrder = ["alphabetical", "custom-tags", "condensed", "expanded", "favorites"].includes(input.sortOrder) ? input.sortOrder : state.sortOrder;
  state.previewText = typeof input.previewText === "string" ? input.previewText.slice(0, 160) : state.previewText;
  const savedSize = Number(input.previewSize);
  const sizeInPoints = input.previewUnit === "pt" || !input.previewUnit ? savedSize : Math.round(savedSize * 0.75);
  state.previewSize = clampNumber(sizeInPoints, 8, 72, state.previewSize);
  state.previewPpi = clampNumber(input.previewPpi, 72, 2400, state.previewPpi);
  state.view = ["table", "gallery", "matrix", "loupe", "inspector", "tags"].includes(input.view) ? input.view : state.view;
  state.tagSort = input.tagSort === "desc" ? "desc" : "asc";
  state.invertTagFilter = Boolean(input.invertTagFilter);
  const legacyTagScale = clampNumber(input.tagScale, 50, 200, 100);
  state.googleTagScale = clampNumber(input.googleTagScale, 50, 200, legacyTagScale);
  state.customTagScale = clampNumber(input.customTagScale, 50, 200, legacyTagScale);
  state.collapsedSections = new Set(cleanStringArray(input.collapsedSections, SIDEBAR_SECTION_IDS.length, 40).filter((id) => SIDEBAR_SECTION_IDS.includes(id)));
  state.query = typeof input.query === "string" ? input.query.slice(0, 160) : state.query;
  state.condensedOnly = Boolean(input.condensedOnly);
  state.expandedOnly = Boolean(input.expandedOnly);
  state.variableOnly = Boolean(input.variableOnly);
  applyPortableInspector(input.inspector);
}

function applyPortableInspector(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const numericLimits = {
    moveStep: [1, 10000], topX: [-100000, 100000], topY: [-100000, 100000], bottomX: [-100000, 100000], bottomY: [-100000, 100000],
    topSize: [6, 300], bottomSize: [6, 300], topScale: [10, 1000], bottomScale: [10, 1000], topOpacity: [0, 100], bottomOpacity: [0, 100]
  };
  for (const [key, [min, max]] of Object.entries(numericLimits)) state.inspector[key] = clampNumber(input[key], min, max, state.inspector[key]);
  for (const key of ["topFamily", "bottomFamily"]) if (typeof input[key] === "string") state.inspector[key] = input[key].slice(0, 160);
  for (const key of ["topStyle", "bottomStyle"]) if (STYLE_DEFS.some((style) => style.id === input[key])) state.inspector[key] = input[key];
  for (const key of ["topColor", "bottomColor"]) if (/^#[0-9a-f]{6}$/i.test(String(input[key] || ""))) state.inspector[key] = String(input[key]).toLowerCase();
  const blends = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"];
  for (const key of ["topBlend", "bottomBlend"]) if (blends.includes(input[key])) state.inspector[key] = input[key];
  state.inspector.activeLayer = input.activeLayer === "bottom" ? "bottom" : "top";
  state.inspector.bottomType = input.bottomType === "font" ? "font" : "none";
  state.inspector.imageUrl = "";
  state.inspector.imageName = "";
}

function cleanStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, limit).map((item) => item.slice(0, maxLength));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(localStateObject()));
  schedulePortableStateSave();
}

function schedulePortableStateSave() {
  if (!portableStateReady) return;
  clearTimeout(portableSaveTimer);
  portableSaveTimer = setTimeout(() => {
    saveTagsToCurrentStore().catch((error) => console.warn("uFont: не удалось сохранить переносимый профиль", error));
  }, 500);
}

function buildControls() {
  $("#categoryFilters").innerHTML = categories.map((category) => `
    <label class="check"><input type="checkbox" value="${escapeHtml(category)}"> ${escapeHtml(category)}</label>
  `).join("");
  $("#styleFilters").innerHTML = STYLE_DEFS.map((style) => `
    <label class="check"><input type="checkbox" value="${style.id}" ${state.visibleStyles.has(style.id) ? "checked" : ""}> ${escapeHtml(style.name)}</label>
  `).join("");
  $("#requiredStyleFilters").innerHTML = STYLE_DEFS.map((style) => `
    <label class="check"><input type="checkbox" value="${style.id}"> ${escapeHtml(style.name)}</label>
  `).join("");
  $("#subsetFilters").innerHTML = availableSubsets.map((subset) => `
    <label class="check"><input type="checkbox" value="${escapeHtml(subset)}"> ${escapeHtml(subset)}</label>
  `).join("") || `<span class="user-tags-empty">Нет дополнительных наборов.</span>`;
  $("#tagFilters").innerHTML = filterTags.map((tag) => `<button class="tag-button" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
  renderCustomTagFilters();
  previewInput.value = state.previewText;
  sizeRange.value = String(state.previewSize);
  ppiInput.value = String(state.previewPpi);
  $("#googleTagScale").value = String(state.googleTagScale);
  $("#customTagScale").value = String(state.customTagScale);
  applyTagScales();
  syncSidebarSections();
  document.querySelectorAll("#sortOrder option").forEach((option) => option.toggleAttribute("selected", option.value === state.sortOrder));
  updateSize();
  updateViewButtons();
}

function filteredFonts() {
  const query = state.query.trim().toLocaleLowerCase("ru");
  return FONTS.filter((font) => {
    const tags = allTags(font);
    const haystack = [font.family, font.designer, font.category, ...font.subsets, ...tags].join(" ").toLocaleLowerCase("ru");
    if (query && !haystack.includes(query)) return false;
    if (state.categories.size && !state.categories.has(font.category)) return false;
    if (state.requiredStyles.size && [...state.requiredStyles].some((style) => !font.styles.includes(style))) return false;
    if (state.selectedSubsets.size && [...state.selectedSubsets].some((subset) => !font.subsets.includes(subset))) return false;
    const hasEverySelectedTag = !state.selectedTags.size || [...state.selectedTags].every((tag) => tags.includes(tag));
    if (state.selectedTags.size && (state.invertTagFilter ? hasEverySelectedTag : !hasEverySelectedTag)) return false;
    if (state.condensedOnly && !font.isCondensed) return false;
    if (state.expandedOnly && !font.isExpanded) return false;
    if (state.variableOnly && !font.variable) return false;
    const isFavorite = state.favorites.has(font.family);
    const isRare = state.rareFonts.has(font.family);
    if (state.fontScope === "working" && isRare) return false;
    if (state.fontScope === "favorites" && !isFavorite) return false;
    if (state.fontScope === "rare" && !isRare) return false;
    if (state.fontScope === "marked" && !isFavorite && !isRare) return false;
    return true;
  }).sort(compareFonts);
}

function compareFonts(a, b) {
  const byName = () => a.family.localeCompare(b.family, "ru");
  if (state.sortOrder === "custom-tags") return customTagsFor(b).length - customTagsFor(a).length || byName();
  if (state.sortOrder === "condensed") return Number(b.isCondensed) - Number(a.isCondensed) || byName();
  if (state.sortOrder === "expanded") return Number(b.isExpanded) - Number(a.isExpanded) || byName();
  if (state.sortOrder === "favorites") return Number(state.favorites.has(b.family)) - Number(state.favorites.has(a.family)) || byName();
  return byName();
}

function render() {
  const fonts = filteredFonts();
  const visibleStyles = STYLE_DEFS.filter((style) => state.visibleStyles.has(style.id));
  $("#resultCount").textContent = `Найдено: ${fonts.length} из ${FONTS.length}`;
  $("#clearSearch").classList.toggle("is-hidden", !state.query);

  if (state.view === "tags") {
    renderTagManager();
    return;
  }

  if (!fonts.length) {
    catalog.innerHTML = `<div class="empty-state"><strong>Ничего не найдено</strong>Попробуйте убрать часть фильтров или изменить запрос.</div>`;
    return;
  }
  if (state.view === "inspector") {
    renderInspector(fonts);
    observeRenderedFonts();
    return;
  }
  if (state.view === "matrix") renderMatrix(fonts, visibleStyles);
  else if (state.view === "loupe") renderLoupe(fonts, visibleStyles);
  else if (state.view === "gallery") renderGallery(fonts, visibleStyles);
  else renderTable(fonts, visibleStyles);
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
      <div class="family-line"><div><div class="family-title">${rareButton(font)}<div class="family-name">${escapeHtml(font.family)}</div></div><div class="meta">${font.designer ? `${escapeHtml(font.designer)} · ` : ""}${escapeHtml(font.category)}${font.isCondensed ? " · Condensed" : ""}${font.isExpanded ? " · Expanded" : ""}${font.variable ? " · Variable" : ""}</div></div>${familyActions(font)}</div>
      <div class="sample" style="${fontStyle(font, styleForFont(font, [galleryStyle]))}">${escapeHtml(state.previewText || " ")}</div>
      <div class="style-pills">${STYLE_DEFS.filter((style) => font.styles.includes(style.id)).map((style) => `<span class="style-pill">${escapeHtml(style.name)}</span>`).join("")}</div>
      <a class="family-page-link" href="${escapeHtml(font.familyPageUrl)}" target="_blank" rel="noopener">Открыть в Google Fonts ↗</a>
      <div class="row-tags">${renderFontTags(font, 6)}</div>
    </article>`).join("")}</div>`;
}

function renderMatrix(fonts, visibleStyles) {
  const style = visibleStyles[0] || STYLE_DEFS.find((item) => item.id === "regular") || STYLE_DEFS[0];
  catalog.innerHTML = `<div class="matrix">${fonts.map((font) => `<article class="matrix-card" data-font-id="${escapeHtml(font.id)}">
    <div class="family-line"><div class="family-name">${escapeHtml(font.family)}</div>${familyActions(font)}</div>
    <div class="sample" style="${fontStyle(font, styleForFont(font, [style]))}">${escapeHtml(state.previewText || " ")}</div>
    <div class="row-tags">${renderFontTags(font, 2)}</div>
  </article>`).join("")}</div>`;
}

function renderLoupe(fonts, visibleStyles) {
  if (!fonts.some((font) => font.family === state.inspector.topFamily)) state.inspector.topFamily = fonts[0].family;
  const index = Math.max(0, fonts.findIndex((font) => font.family === state.inspector.topFamily));
  const font = fonts[index];
  const preferred = styleForFont(font, visibleStyles);
  catalog.innerHTML = `<article class="loupe-card" data-font-id="${escapeHtml(font.id)}">
    <div class="family-line"><div><div class="family-name">${escapeHtml(font.family)}</div><div class="meta">${font.designer ? `${escapeHtml(font.designer)} · ` : ""}${escapeHtml(font.category)} · ${index + 1} из ${fonts.length}</div></div>${familyActions(font)}</div>
    <div class="loupe-preview" style="${fontStyle(font, preferred)}">${escapeHtml(state.previewText || " ")}</div>
    <div class="row-tags">${renderFontTags(font, 6)}</div>
    <div class="loupe-nav"><button type="button" data-loupe-step="-1">← Предыдущий</button><strong>${escapeHtml(preferred.name)}</strong><button type="button" data-loupe-step="1">Следующий →</button></div>
  </article>`;
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
      <div class="inspector-font-nav" data-inspector-swipe-fonts><button type="button" data-inspector-action="previous-font">← Предыдущий</button><button type="button" data-inspector-action="next-font">Следующий →</button></div>
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
    <label for="inspector-bottom-source-font">Найти шрифт для нижнего слоя</label><input class="control" id="inspector-bottom-source-font" list="inspectorFonts" value="${inspector.bottomType === "font" ? escapeHtml(font.family) : ""}" data-inspector-font="bottom" placeholder="Начните вводить название…" autocomplete="off">
    <div class="inspector-control-row"><button class="inspector-action" type="button" data-inspector-action="bottom-from-top">Взять верхний шрифт</button><button class="inspector-action" type="button" data-inspector-action="upload-image">Загрузить изображение</button></div>
    <button class="inspector-action danger" type="button" data-inspector-action="clear-bottom">Удалить изображение / нижний слой</button></div>`;
  if (inspector.bottomType === "font") return `${sourceControls}<div class="inspector-control"><label for="inspector-bottom-style">Начертание</label><select class="control" id="inspector-bottom-style" data-inspector-setting="bottomStyle">${STYLE_DEFS.filter((style) => font.styles.includes(style.id)).map((style) => `<option value="${style.id}" ${style.id === inspector.bottomStyle ? "selected" : ""}>${escapeHtml(style.name)}</option>`).join("")}</select></div>${inspectorLayerControls("bottom", true)}`;
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
    <div class="inspector-control"><label>Масштаб, %</label><div class="inspector-scale-row"><button type="button" data-scale-change="-10" aria-label="Уменьшить масштаб">−</button><input class="inspector-number" type="number" min="10" max="1000" step="1" value="${inspector[`${prefix}Scale`]}" data-inspector-setting="${prefix}Scale"><button type="button" data-scale-change="10" aria-label="Увеличить масштаб">+</button></div></div>
    <div class="inspector-control"><label>Прозрачность, %</label><input type="range" min="0" max="100" step="1" value="${inspector[`${prefix}Opacity`]}" data-inspector-setting="${prefix}Opacity"><output>${inspector[`${prefix}Opacity`]}%</output></div>
    <div class="inspector-control"><label>Наложение</label><select class="control" data-inspector-setting="${prefix}Blend">${blendOptions.map((mode) => `<option value="${mode}" ${mode === inspector[`${prefix}Blend`] ? "selected" : ""}>${mode}</option>`).join("")}</select></div>
    <div class="inspector-control-row"><div class="inspector-control"><label>X, px</label><input class="inspector-number" type="number" step="1" value="${inspector[`${prefix}X`]}" data-inspector-setting="${prefix}X"></div><div class="inspector-control"><label>Y, px</label><input class="inspector-number" type="number" step="1" value="${inspector[`${prefix}Y`]}" data-inspector-setting="${prefix}Y"></div></div>
    <div class="inspector-control"><label>Шаг перемещения, px</label><input class="inspector-number" type="number" min="1" max="10000" step="1" value="${inspector.moveStep}" data-inspector-setting="moveStep"></div>
    <div class="inspector-arrows" aria-label="Точная настройка позиции"><button type="button" data-nudge="up">↑</button><button type="button" data-nudge="left">←</button><button type="button" data-nudge="down">↓</button><button type="button" data-nudge="right">→</button></div>`;
}

function inspectorLayerStyle(layer, font) {
  const inspector = state.inspector;
  const prefix = layer === "top" ? "top" : "bottom";
  const base = `transform:translate(${inspector[`${prefix}X`]}px,${inspector[`${prefix}Y`]}px) scale(${inspector[`${prefix}Scale`] / 100});opacity:${inspector[`${prefix}Opacity`] / 100};mix-blend-mode:${inspector[`${prefix}Blend`]}`;
  if (!font) return base;
  const style = STYLE_DEFS.find((item) => item.id === inspector[`${prefix}Style`]) || STYLE_DEFS[0];
  return `${base};font-family:&quot;${escapeHtml(font.family)}&quot;,${escapeHtml(font.category)};font-size:${inspector[`${prefix}Size`]}pt;font-weight:${style.weight};font-style:${style.italic ? "italic" : "normal"};font-stretch:${fontStretch(font, style)};color:${inspector[`${prefix}Color`]}`;
}

function renderNameCell(font) {
  return `<div class="font-name-cell"><div class="family-line"><div class="family-title">${rareButton(font)}<div class="family-name">${escapeHtml(font.family)}</div></div>${familyActions(font)}</div>
    <div class="meta">${font.designer ? `${escapeHtml(font.designer)}<br>` : ""}${escapeHtml(font.category)}${font.isCondensed ? " · Condensed" : ""}${font.isExpanded ? " · Expanded" : ""}${font.variable ? " · Variable" : ""}${font.lastModified ? `<br>Обновлён: ${escapeHtml(font.lastModified)}` : ""}</div>
    <a class="family-page-link" href="${escapeHtml(font.familyPageUrl)}" target="_blank" rel="noopener">Google Fonts ↗</a>
    <div class="row-tags">${renderFontTags(font, 5)}</div></div>`;
}

function familyActions(font) {
  const count = customTagsFor(font).length;
  return `<div class="family-actions"><button class="add-tag-button" type="button" data-edit-tags="${escapeHtml(font.family)}" aria-label="Изменить пользовательские теги; назначено ${count}">＋ теги${count ? ` · ${count}` : ""}</button>${favoriteButton(font)}</div>`;
}

function renderFontTags(font, limit) {
  const custom = customTagsFor(font).map((tag) => `<button class="mini-tag custom" type="button" data-tag="${escapeHtml(tag)}" title="Пользовательский тег" style="${tagColorStyle(tag)}">${escapeHtml(tag)}</button>`);
  const builtIn = font.tags.filter((tag) => !customTagsFor(font).includes(tag)).map(tagButton);
  return [...custom, ...builtIn.slice(0, limit)].join("");
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
  return [...new Set(tags.map((tag) => String(tag).trim().toLocaleLowerCase("ru")).filter(Boolean))].slice(0, 99);
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
  state.tagMeta = normalizeTagMeta(database?.tagMeta);
  applyPortablePreferences(database?.preferences);
  if (!state.tagStoreWritable) {
    try {
      const draft = JSON.parse(localStorage.getItem(TAG_DRAFT_STORAGE_KEY));
      state.customTags = mergeTagMaps(state.customTags, normalizeTagDatabase(draft?.families));
      state.tagMeta = mergeTagMeta(state.tagMeta, normalizeTagMeta(draft?.tagMeta));
      applyPortablePreferences(draft?.preferences);
    } catch {
      localStorage.removeItem(TAG_DRAFT_STORAGE_KEY);
    }
  }
  state.tagStoreUpdatedAt = database?.updatedAt || null;
  portableStateReady = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(localStateObject()));
  updateTagStoreStatus();
}

function updateTagStoreStatus() {
  const status = $("#tagStoreStatus");
  if (!status) return;
  status.textContent = state.tagStoreWritable
    ? "Синхронизация включена: теги, цвета и настройки записываются в data/user-tags.json."
    : "Статический режим: теги, цвета и настройки сохраняются как черновик в браузере. Экспортируйте JSON для переноса.";
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

function normalizeTagMeta(input) {
  const output = new Map();
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;
  for (const [inputTag, metadata] of Object.entries(input)) {
    const tag = sanitizeCustomTags([inputTag])[0];
    if (!tag) continue;
    const color = normalizeColor(metadata?.color);
    output.set(tag, { color });
  }
  return output;
}

function mergeTagMeta(base, incoming) {
  return new Map([...base, ...incoming]);
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : "#d9b83f";
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
    schemaVersion: 4,
    updatedAt: new Date().toISOString(),
    families: Object.fromEntries([...state.customTags].sort(([a], [b]) => a.localeCompare(b, "ru"))),
    tagMeta: Object.fromEntries([...state.tagMeta].sort(([a], [b]) => a.localeCompare(b, "ru"))),
    preferences: portablePreferencesObject()
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
    const incomingMeta = normalizeTagMeta(database?.tagMeta);
    const hasPreferences = database?.preferences && typeof database.preferences === "object" && !Array.isArray(database.preferences);
    if (!incoming.size && !incomingMeta.size && !hasPreferences) throw new Error("В файле нет тегов или переносимых настроек.");
    const before = countAssignedTags(state.customTags);
    state.customTags = mergeTagMaps(state.customTags, incoming);
    state.tagMeta = mergeTagMeta(state.tagMeta, incomingMeta);
    if (hasPreferences) applyPortablePreferences(database.preferences);
    const added = countAssignedTags(state.customTags) - before;
    await saveTagsToCurrentStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localStateObject()));
    renderCustomTagFilters();
    syncFilterUI();
    render();
    window.alert(`Импорт завершён. Добавлено связей «шрифт — тег»: ${added}. Теги, цвета и настройки профиля восстановлены; дубли пропущены.`);
  } catch (error) {
    window.alert(`Не удалось импортировать теги: ${error.message}`);
  }
}

function countAssignedTags(tagMap) {
  return [...tagMap.values()].reduce((total, tags) => total + tags.length, 0);
}

function renderCustomTagFilters() {
  const tags = allCustomTagNames().sort((a, b) => (state.tagSort === "desc" ? -1 : 1) * a.localeCompare(b, "ru"));
  $("#customTagFilters").innerHTML = tags.length
    ? tags.map((tag) => `<button class="tag-button custom" type="button" data-tag="${escapeHtml(tag)}" style="${tagColorStyle(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="user-tags-empty">Добавьте тег кнопкой «＋ тег» возле семейства.</span>`;
}

function allCustomTagNames() {
  return [...new Set([...state.customTags.values()].flat().concat([...state.tagMeta.keys()]))];
}

function tagColorStyle(tag) {
  const color = state.tagMeta.get(tag)?.color || "#d9b83f";
  return `--tag-color:${color};border-color:${color};background:${color};color:${readableTextColor(color)}`;
}

function readableTextColor(color) {
  const value = normalizeColor(color).slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#171816" : "#ffffff";
}

function renderTagManager() {
  const tags = allCustomTagNames().sort((a, b) => (state.tagSort === "desc" ? -1 : 1) * a.localeCompare(b, "ru"));
  $("#resultCount").textContent = `Пользовательских тегов: ${tags.length}`;
  catalog.innerHTML = `<div class="tag-manager"><section class="tag-manager-card">
    <div class="tag-manager-head"><div><div class="family-name">Управление пользовательскими тегами</div><div class="meta">Цвета, переименование и очистка сохраняются вместе с базой тегов.</div></div>
      <div class="tag-manager-actions"><button class="tag-manager-button" type="button" data-tag-manager-action="add">＋ Новый тег</button><button class="tag-manager-button danger" type="button" data-tag-manager-action="clear">Очистить все</button></div></div>
    <div class="tag-manager-list">${tags.length ? tags.map((tag) => {
      const count = [...state.customTags.values()].filter((items) => items.includes(tag)).length;
      const color = state.tagMeta.get(tag)?.color || "#d9b83f";
      return `<div class="tag-manager-row"><input type="color" value="${color}" data-tag-color="${escapeHtml(tag)}" aria-label="Цвет тега ${escapeHtml(tag)}"><span class="tag-button custom" style="${tagColorStyle(tag)}">${escapeHtml(tag)}</span><span class="tag-manager-count">${count} сем.</span><button class="tag-manager-button" type="button" data-tag-rename="${escapeHtml(tag)}">Переименовать</button><button class="tag-manager-button danger" type="button" data-tag-delete="${escapeHtml(tag)}">Удалить</button></div>`;
    }).join("") : `<div class="empty-state"><strong>Пока нет пользовательских тегов</strong>Создайте первый тег или добавьте его возле любого семейства.</div>`}</div>
  </section></div>`;
}

async function addManagedTag() {
  const answer = window.prompt("Название нового пользовательского тега:", "");
  if (answer === null) return;
  const tag = sanitizeCustomTags([answer])[0];
  if (!tag) return;
  if (!state.tagMeta.has(tag)) state.tagMeta.set(tag, { color: "#d9b83f" });
  await persistTagManagement();
}

async function renameManagedTag(oldTag) {
  const answer = window.prompt(`Новое название для тега «${oldTag}»:`, oldTag);
  if (answer === null) return;
  const newTag = sanitizeCustomTags([answer])[0];
  if (!newTag || newTag === oldTag) return;
  for (const [family, tags] of state.customTags) {
    if (!tags.includes(oldTag)) continue;
    state.customTags.set(family, sanitizeCustomTags(tags.map((tag) => tag === oldTag ? newTag : tag)));
  }
  const metadata = state.tagMeta.get(oldTag) || { color: "#d9b83f" };
  state.tagMeta.delete(oldTag);
  if (!state.tagMeta.has(newTag)) state.tagMeta.set(newTag, metadata);
  if (state.selectedTags.delete(oldTag)) state.selectedTags.add(newTag);
  await persistTagManagement();
}

async function deleteManagedTag(tag) {
  const confirmation = window.prompt(`Защита от случайного удаления. Чтобы удалить тег «${tag}» из всех семейств, введите его название:`, "");
  if (confirmation === null) return;
  if (confirmation.trim().toLocaleLowerCase("ru") !== tag.toLocaleLowerCase("ru")) {
    window.alert("Название не совпало. Тег не удалён.");
    return;
  }
  for (const [family, tags] of [...state.customTags]) {
    const next = tags.filter((item) => item !== tag);
    next.length ? state.customTags.set(family, next) : state.customTags.delete(family);
  }
  state.tagMeta.delete(tag);
  state.selectedTags.delete(tag);
  await persistTagManagement();
}

async function clearManagedTags() {
  const confirmation = window.prompt("Защита от случайного удаления. Чтобы удалить все пользовательские теги, цвета и связи со шрифтами, введите: УДАЛИТЬ ВСЕ", "");
  if (confirmation !== "УДАЛИТЬ ВСЕ") {
    if (confirmation !== null) window.alert("Контрольная фраза не совпала. База тегов сохранена без изменений.");
    return;
  }
  state.customTags.clear();
  state.tagMeta.clear();
  state.selectedTags.clear();
  await persistTagManagement();
}

async function persistTagManagement() {
  try {
    await saveTagsToCurrentStore();
    renderCustomTagFilters();
    syncFilterUI();
    render();
  } catch (error) {
    window.alert(`Не удалось сохранить теги: ${error.message}`);
  }
}

function editCustomTags(family) {
  tagEditorState.family = family;
  tagEditorState.selected = new Set(state.customTags.get(family) || []);
  tagEditorState.query = "";
  tagEditorState.pendingMeta = new Map();
  $("#tagEditorTitle").textContent = `Мои теги · ${family}`;
  $("#tagEditorSearch").value = "";
  $("#tagEditorNewName").value = "";
  renderTagEditorOptions();
  openTagEditorDialog();
  $("#tagEditorSearch").focus();
}

function renderTagEditorOptions() {
  const query = tagEditorState.query.trim().toLocaleLowerCase("ru");
  const tags = [...new Set([...allCustomTagNames(), ...tagEditorState.selected, ...tagEditorState.pendingMeta.keys()])]
    .filter((tag) => !query || tag.includes(query))
    .sort((a, b) => a.localeCompare(b, "ru"));
  $("#tagEditorSummary").textContent = `Выбрано ${tagEditorState.selected.size} из 99. Каждый флажок — независимая связь со шрифтом.`;
  $("#tagEditorOptions").innerHTML = tags.length ? tags.map((tag) => {
    const color = tagEditorState.pendingMeta.get(tag)?.color || state.tagMeta.get(tag)?.color || "#d9b83f";
    const selected = tagEditorState.selected.has(tag);
    return `<label class="tag-editor-option ${selected ? "selected" : ""}" style="--tag-color:${color}"><input type="checkbox" value="${escapeHtml(tag)}" ${selected ? "checked" : ""}><span>${escapeHtml(tag)}</span></label>`;
  }).join("") : `<div class="tag-editor-empty">Пока нет тегов. Создайте первый тег справа от поиска.</div>`;
}

function addTagInEditor() {
  const tag = sanitizeCustomTags([$("#tagEditorNewName").value])[0];
  if (!tag) { $("#tagEditorNewName").focus(); return; }
  if (!tagEditorState.selected.has(tag) && tagEditorState.selected.size >= 99) {
    window.alert("На одно семейство можно назначить не более 99 тегов.");
    return;
  }
  tagEditorState.pendingMeta.set(tag, { color: normalizeColor($("#tagEditorNewColor").value) });
  tagEditorState.selected.add(tag);
  tagEditorState.query = "";
  $("#tagEditorSearch").value = "";
  $("#tagEditorNewName").value = "";
  renderTagEditorOptions();
}

async function saveTagEditor() {
  const family = tagEditorState.family;
  if (!family) return;
  const current = [...(state.customTags.get(family) || [])];
  const previousMeta = new Map(state.tagMeta);
  const tags = sanitizeCustomTags([...tagEditorState.selected]);
  tags.length ? state.customTags.set(family, tags) : state.customTags.delete(family);
  for (const tag of tags) {
    const metadata = tagEditorState.pendingMeta.get(tag) || state.tagMeta.get(tag) || { color: "#d9b83f" };
    state.tagMeta.set(tag, metadata);
  }
  try {
    await saveTagsToCurrentStore();
  } catch (error) {
    current.length ? state.customTags.set(family, current) : state.customTags.delete(family);
    state.tagMeta = previousMeta;
    window.alert(`Не удалось записать базу тегов: ${error.message}`);
    return;
  }
  closeTagEditorDialog();
  const availableTags = new Set([...state.customTags.values()].flat());
  state.selectedTags = new Set([...state.selectedTags].filter((tag) => filterTags.includes(tag) || availableTags.has(tag)));
  renderCustomTagFilters();
  syncFilterUI();
  render();
}

function openTagEditorDialog() {
  const editor = $("#tagEditor");
  if (typeof editor.showModal === "function") editor.showModal();
  else { editor.setAttribute("open", ""); editor.classList.add("fallback-open"); }
}

function closeTagEditorDialog() {
  const editor = $("#tagEditor");
  if (typeof editor.close === "function") editor.close();
  else { editor.removeAttribute("open"); editor.classList.remove("fallback-open"); }
}

function favoriteButton(font) {
  const active = state.favorites.has(font.family);
  return `<button class="favorite ${active ? "active" : ""}" type="button" data-favorite="${escapeHtml(font.family)}" aria-label="${active ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${active}">${active ? "★" : "☆"}</button>`;
}

function rareButton(font) {
  const active = state.rareFonts.has(font.family);
  return `<button class="rare-toggle ${active ? "active" : ""}" type="button" data-rare="${escapeHtml(font.family)}" aria-label="${active ? "Убрать отметку редкого шрифта" : "Пометить как редкий и скрывать из рабочего списка"}" aria-pressed="${active}" title="${active ? "Редкий / скрытый" : "Пометить как редкий"}">${active ? "⊗" : "⊘"}</button>`;
}

function renderFontCell(font, style) {
  if (!font.styles.includes(style.id)) return `<div class="font-cell"><div class="style-top"><div class="style-label">Нет начертания</div></div><div class="missing">—</div></div>`;
  const download = font.downloads[style.id];
  return `<div class="font-cell"><div class="style-top"><div class="style-label">${style.weight} · ${style.italic ? "курсив" : "прямое"}</div>
    ${download ? `<button class="download-link" type="button" data-download-url="${escapeHtml(download.url)}" data-download-name="${escapeHtml(download.fileName)}">↓ TTF</button>` : ""}</div>
    <div class="sample" style="${fontStyle(font, style)}">${escapeHtml(state.previewText || " ")}</div></div>`;
}

function fontStyle(font, style) {
  return `font-family:&quot;${escapeHtml(font.family)}&quot;,${escapeHtml(font.category)};font-weight:${style.weight};font-style:${style.italic ? "italic" : "normal"};font-stretch:${fontStretch(font, style)}`;
}

function styleForFont(font, preferredStyles = []) {
  return preferredStyles.find((style) => font.styles.includes(style.id)) || STYLE_DEFS.find((style) => font.styles.includes(style.id)) || STYLE_DEFS[0];
}

function fontStretch(font, style) {
  return font.cssStyles.find((item) => item.weight === style.weight && item.italic === style.italic)?.stretch || (font.isCondensed ? "condensed" : font.isExpanded ? "expanded" : "normal");
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

function configureEnvironmentLink() {
  const link = $("#environmentLink");
  if (!link) return;
  const onGitHubPages = location.hostname?.toLowerCase().endsWith("github.io");
  link.href = onGitHubPages ? "http://localhost:4173/" : "https://sunpole.github.io/uFont/";
  link.textContent = onGitHubPages ? "Локально ↗" : "GitHub Pages ↗";
}

function applyTagScales() {
  document.documentElement.style.setProperty("--google-tag-scale", String(state.googleTagScale / 100));
  document.documentElement.style.setProperty("--custom-tag-scale", String(state.customTagScale / 100));
  $("#googleTagScaleOutput").value = `${state.googleTagScale}%`;
  $("#customTagScaleOutput").value = `${state.customTagScale}%`;
}

function syncSidebarSections() {
  document.querySelectorAll("[data-sidebar-section]").forEach((section) => {
    const id = section.dataset.sidebarSection;
    const collapsed = state.collapsedSections.has(id);
    section.classList.toggle("collapsed", collapsed);
    const button = section.querySelector(`[data-toggle-section="${id}"]`);
    if (!button) return;
    const title = section.querySelector(".section-title > span")?.textContent || "";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Развернуть" : "Свернуть"} раздел ${title}`.trim());
    button.title = collapsed ? "Развернуть раздел" : "Свернуть раздел";
    button.textContent = collapsed ? "◉" : "👁";
  });
}

function updateViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
}

function syncFilterUI() {
  document.querySelectorAll("#categoryFilters input").forEach((input) => { input.checked = state.categories.has(input.value); });
  document.querySelectorAll("#styleFilters input").forEach((input) => { input.checked = state.visibleStyles.has(input.value); });
  document.querySelectorAll("#tagFilters [data-tag]").forEach((button) => button.classList.toggle("active", state.selectedTags.has(button.dataset.tag)));
  document.querySelectorAll("#customTagFilters [data-tag]").forEach((button) => button.classList.toggle("active", state.selectedTags.has(button.dataset.tag)));
  document.querySelectorAll("#requiredStyleFilters input").forEach((input) => { input.checked = state.requiredStyles.has(input.value); });
  document.querySelectorAll("#subsetFilters input").forEach((input) => { input.checked = state.selectedSubsets.has(input.value); });
  const requiredNames = STYLE_DEFS.filter((style) => state.requiredStyles.has(style.id)).map((style) => style.name);
  $("#requiredStylesSummary").textContent = requiredNames.length ? requiredNames.join(" + ") : "Любые начертания";
  $("#subsetSummary").textContent = state.selectedSubsets.size ? [...state.selectedSubsets].join(" + ") : "Любая дополнительная письменность";
  $("#condensedOnly").checked = state.condensedOnly;
  $("#expandedOnly").checked = state.expandedOnly;
  $("#variableOnly").checked = state.variableOnly;
  document.querySelectorAll("#fontScope option").forEach((option) => option.toggleAttribute("selected", option.value === state.fontScope));
  document.querySelectorAll("#sortOrder option").forEach((option) => option.toggleAttribute("selected", option.value === state.sortOrder));
  document.querySelectorAll("#customTagSort option").forEach((option) => option.toggleAttribute("selected", option.value === state.tagSort));
  $("#invertTagFilter").classList.toggle("active", state.invertTagFilter);
  $("#invertTagFilter").setAttribute("aria-pressed", String(state.invertTagFilter));
  $("#invertTagFilter").textContent = state.invertTagFilter ? "Инверсия: вкл." : "Инверсия: выкл.";
  $("#googleTagScale").value = String(state.googleTagScale);
  $("#customTagScale").value = String(state.customTagScale);
  applyTagScales();
  syncSidebarSections();
  searchInput.value = state.query;
}

function resetFilters() {
  state.query = "";
  state.categories.clear();
  state.visibleStyles = new Set(STYLE_DEFS.map((style) => style.id));
  state.requiredStyles.clear();
  state.selectedSubsets.clear();
  state.selectedTags.clear();
  state.condensedOnly = false;
  state.expandedOnly = false;
  state.variableOnly = false;
  state.fontScope = "working";
  state.invertTagFilter = false;
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
  searchInput.addEventListener("input", (event) => { state.query = event.target.value; saveState(); render(); });
  $("#clearSearch").addEventListener("click", () => { state.query = ""; searchInput.value = ""; searchInput.focus(); saveState(); render(); });
  previewInput.addEventListener("input", (event) => { state.previewText = event.target.value; saveState(); render(); });
  sizeRange.addEventListener("input", () => { updateSize(); saveState(); });
  ppiInput.addEventListener("input", () => { updateSize(); saveState(); });
  ppiInput.addEventListener("change", () => { ppiInput.value = String(state.previewPpi); });
  $("#categoryFilters").addEventListener("change", (event) => { event.target.checked ? state.categories.add(event.target.value) : state.categories.delete(event.target.value); saveState(); render(); });
  $("#styleFilters").addEventListener("change", (event) => { event.target.checked ? state.visibleStyles.add(event.target.value) : state.visibleStyles.delete(event.target.value); saveState(); render(); });
  $("#requiredStyleFilters").addEventListener("change", (event) => {
    event.target.checked ? state.requiredStyles.add(event.target.value) : state.requiredStyles.delete(event.target.value);
    if (event.target.checked) state.visibleStyles.add(event.target.value);
    syncFilterUI(); saveState(); render();
  });
  $("#subsetFilters").addEventListener("change", (event) => { event.target.checked ? state.selectedSubsets.add(event.target.value) : state.selectedSubsets.delete(event.target.value); syncFilterUI(); saveState(); render(); });
  $("#condensedOnly").addEventListener("change", (event) => { state.condensedOnly = event.target.checked; saveState(); render(); });
  $("#expandedOnly").addEventListener("change", (event) => { state.expandedOnly = event.target.checked; saveState(); render(); });
  $("#variableOnly").addEventListener("change", (event) => { state.variableOnly = event.target.checked; saveState(); render(); });
  $("#fontScope").addEventListener("change", (event) => { state.fontScope = event.target.value; saveState(); render(); });
  $("#tagFilters").addEventListener("click", (event) => toggleTag(event.target.closest("[data-tag]")?.dataset.tag));
  $("#customTagFilters").addEventListener("click", (event) => toggleTag(event.target.closest("[data-tag]")?.dataset.tag));
  $("#customTagSort").addEventListener("change", (event) => { state.tagSort = event.target.value === "desc" ? "desc" : "asc"; renderCustomTagFilters(); saveState(); if (state.view === "tags") render(); });
  $("#invertTagFilter").addEventListener("click", () => { state.invertTagFilter = !state.invertTagFilter; syncFilterUI(); saveState(); render(); });
  $("#googleTagScale").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.googleTagScale = Math.abs(value - 100) <= 5 ? 100 : value;
    event.target.value = String(state.googleTagScale);
    applyTagScales(); saveState();
  });
  $("#customTagScale").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.customTagScale = Math.abs(value - 100) <= 5 ? 100 : value;
    event.target.value = String(state.customTagScale);
    applyTagScales(); saveState();
  });
  $("#tagEditorSearch").addEventListener("input", (event) => { tagEditorState.query = event.target.value.toLocaleLowerCase("ru"); renderTagEditorOptions(); });
  $("#tagEditorOptions").addEventListener("change", (event) => {
    if (event.target.type !== "checkbox") return;
    if (event.target.checked && tagEditorState.selected.size >= 99) { event.target.checked = false; window.alert("На одно семейство можно назначить не более 99 тегов."); return; }
    event.target.checked ? tagEditorState.selected.add(event.target.value) : tagEditorState.selected.delete(event.target.value);
    renderTagEditorOptions();
  });
  $("#tagEditorAdd").addEventListener("click", addTagInEditor);
  $("#tagEditorNewName").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addTagInEditor(); } });
  $("#tagEditorForm").addEventListener("submit", async (event) => { event.preventDefault(); await saveTagEditor(); });
  document.querySelectorAll("[data-tag-editor-close]").forEach((button) => button.addEventListener("click", closeTagEditorDialog));
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
  catalog.addEventListener("touchstart", handleInspectorFontTouchStart, { passive: true });
  catalog.addEventListener("touchend", handleInspectorFontTouchEnd, { passive: true });
  document.addEventListener("pointermove", moveInspectorDrag);
  document.addEventListener("pointerup", endInspectorDrag);

  document.addEventListener("click", (event) => {
    const sectionToggle = event.target.closest("[data-toggle-section]");
    if (sectionToggle) {
      const id = sectionToggle.dataset.toggleSection;
      if (!SIDEBAR_SECTION_IDS.includes(id)) return;
      state.collapsedSections.has(id) ? state.collapsedSections.delete(id) : state.collapsedSections.add(id);
      syncSidebarSections();
      saveState();
      return;
    }
    const download = event.target.closest("[data-download-url]");
    if (download) { downloadFont(download); return; }
    const editTags = event.target.closest("[data-edit-tags]");
    if (editTags) { editCustomTags(editTags.dataset.editTags); return; }
    const addTag = event.target.closest("[data-tag-manager-action='add']");
    if (addTag) { addManagedTag(); return; }
    const clearTags = event.target.closest("[data-tag-manager-action='clear']");
    if (clearTags) { clearManagedTags(); return; }
    const renameTag = event.target.closest("[data-tag-rename]");
    if (renameTag) { renameManagedTag(renameTag.dataset.tagRename); return; }
    const deleteTag = event.target.closest("[data-tag-delete]");
    if (deleteTag) { deleteManagedTag(deleteTag.dataset.tagDelete); return; }
    const inspectorLayer = event.target.closest("[data-inspector-select-layer]");
    if (inspectorLayer) { state.inspector.activeLayer = inspectorLayer.dataset.inspectorSelectLayer; saveState(); render(); return; }
    const inspectorAction = event.target.closest("[data-inspector-action]");
    if (inspectorAction) { handleInspectorAction(inspectorAction.dataset.inspectorAction); return; }
    const nudge = event.target.closest("[data-nudge]");
    if (nudge) { nudgeInspectorLayer(nudge.dataset.nudge, state.inspector.moveStep * (event.shiftKey ? 10 : 1)); return; }
    const scaleChange = event.target.closest("[data-scale-change]");
    if (scaleChange) { changeInspectorScale(Number(scaleChange.dataset.scaleChange)); return; }
    const loupeStep = event.target.closest("[data-loupe-step]");
    if (loupeStep) { cycleInspectorFont(Number(loupeStep.dataset.loupeStep)); return; }
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      const family = favorite.dataset.favorite;
      if (state.favorites.has(family)) state.favorites.delete(family);
      else { state.favorites.add(family); state.rareFonts.delete(family); }
      saveState(); render(); return;
    }
    const rare = event.target.closest("[data-rare]");
    if (rare) {
      const family = rare.dataset.rare;
      if (state.rareFonts.has(family)) state.rareFonts.delete(family);
      else { state.rareFonts.add(family); state.favorites.delete(family); }
      saveState(); render(); return;
    }
    const miniTag = event.target.closest(".mini-tag[data-tag]");
    if (miniTag) { toggleTag(miniTag.dataset.tag, true); return; }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { state.view = viewButton.dataset.view; updateViewButtons(); saveState(); render(); return; }
    const clearButton = event.target.closest("[data-clear]");
    if (clearButton?.dataset.clear === "categories") state.categories.clear();
    if (clearButton?.dataset.clear === "tags") {
      const googleTags = new Set(filterTags);
      state.selectedTags = new Set([...state.selectedTags].filter((tag) => !googleTags.has(tag)));
    }
    if (clearButton?.dataset.clear === "custom-tags") {
      const customTags = new Set(allCustomTagNames());
      state.selectedTags = new Set([...state.selectedTags].filter((tag) => !customTags.has(tag)));
    }
    if (clearButton) { syncFilterUI(); saveState(); render(); return; }
    if (event.target.closest("[data-action='all-styles']")) {
      state.visibleStyles = new Set(STYLE_DEFS.map((style) => style.id));
      syncFilterUI(); saveState(); render();
    }
    if (event.target.closest("[data-action='clear-required-styles']")) {
      state.requiredStyles.clear();
      syncFilterUI(); saveState(); render();
    }
    if (event.target.closest("[data-action='clear-subsets']")) {
      state.selectedSubsets.clear();
      syncFilterUI(); saveState(); render();
    }
  });

  document.addEventListener("change", (event) => {
    const tag = event.target.dataset.tagColor;
    if (!tag) return;
    state.tagMeta.set(tag, { color: normalizeColor(event.target.value) });
    persistTagManagement();
  });
}

function handleInspectorWheel(event) {
  if (state.view !== "inspector" || !event.target.closest("#inspectorStage")) return;
  event.preventDefault();
  const now = Date.now();
  if (now - lastInspectorWheelAt < 80) return;
  lastInspectorWheelAt = now;
  cycleInspectorFont(event.deltaY > 0 ? 1 : -1);
}

function cycleInspectorFont(direction) {
  const pool = filteredFonts();
  if (!pool.length) return;
  const currentIndex = Math.max(0, pool.findIndex((font) => font.family === state.inspector.topFamily));
  const next = pool[(currentIndex + direction + pool.length) % pool.length];
  state.inspector.topFamily = next.family;
  if (!next.styles.includes(state.inspector.topStyle)) state.inspector.topStyle = next.styles[0] || "regular";
  saveState();
  render();
}

function handleInspectorFontTouchStart(event) {
  if (!event.target.closest("[data-inspector-swipe-fonts]")) return;
  inspectorTouchStartX = event.changedTouches?.[0]?.clientX ?? null;
}

function handleInspectorFontTouchEnd(event) {
  if (inspectorTouchStartX === null || !event.target.closest("[data-inspector-swipe-fonts]")) return;
  const endX = event.changedTouches?.[0]?.clientX;
  if (Number.isFinite(endX) && Math.abs(endX - inspectorTouchStartX) >= 40) {
    cycleInspectorFont(endX < inspectorTouchStartX ? 1 : -1);
    inspectorSuppressClickUntil = Date.now() + 400;
  }
  inspectorTouchStartX = null;
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
  saveState();
  render();
}

function handleInspectorSettingInput(event) {
  const key = event.target.dataset.inspectorSetting;
  if (!key) return;
  const numeric = /(?:X|Y|Size|Scale|Opacity)$/.test(key);
  state.inspector[key] = numeric ? Number(event.target.value) : event.target.value;
  if (key === "moveStep") {
    state.inspector.moveStep = Math.min(10000, Math.max(1, Math.round(Number(event.target.value) || 1)));
    saveState();
    return;
  }
  if (key.endsWith("Scale")) state.inspector[key] = Math.min(1000, Math.max(10, Number(event.target.value) || 100));
  const layer = key.startsWith("top") ? "top" : "bottom";
  applyInspectorLayerStyle(layer);
  if (key.endsWith("Opacity") && event.target.nextElementSibling) event.target.nextElementSibling.textContent = `${event.target.value}%`;
  saveState();
}

function handleInspectorChange(event) {
  const fontLayer = event.target.dataset.inspectorFont;
  if (fontLayer) {
    const family = canonicalFamilyName(event.target.value);
    const font = FONTS.find((item) => item.family === family);
    if (!font) { render(); return; }
    if (fontLayer === "bottom") {
      if (state.inspector.imageUrl) URL.revokeObjectURL(state.inspector.imageUrl);
      state.inspector.imageUrl = "";
      state.inspector.imageName = "";
      state.inspector.bottomType = "font";
      state.inspector.activeLayer = "bottom";
    }
    state.inspector[`${fontLayer}Family`] = font.family;
    if (!font.styles.includes(state.inspector[`${fontLayer}Style`])) state.inspector[`${fontLayer}Style`] = font.styles[0] || "regular";
    saveState();
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
    saveState();
    render();
    return;
  }
  if (event.target.dataset.inspectorSetting) { saveState(); render(); }
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
  if (action === "previous-font") { if (Date.now() >= inspectorSuppressClickUntil) cycleInspectorFont(-1); return; }
  if (action === "next-font") { if (Date.now() >= inspectorSuppressClickUntil) cycleInspectorFont(1); return; }
  if (action === "bottom-from-top") {
    state.inspector.bottomType = "font";
    state.inspector.bottomFamily = state.inspector.topFamily;
    state.inspector.bottomStyle = state.inspector.topStyle;
    state.inspector.bottomSize = state.inspector.topSize;
    state.inspector.bottomScale = state.inspector.topScale;
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
  if (action !== "upload-image") { saveState(); render(); }
}

function nudgeInspectorLayer(direction, amount) {
  const prefix = state.inspector.activeLayer === "top" ? "top" : "bottom";
  if (direction === "left") state.inspector[`${prefix}X`] -= amount;
  if (direction === "right") state.inspector[`${prefix}X`] += amount;
  if (direction === "up") state.inspector[`${prefix}Y`] -= amount;
  if (direction === "down") state.inspector[`${prefix}Y`] += amount;
  saveState();
  render();
}

function changeInspectorScale(delta) {
  const prefix = state.inspector.activeLayer === "top" ? "top" : "bottom";
  const key = `${prefix}Scale`;
  state.inspector[key] = Math.min(1000, Math.max(10, state.inspector[key] + delta));
  saveState();
  render();
}

function toggleTag(tag, forceOn = false) {
  if (!tag) return;
  if (forceOn) state.selectedTags.add(tag);
  else state.selectedTags.has(tag) ? state.selectedTags.delete(tag) : state.selectedTags.add(tag);
  syncFilterUI();
  saveState();
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
