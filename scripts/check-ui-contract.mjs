import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [html, app, server] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "scripts", "app.js"), "utf8"),
  readFile(resolve(root, "scripts", "serve.mjs"), "utf8")
]);

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const appIdReferences = [...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(appIdReferences.filter((id) => !htmlIds.has(id)))];
assert(!missingIds.length, `В HTML отсутствуют элементы: ${missingIds.join(", ")}`);

const requiredStyles = [
  "thin", "thin-italic", "extralight", "extralight-italic", "light", "light-italic",
  "regular", "italic", "medium", "medium-italic", "semibold", "semibold-italic",
  "bold", "bold-italic", "extrabold", "extrabold-italic", "black", "black-italic"
];
for (const id of requiredStyles) assert(app.includes(`id: "${id}"`), `Не найдено начертание ${id}`);

assert(html.includes('id="tagEditor"'), "Нет редактора пересечения пользовательских тегов");
assert(html.includes('id="googleTagScale"') && html.includes('id="customTagScale"'), "Масштабы тегов не разделены");
assert(app.includes("tagEditorState.selected.add(tag)"), "Новый тег не добавляется к текущему пересечению");
assert(app.includes("return [...custom, ...builtIn.slice(0, limit)].join"), "Пользовательские теги всё ещё могут обрезаться лимитом карточки");
assert(server.includes("slice(0, 99)"), "Сервер не сохраняет до 99 тегов на семейство");

console.log(`uFont: UI-контракт пройден — ${requiredStyles.length} начертаний, редактор пересечения и два масштаба тегов.`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
