import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  GOOSE_RUNNER_MANIFEST_FILE,
  GooseRunnerArtifactError,
  admitGooseRunnerArtifact,
} from "../apps/desktop/src/main/workers/gooseRunnerArtifact.ts";
import { resolveGooseRunnerBuildTarget } from "../apps/desktop/src/main/workers/gooseRunnerTarget.ts";

const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function admitEmittedGooseRunnerBuild(): Promise<void> {
  const target = resolveGooseRunnerBuildTarget(process.platform, process.arch);
  if (target === undefined) {
    throw new Error("unsupported-build-host");
  }
  const artifactDirectory = path.join(
    repositoryRoot,
    ".actestra",
    "goose-runner",
    target.targetTriple,
  );
  const manifestPath = path.join(artifactDirectory, GOOSE_RUNNER_MANIFEST_FILE);
  const manifestStat = await lstat(manifestPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    manifestStat.size < 1 ||
    manifestStat.size > MAXIMUM_MANIFEST_BYTES
  ) {
    throw new Error("invalid-build-manifest");
  }
  const manifestSha256 = sha256(await readFile(manifestPath));
  const admitted = await admitGooseRunnerArtifact(artifactDirectory, {
    trustedManifestSha256: manifestSha256,
    expectedTargetTriple: target.targetTriple,
  });
  console.info(
    JSON.stringify({
      targetTriple: admitted.targetTriple,
      manifestSha256,
      executableSha256: admitted.executableSha256,
      executableSize: admitted.executableSize,
    }),
  );
}

try {
  await admitEmittedGooseRunnerBuild();
} catch (error) {
  const code =
    error instanceof GooseRunnerArtifactError
      ? error.code
      : error instanceof Error &&
          ["unsupported-build-host", "invalid-build-manifest"].includes(error.message)
        ? error.message
        : "build-artifact-unavailable";
  console.error(JSON.stringify({ status: "failed", code }));
  process.exitCode = 1;
}
