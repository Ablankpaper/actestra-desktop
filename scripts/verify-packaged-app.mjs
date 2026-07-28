import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";

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

function localModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s+["'](\.[^"']+)["']/g,
    /\bimport\s*(?:\(\s*)?["'](\.[^"']+)["']/g,
    /\brequire\s*\(\s*["'](\.[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
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

const forbiddenMainPersistencePattern = /node:sqlite|DatabaseSync|openSqliteCorePersistence/;
const reachableMainModules = new Set();
const pendingMainModules = ["out/main/index.js"];
while (pendingMainModules.length > 0) {
  const modulePath = pendingMainModules.pop();
  if (reachableMainModules.has(modulePath)) {
    continue;
  }
  reachableMainModules.add(modulePath);
  const source = extractArchiveText(modulePath);
  if (forbiddenMainPersistencePattern.test(source)) {
    fail(`Electron main entry graph contains synchronous SQLite: ${modulePath}`);
  }
  for (const specifier of localModuleSpecifiers(source)) {
    pendingMainModules.push(resolvePackagedModule(modulePath, specifier));
  }
}

let packagedPersistenceUtility;
try {
  packagedPersistenceUtility = extractFile(archivePath, "out/main/persistence-utility.js").toString(
    "utf8",
  );
} catch {
  fail("packaged persistence utility entry is missing");
}
if (!/node:sqlite/.test(packagedPersistenceUtility)) {
  fail("packaged persistence utility does not own the SQLite implementation");
}

const archiveStrings = execFileSync("/usr/bin/strings", [archivePath], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const forbiddenArchivePatterns = [
  { label: "AionUi", pattern: /\baionui\b/i },
  { label: "AERA", pattern: /\baera\b/i },
  { label: "static.aionui.com", pattern: /static\.aionui\.com/i },
  { label: "iofficeai", pattern: /\biofficeai\b/i },
  { label: "Sentry", pattern: /\bsentry\b/i },
];
for (const forbiddenValue of forbiddenArchivePatterns) {
  if (forbiddenValue.pattern.test(archiveStrings)) {
    fail(`forbidden identity or endpoint appears in app.asar: ${forbiddenValue.label}`);
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
  "ws://127.0.0.1",
  "'unsafe-inline'",
  "__ACTESTRA_CONTENT_SECURITY_POLICY__",
];
for (const fragment of forbiddenPackagedPolicyFragments) {
  if (packagedContentSecurityPolicy.includes(fragment)) {
    fail(`forbidden packaged renderer policy fragment appears in app.asar: ${fragment}`);
  }
}
if (!packagedContentSecurityPolicy.includes("connect-src 'none'")) {
  fail("packaged renderer CSP does not deny all connect sources");
}

console.info(
  `Packaged-app verification passed: ${appBundle} (${plistValue("CFBundleShortVersionString")}, arm64).`,
);
