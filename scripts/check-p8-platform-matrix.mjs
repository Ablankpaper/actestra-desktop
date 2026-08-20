import { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } from "./p8-platform-matrix.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ordered(contents, fragments) {
  let cursor = -1;
  return fragments.every((fragment) => {
    const next = contents.indexOf(fragment, cursor + 1);
    if (next <= cursor) return false;
    cursor = next;
    return true;
  });
}

export function validateP8WindowsRuntimeCiContract(workflow) {
  const reasons = [];
  if (typeof workflow !== "string") return Object.freeze(["windows-runtime-workflow"]);
  const start = workflow.indexOf("\n  goose-runtime-windows:");
  const tail = start < 0 ? "" : workflow.slice(start + 1);
  const nextJob = tail.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/u);
  const job = start < 0 ? "" : tail.slice(0, nextJob < 0 ? tail.length : nextJob + 1);
  if (job.length === 0) return Object.freeze(["windows-runtime-job"]);
  if (
    !job.includes("name: P8.2 Windows x64 Goose authenticated runtime") ||
    !job.includes("runs-on: windows-2025") ||
    !job.includes("timeout-minutes: 60")
  ) {
    reasons.push("windows-runtime-target");
  }
  if (
    !ordered(job, [
      "cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_native_tests",
      "bun run test tests/main/gooseRunnerWindowsChannelNative.test.ts",
      "bun run goose:runner:build",
      "git diff --exit-code -- workers/goose-runner/Cargo.lock",
      "bun run goose:runner:admit-build",
      "bun run goose:runner:containment:accept | Tee-Object -FilePath containment-evidence.json",
      "ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256",
      "ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_PATH",
      "bun run goose:runner:integration:windows | Tee-Object -FilePath windows-runtime-evidence.json",
      "name: Re-admit exact Windows Goose runner",
      "name: Preserve bounded Windows authenticated runtime evidence",
    ])
  ) {
    reasons.push("windows-runtime-order");
  }
  if (
    !job.includes("if: success()") ||
    !job.includes("name: p8-goose-runtime-windows-${{ github.sha }}") ||
    !job.includes("path: windows-runtime-evidence.json") ||
    !job.includes("retention-days: 3") ||
    !job.includes("compression-level: 0")
  ) {
    reasons.push("windows-runtime-evidence-upload");
  }
  if (
    !job.includes("ACTESTRA_GOOSE_WINDOWS_RUNTIME_FAILURE_OUTPUT_PATH") ||
    !job.includes("name: Preserve bounded Windows authenticated runtime failure") ||
    !job.includes("if: failure()") ||
    !job.includes("path: windows-runtime-failure.json")
  ) {
    reasons.push("windows-runtime-failure-evidence-upload");
  }
  if (job.includes("OPENAI_API_KEY") || job.includes("ANTHROPIC_API_KEY")) {
    reasons.push("windows-runtime-credential");
  }
  return Object.freeze(reasons);
}

function main() {
  const workflow = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const reasons = [
    ...validateP8PlatformMatrix(P8_PLATFORM_MATRIX),
    ...validateP8WindowsRuntimeCiContract(workflow),
  ];
  if (reasons.length > 0) {
    console.error(`P8.1 platform contract failed: ${reasons.join(",")}`);
    process.exit(1);
  }

  console.log(
    `P8.1 platform contract passed: ${P8_PLATFORM_MATRIX.targets.length} targets, ` +
      `${P8_PLATFORM_MATRIX.requiredJourneys.length} journeys, ` +
      `${P8_PLATFORM_MATRIX.requiredEvidence.length} evidence classes.`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
