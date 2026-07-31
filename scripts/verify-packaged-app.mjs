import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";
import {
  extractStaticModuleSpecifiers,
  findGeneralWorkerAuthorityFindings,
} from "./general-worker-authority-rules.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, "release", "mac-arm64", "Actestra.app"),
);
const infoPlist = path.join(appBundle, "Contents", "Info.plist");
const executable = path.join(appBundle, "Contents", "MacOS", "Actestra");
const resources = path.join(appBundle, "Contents", "Resources");

function fail(message) {
  console.error(`Packaged-app verification failed: ${message}`);
  process.exit(1);
}

function plistValue(key) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist], {
    encoding: "utf8",
  }).trim();
}

if (!fs.existsSync(infoPlist)) {
  fail(`missing app bundle at ${appBundle}`);
}
if (plistValue("CFBundleIdentifier") !== "com.bignormal.actestra") {
  fail("unexpected CFBundleIdentifier");
}
if (plistValue("CFBundleName") !== "Actestra") {
  fail("unexpected CFBundleName");
}
if (plistValue("CFBundleExecutable") !== "Actestra") {
  fail("unexpected executable name");
}
if (plistValue("CFBundleURLTypes:0:CFBundleURLSchemes:0") !== "actestra") {
  fail("unexpected deep-link protocol");
}
if (!fs.existsSync(executable)) {
  fail("Actestra executable is missing");
}
if (!fs.existsSync(path.join(resources, "icon.icns"))) {
  fail("Actestra icon is missing");
}

const executableDescription = execFileSync("/usr/bin/file", [executable], {
  encoding: "utf8",
}).trim();
if (!executableDescription.includes("arm64")) {
  fail(`expected an arm64 executable, got: ${executableDescription}`);
}

const forbiddenResourceNames = ["app-update.yml", ".aionui"];
for (const resourceName of forbiddenResourceNames) {
  if (fs.existsSync(path.join(resources, resourceName))) {
    fail(`forbidden packaged resource present: ${resourceName}`);
  }
}

for (const requiredLicense of ["LICENSE.electron.txt", "LICENSES.chromium.html"]) {
  if (!fs.existsSync(path.join(resources, requiredLicense))) {
    fail(`required Electron notice is missing: ${requiredLicense}`);
  }
}

const archivePath = path.join(resources, "app.asar");
if (!fs.existsSync(archivePath)) {
  fail("app.asar is missing");
}

function extractArchiveText(archiveRelativePath) {
  try {
    return extractFile(archivePath, archiveRelativePath).toString("utf8");
  } catch {
    fail(`packaged module is missing: ${archiveRelativePath}`);
  }
}

const docxLicense = extractArchiveText("node_modules/docx/LICENSE");
if (!docxLicense.includes("The MIT License") || !docxLicense.includes("Copyright (c) 2016 Dolan")) {
  fail("packaged docx 9.6.1 MIT notice is incomplete");
}

const cronerLicense = extractArchiveText("node_modules/croner/LICENSE");
if (
  !cronerLicense.includes("The MIT License") ||
  !cronerLicense.includes("Copyright (c) 2015-2021 Hexagon")
) {
  fail("packaged Croner 9.1.0 MIT notice is incomplete");
}

const packagedPreload = extractArchiveText("out/preload/index.js");
const allowedSandboxedPreloadModules = new Set(["electron"]);
const unsupportedSandboxedPreloadModule = extractStaticModuleSpecifiers(packagedPreload).find(
  (specifier) => !allowedSandboxedPreloadModules.has(specifier),
);
if (unsupportedSandboxedPreloadModule !== undefined) {
  fail(`sandboxed preload imports unsupported module ${unsupportedSandboxedPreloadModule}`);
}

function localModuleSpecifiers(source) {
  return extractStaticModuleSpecifiers(source).filter((specifier) => specifier.startsWith("."));
}

function resolvePackagedModule(importer, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/u, 1)[0];
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), cleanSpecifier),
  );
  if (!resolved.startsWith("out/main/")) {
    fail(`main module import escapes its packaged root: ${importer} -> ${specifier}`);
  }

  const candidates = path.posix.extname(resolved)
    ? [resolved]
    : [`${resolved}.js`, path.posix.join(resolved, "index.js")];
  for (const candidate of candidates) {
    try {
      extractFile(archivePath, candidate);
      return candidate;
    } catch {
      // Continue to the next supported ESM resolution candidate.
    }
  }
  fail(`main module import is missing: ${importer} -> ${specifier}`);
}

