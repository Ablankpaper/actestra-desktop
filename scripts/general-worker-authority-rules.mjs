import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

const builtinRoots = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/u, "").split("/", 1)[0]),
);
const allowedExternalModules = new Set(["node:process"]);
const sourceExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function normalizedPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isContained(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function collectMatches(source, pattern) {
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      matches.push(specifier);
    }
  }
  return matches;
}

export function extractStaticModuleSpecifiers(source) {
  return [
    ...new Set([
      ...collectMatches(
        source,
        /\b(?:import|export)\s+(?:(?:type\s+)?[\w$*{},\s]+?\s+from\s+)?["']([^"']+)["']/gu,
      ),
      ...collectMatches(source, /\bimport\s*\(\s*["']([^"']+)["']/gu),
      ...collectMatches(source, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu),
      ...collectMatches(source, /\bprocess\.getBuiltinModule\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ]),
  ];
}

function classifyModuleSpecifier(specifier) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return null;
  }
  if (allowedExternalModules.has(specifier)) {
    return null;
  }
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return `Electron module ${specifier}`;
  }

  const normalized = specifier.replace(/^node:/u, "");
  const root = normalized.split("/", 1)[0];
  if (specifier.startsWith("node:") || builtinRoots.has(root)) {
    return `Node builtin module ${specifier}`;
  }
  return `unapproved external module ${specifier}`;
}

export function findGeneralWorkerAuthorityFindings(source, moduleLabel = "General Worker module") {
  const findings = [];
  for (const specifier of extractStaticModuleSpecifiers(source)) {
    const authority = classifyModuleSpecifier(specifier);
    if (authority !== null) {
      findings.push(`${moduleLabel}: ${authority}`);
    }
  }

  const sourceRules = [
    {
      label: "dynamic import with a non-literal specifier",
      pattern: /\bimport\s*\(\s*(?!["'])/u,
    },
    {
      label: "CommonJS require with a non-literal specifier",
      pattern: /\brequire\s*\(\s*(?!["'])/u,
    },
    {
      label: "synchronous SQLite authority",
      pattern: /\bDatabaseSync\b/u,
    },
    {
      label: "dynamic Node builtin access",
      pattern: /\bprocess\.(?:binding|getBuiltinModule)\s*\(\s*(?!["'])/u,
    },
    {
      label: "worker environment or process mutation access",
      pattern:
        /\bprocess\.(?:env|argv|execPath|cwd|chdir|dlopen|kill|mainModule)\b|\b(?:Bun\.spawn|Deno\.Command)\b/u,
    },
    {
      label: "direct network client",
      pattern: /\bfetch\s*\(|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b|\bWebSocket\s*\(/u,
    },
    {
      label: "dynamic code evaluation",
      pattern: /\beval\s*\(|\bnew\s+Function\s*\(/u,
    },
    {
      label: "unbounded global object access",
      pattern: /\bglobalThis\b/u,
    },
    {
      label: "computed privileged identifier access",
      pattern:
        /\b(?:process|require|fetch)\s*\[[^\]]+\]|\bglobalThis\s*\[\s*["'](?:process|require|fetch)["']\s*\]/u,
    },
  ];
  for (const rule of sourceRules) {
    if (rule.pattern.test(source)) {
      findings.push(`${moduleLabel}: ${rule.label}`);
    }
  }
  return findings;
}

function resolveLocalModule(rootPath, importerPath, specifier) {
  const unresolved = path.resolve(path.dirname(importerPath), specifier);
  if (!isContained(rootPath, unresolved) && unresolved !== rootPath) {
    throw new Error(
      `${normalizedPath(path.relative(rootPath, importerPath))} imports outside the worker source root: ${specifier}`,
    );
  }
  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [
        ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
        ...sourceExtensions.map((extension) => path.join(unresolved, `index${extension}`)),
      ];
  const resolved = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (resolved === undefined) {
    throw new Error(
      `${normalizedPath(path.relative(rootPath, importerPath))} has unresolved local import ${specifier}`,
    );
  }
  return resolved;
}

export function inspectGeneralWorkerModuleGraph({ rootPath, entryPaths, isAllowedLocalModule }) {
  const resolvedRoot = path.resolve(rootPath);
  const pending = entryPaths.map((entryPath) => path.resolve(entryPath));
  const modules = new Map();
  const findings = [];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (modules.has(modulePath)) {
      continue;
    }
    if (!isContained(resolvedRoot, modulePath)) {
      throw new Error(`General Worker entry is outside ${resolvedRoot}`);
    }
    const relativePath = normalizedPath(path.relative(resolvedRoot, modulePath));
    const source = fs.readFileSync(modulePath, "utf8");
    modules.set(modulePath, source);
    if (!isAllowedLocalModule(relativePath)) {
      findings.push(`${relativePath}: local module is outside the explicit worker allowlist`);
    }
    findings.push(...findGeneralWorkerAuthorityFindings(source, relativePath));

    for (const specifier of extractStaticModuleSpecifiers(source)) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        pending.push(resolveLocalModule(resolvedRoot, modulePath, specifier));
      }
    }
  }

  return Object.freeze({
    modules,
    findings: Object.freeze([...new Set(findings)]),
  });
}

export const GENERAL_WORKER_ALLOWED_EXTERNAL_MODULES = Object.freeze([...allowedExternalModules]);
