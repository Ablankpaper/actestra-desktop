import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

console.info(
  `Packaged-app verification passed: ${appBundle} (${plistValue("CFBundleShortVersionString")}, arm64).`,
);
