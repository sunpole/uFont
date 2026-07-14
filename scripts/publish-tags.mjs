import { execFileSync } from "node:child_process";

const TAGS_FILE = "data/user-tags.json";

try {
  const branch = git(["branch", "--show-current"]).trim();
  if (branch !== "main") throw new Error(`Переключитесь на main. Текущая ветка: ${branch || "не определена"}`);

  git(["add", "--", TAGS_FILE], true);
  const changed = gitStatus(["diff", "--cached", "--quiet", "--", TAGS_FILE]) !== 0;
  if (!changed) {
    console.log("uFont: база пользовательских тегов не менялась.");
    process.exit(0);
  }

  git(["commit", "-m", "Update user font tags", "--", TAGS_FILE], true);
  git(["push", "origin", "main"], true);
  console.log("uFont: пользовательские теги опубликованы. GitHub Pages обновится автоматически.");
} catch (error) {
  console.error(`uFont: ${error.message}`);
  process.exit(1);
}

function git(args, inherit = false) {
  return execFileSync("git", args, { encoding: "utf8", stdio: inherit ? "inherit" : "pipe" }) || "";
}

function gitStatus(args) {
  try {
    git(args);
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}
