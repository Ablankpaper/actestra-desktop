import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustc = spawnSync("rustc", ["-Vv"], {
  cwd: path.join(repositoryRoot, "workers", "goose-runner"),
  encoding: "utf8",
});
if (rustc.status !== 0) {
  throw new Error(`Goose runner test could not inspect rustc: ${rustc.stderr.trim()}`);
}
const targetTriple = rustc.stdout.match(/^host: (.+)$/m)?.[1];
if (targetTriple === undefined) {
  throw new Error("Goose runner test could not resolve the host target triple");
}
const artifactDirectory = path.join(repositoryRoot, ".actestra", "goose-runner", targetTriple);
const manifestBytes = await readFile(
  path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
);
const trustedManifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const test = spawnSync(
  "bun",
  [
    "run",
    "test",
    "tests/main/gooseAcpHandshake.test.ts",
    "tests/main/gooseRunnerArtifact.test.ts",
    "tests/main/gooseRunnerLifecycle.test.ts",
    "tests/main/gooseRunnerIntegration.test.ts",
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR: artifactDirectory,
      ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: trustedManifestSha256,
    },
    stdio: "inherit",
  },
);
if (test.status !== 0 || test.signal !== null) {
  throw new Error(
    `Goose runner test failed (code=${String(test.status)}, signal=${String(test.signal)})`,
  );
}
