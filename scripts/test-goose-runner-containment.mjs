import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateGooseContainmentEvidence } from "./gooseContainmentEvidence.mjs";

const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustc = spawnSync("rustc", ["-Vv"], {
  cwd: path.join(repositoryRoot, "workers/goose-runner"),
  encoding: "utf8",
});
if (rustc.status !== 0) throw new Error("containment probe could not inspect rustc");
const targetTriple = rustc.stdout.match(/^host: (.+)$/m)?.[1];
if (targetTriple === undefined) throw new Error("containment probe could not resolve target");
const artifactDirectory = path.join(repositoryRoot, ".actestra", "goose-runner", targetTriple);
const manifestPath = path.join(artifactDirectory, "actestra-goose-runner.manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const executableFile = manifest.runner?.executable?.file;
const executableSha256 = manifest.runner?.executable?.sha256;
const sourceCommit = manifest.provenance?.actestraCommit;
if (
  typeof executableFile !== "string" ||
  typeof executableSha256 !== "string" ||
  typeof sourceCommit !== "string"
) {
  throw new Error("containment probe manifest is incomplete");
}
if (path.basename(executableFile) !== executableFile) {
  throw new Error("containment probe executable name is invalid");
}
const probeSource = await readFile(
  path.join(repositoryRoot, "workers/goose-runner/src/containment/linux.rs"),
);
const probeSha256 = createHash("sha256").update(probeSource).digest("hex");
const executablePath = path.join(artifactDirectory, executableFile);
const executableStat = await lstat(executablePath).catch(() => undefined);
if (
  executableStat === undefined ||
  !executableStat.isFile() ||
  executableStat.isSymbolicLink() ||
  executableStat.size < 1 ||
  executableStat.size > 512 * 1024 * 1024
) {
  throw new Error("containment probe executable is not a bounded regular file");
}
const actualExecutableSha256 = createHash("sha256")
  .update(await readFile(executablePath))
  .digest("hex");
if (actualExecutableSha256 !== executableSha256) {
  throw new Error("containment probe executable digest differs");
}
const result = spawnSync(executablePath, [], {
  cwd: artifactDirectory,
  encoding: "utf8",
  env: {
    ...process.env,
    ACTESTRA_GOOSE_CONTAINMENT_PROBE: "1",
    ACTESTRA_GOOSE_TARGET_TRIPLE: targetTriple,
    ACTESTRA_GOOSE_SOURCE_COMMIT: sourceCommit,
    ACTESTRA_GOOSE_PROBE_SHA256: probeSha256,
    ACTESTRA_GOOSE_EXECUTABLE_SHA256: executableSha256,
  },
  timeout: 30_000,
});
if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
  throw new Error(`containment probe failed with code ${String(result.status)}`);
}
if (
  Buffer.byteLength(result.stdout, "utf8") > MAX_PROBE_OUTPUT_BYTES ||
  Buffer.byteLength(result.stderr, "utf8") > MAX_PROBE_OUTPUT_BYTES
) {
  throw new Error("containment probe output exceeded the bounded diagnostic size");
}
let evidence;
try {
  evidence = JSON.parse(result.stdout.trim());
} catch {
  throw new Error("containment probe did not emit bounded JSON");
}
const validation = validateGooseContainmentEvidence(evidence, {
  targetTriple,
  sourceCommit,
  executableSha256,
});
if (!validation.ok) {
  process.stderr.write(`Goose containment ${validation.code}\n`);
  process.exitCode = 2;
} else {
  process.stdout.write("Goose containment verified\n");
}
