import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_SCRIPT_BYTES = 512 * 1024;
const EXPECTED_TARGET = "x86_64-unknown-linux-gnu";
const EXPECTED_PROFILE_NAME = "Actestra-Goose-Runner";
const EXPECTED_EXECUTABLE = "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner";
const PACKAGE_ATTESTATION_FILE = "actestra-goose-runner-package.json";
const RUNNER_FILES = Object.freeze([
  "GOOSE-APACHE-2.0.txt",
  "Cargo.lock",
  "actestra-goose-runner",
  "actestra-goose-runner.audit.json",
  "actestra-goose-runner.cdx.json",
  "actestra-goose-runner.manifest.json",
]);
const PACKAGE_ATTESTATION_FILES = Object.freeze(
  RUNNER_FILES.map((file) => `actestra-goose-runner/${file}`),
);
const ADMISSION_KEYS = Object.freeze([
  "contractVersion",
  "executablePath",
  "executableSha256",
  "profileName",
  "profileSha256",
  "runnerManifestSha256",
  "targetTriple",
]);
const PACKAGE_ATTESTATION_KEYS = Object.freeze([
  "contractVersion",
  "executableFile",
  "executableSha256",
  "files",
  "runnerDirectory",
  "runnerManifestSha256",
  "sourceCommit",
  "targetTriple",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

export class AionuiLinuxDebInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AionuiLinuxDebInspectionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AionuiLinuxDebInspectionError(code, message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function regularFile(filePath, code) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    fail(code, "required DEB entry is missing");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o22) !== 0) {
    fail(code, "required DEB entry is not a safe regular file");
  }
  return metadata;
}

async function boundedRead(filePath, maximum, code) {
  const metadata = await regularFile(filePath, code);
  if (metadata.size > maximum) fail(code, "DEB metadata entry exceeds the bounded size");
  try {
    return await readFile(filePath);
  } catch {
    fail(code, "DEB metadata entry cannot be read");
  }
}

function parseAdmission(bytes) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("deb-record-invalid", "DEB admission record is invalid");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("deb-record-invalid", "DEB admission record is invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== ADMISSION_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !ADMISSION_KEYS.includes(key))
  ) {
    fail("deb-record-invalid", "DEB admission record keys are invalid");
  }
  if (
    value.contractVersion !== 1 ||
    value.targetTriple !== EXPECTED_TARGET ||
    value.profileName !== EXPECTED_PROFILE_NAME ||
    value.executablePath !== EXPECTED_EXECUTABLE ||
    typeof value.runnerManifestSha256 !== "string" ||
    !SHA256.test(value.runnerManifestSha256) ||
    typeof value.executableSha256 !== "string" ||
    !SHA256.test(value.executableSha256) ||
    typeof value.profileSha256 !== "string" ||
    !SHA256.test(value.profileSha256)
  ) {
    fail("deb-record-invalid", "DEB admission record values are invalid");
  }
  return Object.freeze({ ...value });
}

function parsePackageAttestation(bytes) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("deb-package-attestation-invalid", "DEB package attestation is invalid");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("deb-package-attestation-invalid", "DEB package attestation is invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== PACKAGE_ATTESTATION_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !PACKAGE_ATTESTATION_KEYS.includes(key)) ||
    value.contractVersion !== 1 ||
    value.targetTriple !== EXPECTED_TARGET ||
    typeof value.sourceCommit !== "string" ||
    !COMMIT.test(value.sourceCommit) ||
    typeof value.runnerManifestSha256 !== "string" ||
    !SHA256.test(value.runnerManifestSha256) ||
    typeof value.executableSha256 !== "string" ||
    !SHA256.test(value.executableSha256) ||
    value.executableFile !== "actestra-goose-runner" ||
    value.runnerDirectory !== "actestra-goose-runner" ||
    !Array.isArray(value.files) ||
    value.files.length !== PACKAGE_ATTESTATION_FILES.length ||
    value.files.some((file, index) => file !== PACKAGE_ATTESTATION_FILES[index])
  ) {
    fail("deb-package-attestation-invalid", "DEB package attestation is invalid");
  }
  return Object.freeze({ ...value, files: PACKAGE_ATTESTATION_FILES });
}

async function locateResources(root) {
  const candidates = [
    path.join(root, "data/opt/Actestra/resources"),
    path.join(root, "opt/Actestra/resources"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next bounded layout.
    }
  }
  fail("deb-layout-invalid", "DEB Actestra resources layout is missing");
}

async function locateControl(root) {
  for (const candidate of [path.join(root, "control"), path.join(root, "DEBIAN")]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next bounded layout.
    }
  }
  fail("deb-control-invalid", "DEB maintainer scripts are missing");
}

