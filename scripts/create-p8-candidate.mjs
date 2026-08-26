import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assembleP8Candidate, validateP8CandidateMatrix } from "./p8-candidate-evidence.mjs";

const COMMIT = /^[a-f0-9]{40}$/u;
const CI_RUN = /^[1-9][0-9]{0,19}$/u;
const MAX_INPUT_BYTES = 256 * 1024;

function fail(code) {
  const allowed = new Set([
    "candidate-file-invalid",
    "candidate-malformed",
    "candidate-incomplete",
    "target-matrix-incomplete",
    "journey-evidence-incomplete",
    "artifact-mismatch",
    "runner-evidence-incomplete",
    "sbom-incomplete",
    "notices-incomplete",
    "signing-incomplete",
    "update-trust-incomplete",
    "rollback-invalid",
  ]);
  process.stderr.write(`P8.3 candidate ${allowed.has(code) ? code : "candidate-malformed"}\n`);
  process.exitCode = 1;
}

function readJson(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("candidate-file-invalid");
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("candidate-file-invalid");
  }
}

function parseArguments(argv) {
  const result = { targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--target-input") {
      if (typeof value !== "string") throw new Error("candidate-malformed");
      result.targets.push(readJson(value));
      index += 1;
    } else if (argument === "--source-commit") {
      result.sourceCommit = value;
      index += 1;
    } else if (argument === "--ci-run-id") {
      result.ciRunId = value;
      index += 1;
    } else if (argument === "--version") {
      result.version = value;
      index += 1;
    } else if (argument === "--update") {
      result.update = readJson(value);
      index += 1;
    } else if (argument === "--rollback") {
      result.rollback = readJson(value);
      index += 1;
    } else if (argument === "--output") {
      result.output = path.resolve(value);
      index += 1;
    } else {
      throw new Error("candidate-malformed");
    }
  }
  if (
    !COMMIT.test(result.sourceCommit ?? "") ||
    !CI_RUN.test(result.ciRunId ?? "") ||
    typeof result.version !== "string" ||
    result.targets.length !== 3 ||
    typeof result.output !== "string"
  ) {
    throw new Error("candidate-malformed");
  }
  return result;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifest = assembleP8Candidate(options);
    const validation = validateP8CandidateMatrix(manifest);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(
      `${JSON.stringify({ status: manifest.status, output: "candidate-manifest.json" })}\n`,
    );
    if (!validation.ok) process.exitCode = 1;
  } catch (error) {
    fail(error instanceof Error ? error.message : "candidate-malformed");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
