// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateGooseContainmentEvidence } from "../../scripts/gooseContainmentEvidence.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const linuxContainmentPath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/linux.rs",
);
const probeRunnerPath = path.join(repositoryRoot, "scripts/test-goose-runner-containment.mjs");

describe("Goose native containment probe contract", () => {
  it("declares the bounded Linux probe and exact six-capability result", () => {
    expect(fs.existsSync(linuxContainmentPath)).toBe(true);
    expect(fs.existsSync(probeRunnerPath)).toBe(true);
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    const runner = fs.readFileSync(probeRunnerPath, "utf8");
    expect(source).toContain("run_linux_containment_probe");
    for (const key of [
      "filesystem",
      "network",
      "processTree",
      "resources",
      "parentDeath",
      "cleanup",
    ]) {
      expect(source).toContain(key);
    }
    expect(runner).toContain("ACTESTRA_GOOSE_CONTAINMENT_PROBE");
    expect(runner).toContain("validation.code");
    expect(runner).toContain("process.exitCode = 2");
  });

  it("does not treat arbitrary Landlock errno values or raw environment text as evidence", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    expect(source).toContain("landlock_available_from_result");
    expect(source).toContain("result >= LANDLOCK_CREATE_RULESET_VERSION");
    expect(source).toContain("bounded_target");
    expect(source).toContain("bounded_hex");
    expect(source).not.toContain("raw_os_error() != Some(38)");
  });

  it("runs only a bounded exact executable artifact", () => {
    const runner = fs.readFileSync(probeRunnerPath, "utf8");
    expect(runner).toContain("path.basename(executableFile) !== executableFile");
    expect(runner).toContain('createHash("sha256")');
    expect(runner).toContain("MAX_PROBE_OUTPUT_BYTES");
    expect(runner).toContain("Buffer.byteLength(result.stdout");
  });

  it("accepts only complete evidence bound to the exact runner artifact", () => {
    const evidence = {
      contractVersion: 1,
      targetTriple: "x86_64-unknown-linux-gnu",
      sourceCommit: "a".repeat(40),
      probeSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      filesystem: true,
      network: true,
      processTree: true,
      resources: true,
      parentDeath: true,
      cleanup: true,
      status: "verified",
    };

    expect(
      validateGooseContainmentEvidence(evidence, {
        targetTriple: evidence.targetTriple,
        sourceCommit: evidence.sourceCommit,
        executableSha256: evidence.executableSha256,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects incomplete, mismatched, and widened evidence without echoing values", () => {
    const evidence = {
      contractVersion: 1,
      targetTriple: "x86_64-unknown-linux-gnu",
      sourceCommit: "a".repeat(40),
      probeSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      filesystem: false,
      network: true,
      processTree: true,
      resources: true,
      parentDeath: true,
      cleanup: true,
      status: "evidence-incomplete",
    };
    const result = validateGooseContainmentEvidence(evidence, {
      targetTriple: "x86_64-pc-windows-msvc",
      sourceCommit: evidence.sourceCommit,
      executableSha256: evidence.executableSha256,
    });

    expect(result).toEqual({ ok: false, code: "evidence-incomplete" });
    expect(JSON.stringify(result)).not.toContain(evidence.targetTriple);
    expect(JSON.stringify(result)).not.toContain(evidence.sourceCommit);
  });

  it("rejects unknown keys and malformed metadata with bounded reason codes", () => {
    const evidence = {
      contractVersion: 1,
      targetTriple: "x86_64-unknown-linux-gnu",
      sourceCommit: "a".repeat(40),
      probeSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      filesystem: true,
      network: true,
      processTree: true,
      resources: true,
      parentDeath: true,
      cleanup: true,
      status: "verified",
      leakedPath: "/Users/private/secret",
    };

    expect(
      validateGooseContainmentEvidence(evidence, {
        targetTriple: "x86_64-unknown-linux-gnu",
        sourceCommit: evidence.sourceCommit,
        executableSha256: evidence.executableSha256,
      }),
    ).toEqual({ ok: false, code: "invalid-evidence" });
  });

  it("does not treat a malformed artifact binding as a verified result", () => {
    const evidence = {
      contractVersion: 1,
      targetTriple: "x86_64-unknown-linux-gnu",
      sourceCommit: "a".repeat(40),
      probeSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      filesystem: true,
      network: true,
      processTree: true,
      resources: true,
      parentDeath: true,
      cleanup: true,
      status: "verified",
    };

    expect(validateGooseContainmentEvidence(evidence, {})).toEqual({
      ok: false,
      code: "artifact-mismatch",
    });
  });

  it("classifies a non-native host result as incomplete rather than verified", () => {
    const unsupported = {
      contractVersion: 1,
      targetTriple: "",
      sourceCommit: "",
      probeSha256: "",
      executableSha256: "",
      filesystem: false,
      network: false,
      processTree: false,
      resources: false,
      parentDeath: false,
      cleanup: false,
      status: "unsupported-platform",
    };

    expect(
      validateGooseContainmentEvidence(unsupported, {
        targetTriple: "x86_64-unknown-linux-gnu",
        sourceCommit: "a".repeat(40),
        executableSha256: "b".repeat(64),
      }),
    ).toEqual({ ok: false, code: "evidence-incomplete" });
  });
});