function reachablePackagedModules(entry) {
  const reachable = new Map();
  const pending = [entry];
  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (reachable.has(modulePath)) {
      continue;
    }
    const source = extractArchiveText(modulePath);
    reachable.set(modulePath, source);
    for (const specifier of localModuleSpecifiers(source)) {
      pending.push(resolvePackagedModule(modulePath, specifier));
    }
  }
  return reachable;
}

const packagedMainModules = reachablePackagedModules("out/main/index.js");
const packagedMainGraph = [...packagedMainModules.values()].join("\n");
for (const requiredScheduleMarker of [
  "actestra:schedule-request-v1",
  "schedule-skill-unsupported",
  "schedule-unavailable",
]) {
  if (!packagedMainGraph.includes(requiredScheduleMarker)) {
    fail(`packaged main graph is missing schedule provider marker ${requiredScheduleMarker}`);
  }
}
if (packagedMainGraph.includes("/api/cron/internal/system-resume")) {
  fail("packaged main graph still calls the AionCore cron system-resume route");
}
if (
  !/\btelemetry:\s*false\b/u.test(packagedMainGraph) ||
  !packagedMainGraph.includes("Telemetry is disabled by the F1 product policy") ||
  !/\bdsn:\s*""/u.test(packagedMainGraph)
) {
  fail("packaged main graph does not prove that telemetry is disabled");
}
if (
  !/\bupstreamOfficialServices:\s*false\b/u.test(packagedMainGraph) ||
  !packagedMainGraph.includes("ACTESTRA_EXTERNAL_EFFECT_ISOLATED") ||
  !["/iofficeai/aionui", "/iofficeai/aionhub", "/iofficeai/officecli"].every((marker) =>
    packagedMainGraph.includes(marker),
  )
) {
  fail("packaged main graph does not prove that upstream services are isolated");
}
if (
  !/\bupdates:\s*false\b/u.test(packagedMainGraph) ||
  !packagedMainGraph.includes(
    "Actestra updates are unavailable until an Actestra-signed update provider is configured",
  )
) {
  fail("packaged main graph does not prove that updates are isolated");
}
const forbiddenMainPersistencePattern = /node:sqlite|DatabaseSync|openSqliteCorePersistence/;
for (const [modulePath, source] of packagedMainModules) {
  if (forbiddenMainPersistencePattern.test(source)) {
    fail(`Electron main entry graph contains synchronous SQLite: ${modulePath}`);
  }
}

const packagedPersistenceModules = reachablePackagedModules(
  "out/main/actestra-persistence-utility.js",
);
const packagedPersistenceGraph = [...packagedPersistenceModules.values()].join("\n");
for (const requiredScheduleMarker of ["aionui_schedule_jobs"]) {
  if (!packagedPersistenceGraph.includes(requiredScheduleMarker)) {
    fail(
      `packaged persistence utility graph is missing schedule authority marker ${requiredScheduleMarker}`,
    );
  }
}
if (
  ![...packagedPersistenceModules.values()].some((source) =>
    /node:sqlite|DatabaseSync/.test(source),
  )
) {
  fail("packaged persistence utility does not own the SQLite implementation");
}

const packagedGeneralWorkerModules = reachablePackagedModules(
  "out/main/actestra-general-worker.js",
);
for (const [modulePath, source] of packagedGeneralWorkerModules) {
  const authorityFindings = findGeneralWorkerAuthorityFindings(source, modulePath);
  if (authorityFindings.length > 0) {
    fail(`General Worker entry graph contains undeclared authority: ${authorityFindings[0]}`);
  }
}
const packagedGeneralWorkerGraph = [...packagedGeneralWorkerModules.values()].join("\n");
for (const requiredWorkerMarker of [
  "general-worker",
  "no-tool-complete",
  "tool-results",
  "General Worker requires protocol version",
]) {
  if (!packagedGeneralWorkerGraph.includes(requiredWorkerMarker)) {
    fail(`packaged General Worker graph is missing ${requiredWorkerMarker}`);
  }
}

const forbiddenArchivePatterns = [{ label: "AERA", value: "aera", wholeWord: true }];

function isAsciiWordCharacter(value) {
  return value !== undefined && /[a-z0-9_]/u.test(value);
}

