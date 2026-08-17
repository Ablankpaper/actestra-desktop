// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
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

    const validationIndex = binder.indexOf(
      "const validation = validateGooseContainmentEvidence(evidence",
    );
    const manifestWriteIndex = binder.indexOf("const nextManifest =", validationIndex);
    expect(validationIndex).toBeGreaterThan(-1);
    expect(manifestWriteIndex).toBeGreaterThan(validationIndex);
    expect(binder.slice(validationIndex, manifestWriteIndex)).toContain("if (!validation.ok)");
    expect(acceptance).not.toContain("writeFile");
    expect(acceptance).not.toContain("rename");
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

  it("keeps build admission separate from exact-artifact Ubuntu and Windows containment jobs", () => {
    const workflow = read(".github/workflows/ci.yml");
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
    expect(workflow.match(/bun run goose:runner:containment:accept/gu) ?? []).toHaveLength(2);
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
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("OPENAI_API_KEY");
    expect(workflow).not.toContain("ACTESTRA_API_KEY");
    expect(workflow.match(/^\s+if: success\(\)$/gmu) ?? []).toHaveLength(2);
    expect(fs.existsSync(path.join(repositoryRoot, ".github/workflows/p8-containment.yml"))).toBe(
      false,
    );

    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)\s*(?:#.*)?$/gmu)].map(
      (match) => match[1],
    );
    expect(actionReferences).toHaveLength(21);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u);
    }
  });
});