async function inspectExtracted(root) {
  const resources = await locateResources(root);
  const control = await locateControl(root);
  const runner = path.join(resources, "actestra-goose-runner");
  let entries;
  try {
    entries = await readdir(runner, { withFileTypes: true });
  } catch {
    fail("deb-runner-layout-invalid", "DEB Goose runner directory is missing");
  }
  const names = entries.map((entry) => entry.name).sort();
  if (
    names.length !== RUNNER_FILES.length ||
    names.some((name, index) => name !== [...RUNNER_FILES].sort()[index]) ||
    entries.some((entry) => entry.isSymbolicLink() || !entry.isFile())
  ) {
    fail("deb-runner-layout-invalid", "DEB Goose runner file set is not exact");
  }

  const profilePath = path.join(resources, "apparmor-profile");
  const recordPath = path.join(resources, "actestra-goose-runner-admission.json");
  const packageAttestationPath = path.join(resources, PACKAGE_ATTESTATION_FILE);
  const profileBytes = await boundedRead(profilePath, MAX_RECORD_BYTES, "deb-profile-invalid");
  const record = parseAdmission(
    await boundedRead(recordPath, MAX_RECORD_BYTES, "deb-record-invalid"),
  );
  const packageAttestation = parsePackageAttestation(
    await boundedRead(packageAttestationPath, MAX_RECORD_BYTES, "deb-package-attestation-invalid"),
  );
  const executablePath = path.join(runner, "actestra-goose-runner");
  const executableMetadata = await regularFile(executablePath, "deb-runner-layout-invalid");
  if ((executableMetadata.mode & 0o111) === 0) {
    fail("deb-runner-layout-invalid", "DEB Goose executable is not executable");
  }

  const manifestBytes = await boundedRead(
    path.join(runner, "actestra-goose-runner.manifest.json"),
    MAX_RECORD_BYTES,
    "deb-runner-layout-invalid",
  );
  const executableBytes = await readFile(executablePath);
  if (
    digest(profileBytes) !== record.profileSha256 ||
    digest(manifestBytes) !== record.runnerManifestSha256 ||
    digest(executableBytes) !== record.executableSha256 ||
    packageAttestation.runnerManifestSha256 !== record.runnerManifestSha256 ||
    packageAttestation.executableSha256 !== record.executableSha256
  ) {
    fail("deb-digest-mismatch", "DEB profile or Goose Artifact digest does not match its record");
  }

  const scriptNames = await readdir(control).catch(() => []);
  if (
    !scriptNames.includes("postinst") ||
    !scriptNames.some((name) => name === "prerm" || name === "postrm")
  ) {
    fail("deb-control-invalid", "DEB install/remove maintainer scripts are incomplete");
  }
  const scriptContents = new Map();
  for (const name of scriptNames.filter(
    (candidate) => candidate === "postinst" || candidate === "prerm" || candidate === "postrm",
  )) {
    scriptContents.set(
      name,
      Buffer.from(
        await boundedRead(path.join(control, name), MAX_SCRIPT_BYTES, "deb-control-invalid"),
      ).toString("utf8"),
    );
  }
  const removalScript = scriptContents.get("prerm") ?? scriptContents.get("postrm") ?? "";
  if (
    !scriptContents.get("postinst")?.includes("/etc/apparmor.d/Actestra") ||
    !removalScript.includes("/etc/apparmor.d/Actestra")
  ) {
    fail("deb-control-invalid", "DEB maintainer scripts do not bind the fixed AppArmor profile");
  }

  return Object.freeze({
    status: "verified",
    packageFormat: "deb",
    files: Object.freeze([
      "opt/Actestra/resources/apparmor-profile",
      "opt/Actestra/resources/actestra-goose-runner-admission.json",
      `opt/Actestra/resources/${PACKAGE_ATTESTATION_FILE}`,
      ...RUNNER_FILES.map((name) => `opt/Actestra/resources/actestra-goose-runner/${name}`),
    ]),
    sourceCommit: packageAttestation.sourceCommit,
    profileSha256: record.profileSha256,
    runnerManifestSha256: record.runnerManifestSha256,
    executableSha256: record.executableSha256,
  });
}

async function runDpkg(args) {
  try {
    await execFileAsync("dpkg-deb", args, { maxBuffer: 64 * 1024, windowsHide: true });
  } catch {
    fail("deb-inspection-unavailable", "dpkg-deb could not inspect the Ubuntu package");
  }
}

async function inspectDebFile(debPath) {
  const root = await mkdtemp(path.join(os.tmpdir(), "actestra-deb-inspect-"));
  try {
    await runDpkg(["--extract", debPath, path.join(root, "data")]);
    await runDpkg(["--control", debPath, path.join(root, "control")]);
    return await inspectExtracted(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function inspectAionuiLinuxDeb(inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    fail("deb-input-invalid", "DEB inspection input is invalid");
  }
  let metadata;
  try {
    metadata = await lstat(inputPath);
  } catch {
    fail("deb-input-invalid", "DEB inspection input is unavailable");
  }
  if (metadata.isDirectory()) return inspectExtracted(inputPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !inputPath.endsWith(".deb")) {
    fail("deb-input-invalid", "DEB inspection input is not a regular .deb file");
  }
  return inspectDebFile(inputPath);
}

async function main() {
  try {
    const result = await inspectAionuiLinuxDeb(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code =
      error instanceof AionuiLinuxDebInspectionError ? error.code : "deb-inspection-failed";
    process.stdout.write(`${JSON.stringify({ status: "failed", code })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
