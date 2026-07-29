import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownFiles = [];
const excludedDirectories = new Set([".git", "node_modules", "aionui-v2.1.41"]);

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
    } else if (entry.name.endsWith(".md")) {
      markdownFiles.push(absolutePath);
    }
  }
}

function normalizeTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }

  if (/^(https?:|mailto:|#)/u.test(target)) {
    return null;
  }

  target = target.split("#", 1)[0].split("?", 1)[0];
  return target ? decodeURIComponent(target) : null;
}

walk(root);

const failures = [];
const inlineLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
const referenceLinkPattern = /^\s*\[[^\]]+\]:\s*(\S+)/gmu;

for (const markdownFile of markdownFiles) {
  const contents = fs.readFileSync(markdownFile, "utf8");
  const targets = [];

  for (const pattern of [inlineLinkPattern, referenceLinkPattern]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(contents)) !== null) {
      targets.push(match[1]);
    }
  }

  for (const rawTarget of targets) {
    const target = normalizeTarget(rawTarget);
    if (!target) {
      continue;
    }

    const resolved = path.resolve(path.dirname(markdownFile), target);
    if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(root, markdownFile)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Broken relative documentation links:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Checked ${markdownFiles.length} Markdown files; all relative links resolve.`);
