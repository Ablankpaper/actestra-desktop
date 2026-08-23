// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readWorkflowJob(workflow, jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  if (start === -1) return "";
  const end = workflow.slice(start + 1).search(/\n  [A-Za-z0-9_-]+:\n/u);
  return workflow.slice(start, end === -1 ? workflow.length : start + 1 + end);
}

function expectOrderedFragments(contents, fragments) {
  const normalized = contents.replace(/\s+/gu, " ");
  let cursor = -1;
  for (const fragment of fragments) {
    const next = normalized.indexOf(fragment.replace(/\s+/gu, " "), cursor + 1);
    expect(next, `missing or out-of-order fragment: ${fragment}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("P8 native Goose containment acceptance gate", () => {
  it("registers a target-native acceptance command separate from build admission", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts["goose:runner:containment:accept"]).toBe(
      "node scripts/run-goose-runner-containment.mjs",
    );
    expect(
      fs.existsSync(path.join(repositoryRoot, "scripts/run-goose-runner-containment.mjs")),
    ).toBe(true);
  });

  it("keeps native acceptance fail-closed and bounded", () => {
    const source = read("scripts/run-goose-runner-containment.mjs");
    expect(source).toContain("record-goose-runner-containment.mjs");
    expect(source).toContain("test-goose-runner-containment.mjs");
    expect(source).toContain("evidence-incomplete");
    expect(source).toContain("target-unsupported");
    expect(source).toContain("MAX_OUTPUT_BYTES");
    expect(source).toContain("process.exitCode = 2");
    expect(source).toContain("currentProbeSha256");
    expect(source).toMatch(
      /validateGooseContainmentRecord\([\s\S]*probeSha256:\s*currentProbeSha256/u,
    );
    expect(source).not.toContain("continue-on-error");
  });

  it("keeps partial Linux evidence incomplete and outside the admitted manifest", () => {
    const linuxProbe = read("workers/goose-runner/src/containment/linux.rs");
    const binder = read("scripts/record-goose-runner-containment.mjs");
    const validator = read("scripts/gooseContainmentEvidence.mjs");
    const acceptance = read("scripts/run-goose-runner-containment.mjs");

    expect(linuxProbe).toContain("let complete = false");
    expect(linuxProbe).toContain('if complete { "verified" } else { "evidence-incomplete" }');
    expect(validator).toContain('value.status !== "verified"');
    expect(validator).toContain("CAPABILITY_KEYS.some((key) => value[key] !== true)");
    expect(validator).toContain("validateGooseContainmentPrimitiveEvidence");
    expect(binder).toContain("validateGooseNativeIntegrationEvidence");

    const validationIndex = binder.indexOf("validateGooseContainmentPrimitiveEvidence(evidence");
    const manifestWriteIndex = binder.indexOf("const nextManifest =", validationIndex);
    expect(validationIndex).toBeGreaterThan(-1);
    expect(manifestWriteIndex).toBeGreaterThan(validationIndex);
    expect(binder.slice(validationIndex, manifestWriteIndex)).toContain("if (!validation.ok)");
    expect(acceptance).toContain("integration-evidence.json");
    expect(acceptance).not.toContain("rename");
  });

  it("admits Windows evidence only when all six native capabilities are complete", () => {
    const windowsProbe = read("workers/goose-runner/src/containment/windows.rs");

    expect(windowsProbe).toContain("let complete = filesystem");
    expect(windowsProbe).toContain("&& network");
    expect(windowsProbe).toContain("&& process_tree");
    expect(windowsProbe).toContain("&& resources");
    expect(windowsProbe).toContain("&& parent_death");
    expect(windowsProbe).toContain("&& cleanup");
    expect(windowsProbe).toContain("let status = if complete {");
    expect(windowsProbe).toContain('"verified"');
    expect(windowsProbe).toContain('"evidence-incomplete"');
    expect(windowsProbe).toContain("Goose windows containment failed at bounded stage");
  });

  it("runs authenticated integration before primitive binding and always deletes temporary evidence", () => {
    const source = read("scripts/run-goose-runner-containment.mjs");
    const integrationIndex = source.indexOf("runNativeIntegration(");
    const evidenceWriteIndex = source.indexOf("writeFile(", integrationIndex);
    const bindingIndex = source.indexOf('"record-goose-runner-containment.mjs"');
    const restartValidationIndex = source.indexOf("readVerifiedArtifact(", bindingIndex);

    expect(integrationIndex).toBeGreaterThan(-1);
    expect(evidenceWriteIndex).toBeGreaterThan(integrationIndex);
    expect(bindingIndex).toBeGreaterThan(evidenceWriteIndex);
    expect(restartValidationIndex).toBeGreaterThan(bindingIndex);
    expect(source).toContain('mkdtemp(path.join(os.tmpdir(), "actestra-goose-composite-")');
    expect(source).toContain("await rm(evidenceRoot, { recursive: true, force: true })");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("ACTESTRA_API_KEY");
  });

  it("accepts one caller-owned integration file without passing JSON on the command line", () => {
    const source = read("scripts/run-goose-runner-containment.mjs");
    expect(source).toContain("readProvidedIntegrationEvidence");
    expect(source).toContain("process.argv[2]");
    expect(source).toContain("process.argv[3]");
    expect(source).toContain("validateGooseNativeIntegrationEvidence");
    expect(source).toContain("onOwnedRoot(canonicalRoot)");
    expect(source).toContain("evidenceRoot = ownedRoot");
    expect(source).not.toContain("JSON.parse(process.argv");
  });

  it("binds source and executable identity to the production runner's exact native probe", () => {
    const binder = read("scripts/record-goose-runner-containment.mjs");
    const probeRunner = read("scripts/test-goose-runner-containment.mjs");
    const acceptance = read("scripts/run-goose-runner-containment.mjs");
    const runner = read("workers/goose-runner/src/main.rs");
    const containment = read("workers/goose-runner/src/containment/mod.rs");
    const linuxProbe = read("workers/goose-runner/src/containment/linux.rs");

    for (const key of [
      "ACTESTRA_GOOSE_SOURCE_COMMIT",
      "ACTESTRA_GOOSE_PROBE_SHA256",
      "ACTESTRA_GOOSE_EXECUTABLE_SHA256",
    ]) {
      expect(binder).toContain(key);
      expect(probeRunner).toContain(key);
      expect(linuxProbe).toContain(key);
    }
    expect(runner).toContain("mod containment;");
    expect(runner).toContain("containment::prepare_linux_filesystem_containment");
    expect(containment).toContain("linux::run_linux_containment_probe()");
    expect(acceptance).toContain("sourceCommit: manifest?.provenance?.actestraCommit");
    expect(acceptance).toContain("executableSha256,");
    expect(acceptance).toContain("probeSha256: currentProbeSha256");
    expect(acceptance).toContain("LINUX_INSTALLED_GOOSE_EXECUTABLE_PATH");
    expect(acceptance).toContain("[...binderArguments, ...probeArguments]");
    expect(binder).toContain("requestedExecutablePath: process.argv[6]");
    expect(probeRunner).toContain("requestedExecutablePath: process.argv[4]");
  });

  it("surfaces only closed native resource diagnostics across the acceptance boundary", () => {
    const probe = read("scripts/test-goose-runner-containment.mjs");
    const acceptance = read("scripts/run-goose-runner-containment.mjs");
    expect(probe).toContain("classifyGooseContainmentProbeStderr");
    expect(probe).toContain("classifyGooseContainmentIncompleteEvidence");
    expect(probe).toContain('ACTESTRA_GOOSE_CONTAINMENT_DEBUG: "1"');
    expect(acceptance).toContain("GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES");
    expect(acceptance).not.toContain("process.stderr.write(result.stderr");
  });

  it("selects the probe implementation for the exact native target", () => {
    const source = read("scripts/test-goose-runner-containment.mjs");
    expect(source).toContain('"x86_64-unknown-linux-gnu"');
    expect(source).toContain('"x86_64-pc-windows-msvc"');
    expect(source).toContain("probeSource");
    expect(source).toContain("probeSourceRelativePath");
    expect(source).toContain("path.join(repositoryRoot, probeSourceRelativePath)");
  });

  it("keeps build admission separate from exact-artifact containment and Windows runtime jobs", () => {
    const workflow = read(".github/workflows/ci.yml");
    const linuxJob = readWorkflowJob(workflow, "goose-containment-linux");
    const windowsJob = readWorkflowJob(workflow, "goose-containment-windows");
    const windowsRuntimeJob = readWorkflowJob(workflow, "goose-runtime-windows");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("P8.2 Ubuntu x64 Goose build probe");
    expect(workflow).toContain("P8.2 Windows x64 Goose build probe");
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain("runs-on: windows-2025");
    expect(workflow).toContain("goose-containment-windows:");
    expect(workflow).toContain("goose-containment-linux:");
    expect(workflow).toContain("containment-evidence.json");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).not.toContain("actions/download-artifact@");
    expect(workflow.match(/bun run goose:runner:containment:accept/gu) ?? []).toHaveLength(3);
    expect(workflow.match(/bun run goose:runner:integration:linux/gu) ?? []).toHaveLength(1);
    expect(workflow).toMatch(
      /goose-runner-windows:[\s\S]*Admit emitted Goose runner artifact[\s\S]*goose-runner-linux:/u,
    );
    expect(workflow).toMatch(
      /goose-runner-linux:[\s\S]*Admit emitted Goose runner artifact[\s\S]*goose-containment-windows:/u,
    );
    expect(workflow).toMatch(
      /goose-containment-windows:[\s\S]*Build exact Windows Goose runner artifact[\s\S]*Admit exact Windows Goose runner artifact[\s\S]*Run exact Windows containment acceptance/u,
    );
    expect(workflow).toMatch(
      /goose-containment-linux:[\s\S]*Build exact Ubuntu Goose runner artifact[\s\S]*Admit exact Ubuntu Goose runner artifact[\s\S]*Run exact Ubuntu containment acceptance/u,
    );
    expectOrderedFragments(linuxJob, [
      "Build exact Ubuntu Goose runner artifact",
      "Admit exact Ubuntu Goose runner artifact",
      "Run authenticated Linux Goose integration",
      "Run exact Ubuntu containment acceptance",
      "Re-admit bound Ubuntu Goose runner artifact",
      "Preserve bounded Ubuntu containment evidence",
    ]);
    expect(linuxJob.match(/bun run goose:runner:admit-build/gu) ?? []).toHaveLength(2);
    expect(linuxJob).toContain("${RUNNER_TEMP}");
    expect(windowsJob).not.toContain("goose:runner:integration:linux");
    expect(windowsRuntimeJob).toContain("goose:runner:integration:windows");
    expect(windowsRuntimeJob).not.toContain("goose:runner:integration:linux");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("OPENAI_API_KEY");
    expect(workflow).not.toContain("ACTESTRA_API_KEY");
    expect(workflow.match(/^\s+if: success\(\)$/gmu) ?? []).toHaveLength(3);
    expect(fs.existsSync(path.join(repositoryRoot, ".github/workflows/p8-containment.yml"))).toBe(
      false,
    );

    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)\s*(?:#.*)?$/gmu)].map(
      (match) => match[1],
    );
    // P8.2d adds one Windows checkout/setup/upload trio plus the macOS and
    // Ubuntu bounded-evidence uploads to the existing pinned action set.
    expect(actionReferences).toHaveLength(32);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u);
    }
  });
});
