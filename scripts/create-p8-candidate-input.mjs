import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateP8ProductJourneyEvidence } from "./p8-product-journey-evidence.mjs";

const COMMIT = /^[a-f0-9]{40}$/u;
const CI_RUN = /^[1-9][0-9]{0,19}$/u;

function digest(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) throw new Error("candidate-file-invalid");
  return crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch {
    throw new Error("candidate-file-invalid");
  }
}

function parseArguments(argv) {
  const result = { packages: [], notices: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--package") result.packages.push(value);
    else if (argument === "--notice") result.notices.push(value);
    else if (argument === "--target") result.targetId = value;
    else if (argument === "--journeys") result.journeys = value;
    else if (argument === "--runtime-executable") result.runtimeExecutable = value;
    else if (argument === "--app-asar") result.appAsar = value;
    else if (argument === "--runner-manifest") result.runnerManifest = value;
    else if (argument === "--runner-executable") result.runnerExecutable = value;
    else if (argument === "--runner-containment") result.runnerContainment = value;
    else if (argument === "--sbom") result.sbom = value;
    else if (argument === "--signing-status") result.signingStatus = value;
    else if (argument === "--signing-identity") result.signingIdentity = value;
    else if (argument === "--notarization") result.notarization = value;
    else if (argument === "--signing-verification") result.signingVerification = value;
    else if (argument === "--source-commit") result.sourceCommit = value;
    else if (argument === "--ci-run-id") result.ciRunId = value;
    else if (argument === "--output") result.output = value;
    else throw new Error("candidate-malformed");
    index += 1;
  }
  if (
    typeof result.targetId !== "string" ||
    typeof result.journeys !== "string" ||
    typeof result.sourceCommit !== "string" ||
    typeof result.ciRunId !== "string" ||
    typeof result.output !== "string" ||
    result.packages.some((value) => typeof value !== "string") ||
    result.notices.some((value) => typeof value !== "string")
  ) {
    throw new Error("candidate-malformed");
  }
  return result;
}

function packageRecords(values) {
  return values.map((value) => {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) throw new Error("artifact-mismatch");
    const format = value.slice(0, separator);
    return { format, sha256: digest(value.slice(separator + 1)) };
  });
}

function createTarget(input) {
  if (!COMMIT.test(input.sourceCommit) || !CI_RUN.test(input.ciRunId)) {
    throw new Error("candidate-malformed");
  }
  const journeys = readJson(input.journeys);
  const journeyBinding = {
    targetId: input.targetId,
    sourceCommit: input.sourceCommit,
    ciRunId: input.ciRunId,
    packages: journeys.packages,
    executableSha256: journeys.executableSha256,
    appAsarSha256: journeys.appAsarSha256,
    runner: journeys.runner,
  };
  const journeyResult = validateP8ProductJourneyEvidence(journeys, journeyBinding);
  if (!journeyResult.ok) throw new Error("journey-evidence-incomplete");
  const packages = packageRecords(input.packages);
  if (JSON.stringify(packages) !== JSON.stringify(journeys.packages))
    throw new Error("artifact-mismatch");
  const runtime = {
    executableSha256: digest(input.runtimeExecutable),
    appAsarSha256: digest(input.appAsar),
  };
  if (
    runtime.executableSha256 !== journeys.executableSha256 ||
    runtime.appAsarSha256 !== journeys.appAsarSha256
  ) {
    throw new Error("artifact-mismatch");
  }
  const runner = {
    manifestSha256: digest(input.runnerManifest),
    executableSha256: digest(input.runnerExecutable),
    containmentEvidenceSha256: digest(input.runnerContainment),
  };
  if (JSON.stringify(runner) !== JSON.stringify(journeys.runner))
    throw new Error("runner-evidence-incomplete");
  const manifest = readJson(input.runnerManifest);
  if (
    manifest?.provenance?.actestraCommit !== input.sourceCommit ||
    manifest?.runner?.executable?.sha256 !== runner.executableSha256
  ) {
    throw new Error("runner-evidence-incomplete");
  }
  const sbomValue = readJson(input.sbom);
  if (sbomValue?.bomFormat !== "CycloneDX" || sbomValue?.specVersion !== "1.6")
    throw new Error("sbom-incomplete");
  const noticeFiles = input.notices.map((filePath) => path.basename(filePath));
  if (
    JSON.stringify(noticeFiles) !==
    JSON.stringify(["THIRD_PARTY_NOTICES.md", "GOOSE-APACHE-2.0.txt"])
  )
    throw new Error("notices-incomplete");
  for (const noticePath of input.notices) digest(noticePath);
  const signingVerificationSha256 = digest(input.signingVerification);
  return {
    targetId: input.targetId,
    platform: input.targetId.startsWith("macos")
      ? "darwin"
      : input.targetId.startsWith("windows")
        ? "win32"
        : "linux",
    architecture: input.targetId.startsWith("macos") ? "arm64" : "x64",
    packages,
    runtime,
    journeyEvidenceSha256: digest(input.journeys),
    runner,
    sbom: { format: "CycloneDX", specVersion: "1.6", sha256: digest(input.sbom) },
    provenance: {
      sourceCommit: input.sourceCommit,
      ciRunId: input.ciRunId,
      builder: input.targetId.startsWith("macos")
        ? "macos-15"
        : input.targetId.startsWith("windows")
          ? "windows-2025"
          : "ubuntu-24.04",
    },
    notices: {
      sha256: crypto
        .createHash("sha256")
        .update(
          input.notices
            .map((filePath) => fs.readFileSync(path.resolve(filePath)))
            .reduce((all, bytes) => Buffer.concat([all, bytes]), Buffer.alloc(0)),
        )
        .digest("hex"),
      files: ["THIRD_PARTY_NOTICES.md", "GOOSE-APACHE-2.0.txt"],
    },
    signing: {
      status: input.signingStatus,
      identity: input.signingIdentity,
      notarization: input.notarization,
      verificationSha256: signingVerificationSha256,
    },
  };
}

function main() {
  try {
    const input = parseArguments(process.argv.slice(2));
    const target = createTarget(input);
    fs.mkdirSync(path.dirname(path.resolve(input.output)), { recursive: true });
    fs.writeFileSync(path.resolve(input.output), `${JSON.stringify(target, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({ targetId: target.targetId, status: "verified" })}\n`);
  } catch (error) {
    process.stderr.write(
      `P8.3 candidate input ${error instanceof Error ? error.message : "candidate-malformed"}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
