import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage, statFile } from "@electron/asar";

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

const archiveStrings = execFileSync("/usr/bin/strings", [archivePath], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const forbiddenArchivePatterns = [
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

const declaredAionUiCompatibilityFiles = new Set(["out/main/index.js"]);
const textualArchiveExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".mjs", ".txt"]);
for (const archiveEntry of listPackage(archivePath, { isPack: false })) {
  const archiveFile = archiveEntry.replace(/^[/\\]+/u, "");
  if (!textualArchiveExtensions.has(path.extname(archiveFile))) {
    continue;
  }

  const entry = statFile(archivePath, archiveFile);
  if ("files" in entry || "link" in entry) {
    continue;
  }
  const contents = extractFile(archivePath, archiveFile).toString("utf8");
  if (/\baionui\b/iu.test(contents) && !declaredAionUiCompatibilityFiles.has(archiveFile)) {
    fail(`undeclared AionUi identity appears in app.asar file: ${archiveFile}`);
  }
}

const packagedMain = extractFile(archivePath, "out/main/index.js").toString("utf8");
if (
  /\baionui\b/iu.test(packagedMain) &&
  (!packagedMain.includes("aionui-shadow-evidence") || !packagedMain.includes("aionui-v2.1.41"))
) {
  fail("packaged main contains AionUi text outside the declared F2 compatibility contract");
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