function findForbiddenArchiveValue(value, safeEnd) {
  for (const forbiddenValue of forbiddenArchivePatterns) {
    let offset = 0;
    while (offset < safeEnd) {
      const matchIndex = value.indexOf(forbiddenValue.value, offset);
      if (matchIndex === -1) {
        break;
      }
      const matchEnd = matchIndex + forbiddenValue.value.length;
      if (matchEnd > safeEnd) {
        break;
      }
      const hasWordBoundary =
        !forbiddenValue.wholeWord ||
        (!isAsciiWordCharacter(value[matchIndex - 1]) && !isAsciiWordCharacter(value[matchEnd]));
      if (hasWordBoundary) {
        return forbiddenValue;
      }
      offset = matchIndex + 1;
    }
  }
  return null;
}

async function scanArchiveForForbiddenValue() {
  const overlapBytes = 128;
  let window = "";
  for await (const chunk of fs.createReadStream(archivePath)) {
    window += chunk.toString("latin1").toLowerCase();
    if (window.length <= overlapBytes * 3) {
      continue;
    }
    const safeEnd = window.length - overlapBytes;
    const forbiddenValue = findForbiddenArchiveValue(window, safeEnd);
    if (forbiddenValue !== null) {
      return forbiddenValue;
    }
    window = window.slice(Math.max(0, safeEnd - overlapBytes));
  }
  return findForbiddenArchiveValue(window, window.length);
}

const forbiddenArchiveValue = await scanArchiveForForbiddenValue();
if (forbiddenArchiveValue !== null) {
  fail(`forbidden identity or endpoint appears in app.asar: ${forbiddenArchiveValue.label}`);
}

const packagedCompatibilityGraph = [...packagedPersistenceModules.values()].join("\n");
for (const requiredCompatibilityMarker of [
  "aionui-shadow-evidence",
  "reserve-aionui-approval-decision",
  "aionui-v2.1.41",
]) {
  if (!packagedCompatibilityGraph.includes(requiredCompatibilityMarker)) {
    fail(`packaged compatibility graph is missing ${requiredCompatibilityMarker}`);
  }
}

const packagedRendererHtml = extractFile(archivePath, "out/renderer/index.html").toString("utf8");
const contentSecurityPolicyMeta = packagedRendererHtml.match(
  /<meta\b[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i,
)?.[0];
if (!contentSecurityPolicyMeta) {
  fail("packaged renderer is missing its Content-Security-Policy meta element");
}
const packagedContentSecurityPolicy = contentSecurityPolicyMeta.match(
  /\bcontent\s*=\s*(["'])(.*?)\1/i,
)?.[2];
if (!packagedContentSecurityPolicy) {
  fail("packaged renderer Content-Security-Policy meta element has no content");
}

const forbiddenPackagedPolicyFragments = [
  "ws://localhost",
  "http://localhost",
  "__ACTESTRA_CONTENT_SECURITY_POLICY__",
];
for (const fragment of forbiddenPackagedPolicyFragments) {
  if (packagedContentSecurityPolicy.includes(fragment)) {
    fail(`forbidden packaged renderer policy fragment appears in app.asar: ${fragment}`);
  }
}
function contentSecurityPolicyDirective(name) {
  const normalizedName = name.toLowerCase();
  const directives = packagedContentSecurityPolicy
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split(/\s+/u))
    .filter((tokens) => tokens[0]?.toLowerCase() === normalizedName);
  if (directives.length !== 1) {
    fail(`packaged renderer CSP must contain exactly one ${name} directive`);
  }
  return directives[0].slice(1);
}

const expectedPackagedConnectSources = ["'self'", "http://127.0.0.1:*", "ws://127.0.0.1:*"];
const packagedConnectSources = contentSecurityPolicyDirective("connect-src");
if (
  packagedConnectSources.length !== expectedPackagedConnectSources.length ||
  !expectedPackagedConnectSources.every((source) => packagedConnectSources.includes(source))
) {
  fail(`unexpected packaged renderer connect-src: ${packagedConnectSources.join(" ")}`);
}

const packagedScriptSources = contentSecurityPolicyDirective("script-src");
if (
  packagedScriptSources.includes("'unsafe-inline'") ||
  !packagedScriptSources.includes("'self'") ||
  !packagedScriptSources.some((value) => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/u.test(value))
) {
  fail("packaged renderer script-src permits unsafe inline execution");
}
if (!contentSecurityPolicyDirective("base-uri").includes("'none'")) {
  fail("packaged renderer CSP is missing base-uri 'none'");
}
if (!contentSecurityPolicyDirective("object-src").includes("'none'")) {
  fail("packaged renderer CSP is missing object-src 'none'");
}

console.info(
  `Packaged-app verification passed: ${appBundle} (${plistValue("CFBundleShortVersionString")}, arm64).`,
);
