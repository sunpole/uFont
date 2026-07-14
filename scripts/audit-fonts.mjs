import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve("data", "fonts-cyrillic.json");
const database = JSON.parse(await readFile(file, "utf8"));
const families = Array.isArray(database.families) ? database.families : [];
const familyNames = families.map((font) => String(font.family || "").trim()).filter(Boolean);
const uniqueFamilies = new Set(familyNames.map((name) => name.toLocaleLowerCase("en")));
const duplicateFamilies = familyNames.length - uniqueFamilies.size;
const styles = families.reduce((total, font) => total + (Array.isArray(font.styles) ? font.styles.length : 0), 0);
const variableFamilies = families.filter((font) => font.variable).length;
const designerFamilies = families.filter((font) => String(font.designer || "").trim()).length;
const validStretches = new Set(["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"]);
const invalidStretches = families.flatMap((font) => (font.styles || []).filter((style) => !validStretches.has(style.stretch || "normal")).map((style) => `${font.family}:${style.id || style.name}`));
const invalidCyrillic = families.filter((font) => !font.subsets?.includes("cyrillic") && !font.subsets?.includes("cyrillic-ext"));
const duplicateStyles = families.reduce((total, font) => {
  const ids = (font.styles || []).map((style) => `${style.weight}:${Boolean(style.italic)}`);
  return total + ids.length - new Set(ids).size;
}, 0);

console.log("uFont: аудит базы Google Fonts");
console.log(`Снимок создан: ${database.generatedAt || "дата отсутствует"}`);
console.log(`Всего семейств в ответе Google API: ${database.counts?.allGoogleFamilies ?? "нет данных"}`);
console.log(`Кириллических семейств: ${families.length}`);
console.log(`Уникальных названий: ${uniqueFamilies.size}`);
console.log(`Статических начертаний/файлов: ${styles}`);
console.log(`Variable-семейств: ${variableFamilies}`);
console.log(`Семейств с указанным дизайнером: ${designerFamilies}`);
console.log(`Начертаний с некорректной шириной: ${invalidStretches.length}`);
console.log(`Дубли семейств: ${duplicateFamilies}`);
console.log(`Дубли начертаний внутри семейств: ${duplicateStyles}`);
console.log(`Семейства без cyrillic/cyrillic-ext: ${invalidCyrillic.length}`);

const reportedCount = Number(database.counts?.cyrillicFamilies);
const errors = [];
if (!families.length) errors.push("массив families пуст");
if (duplicateFamilies) errors.push(`найдено дублей семейств: ${duplicateFamilies}`);
if (duplicateStyles) errors.push(`найдено дублей начертаний: ${duplicateStyles}`);
if (invalidCyrillic.length) errors.push(`неверно включённых семейств: ${invalidCyrillic.length}`);
if (invalidStretches.length) errors.push(`некорректных значений stretch: ${invalidStretches.length}`);
if (Number.isFinite(reportedCount) && reportedCount !== families.length) errors.push(`counts.cyrillicFamilies=${reportedCount}, фактически=${families.length}`);

if (errors.length) {
  console.error(`uFont: аудит не пройден — ${errors.join("; ")}`);
  process.exit(1);
}

console.log("uFont: аудит пройден, структура и уникальность базы корректны.");
