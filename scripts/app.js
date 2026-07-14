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
  view: "table"
};

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
    state.view = saved.view === "gallery" ? "gallery" : "table";
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

  state.customTags = new Map(Object.entries(database?.families || {})
    .map(([family, tags]) => [family, sanitizeCustomTags(tags)])
    .filter(([, tags]) => tags.length));
  state.tagStoreUpdatedAt = database?.updatedAt || null;
  updateTagStoreStatus();
}

function updateTagStoreStatus() {
  const status = $("#tagStoreStatus");
  if (!status) return;
  status.textContent = state.tagStoreWritable
    ? "Редактирование включено: изменения записываются в data/user-tags.json."
    : "Общая база открыта для чтения. Для редактирования запустите npm start локально.";
}

function renderCustomTagFilters() {
  const tags = [...new Set([...state.customTags.values()].flat())].sort((a, b) => a.localeCompare(b, "ru"));
  $("#customTagFilters").innerHTML = tags.length
    ? tags.map((tag) => `<button class="tag-button custom" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="user-tags-empty">Добавьте тег кнопкой «＋ тег» возле семейства.</span>`;
}

async function editCustomTags(family) {
  if (!state.tagStoreWritable) {
    window.alert("На GitHub Pages теги доступны только для чтения. Запустите проект локально командой npm start, измените теги и отправьте data/user-tags.json в GitHub.");
    return;
  }
  const current = state.customTags.get(family) || [];
  const answer = window.prompt(`Мои теги для ${family}\nВведите через запятую. Чтобы удалить все — оставьте поле пустым.`, current.join(", "));
  if (answer === null) return;
  const tags = sanitizeCustomTags(answer.split(","));
  tags.length ? state.customTags.set(family, tags) : state.customTags.delete(family);
  try {
    const response = await fetch("api/user-tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, families: Object.fromEntries(state.customTags) })
    });
    if (!response.ok) throw new Error(String(response.status));
    const saved = await response.json();
    state.tagStoreUpdatedAt = saved.updatedAt || null;
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
  $("#sortOrder").addEventListener("change", (event) => { state.sortOrder = event.target.value; saveState(); render(); });
  $("#resetButton").addEventListener("click", resetFilters);

  document.addEventListener("click", (event) => {
    const download = event.target.closest("[data-download-url]");
    if (download) { downloadFont(download); return; }
    const editTags = event.target.closest("[data-edit-tags]");
    if (editTags) { editCustomTags(editTags.dataset.editTags); return; }
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
