// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateGooseContainmentEvidence,
  validateGooseContainmentPrimitiveEvidence,
} from "../../scripts/gooseContainmentEvidence.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const linuxContainmentPath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/linux.rs",
);
const probeRunnerPath = path.join(repositoryRoot, "scripts/test-goose-runner-containment.mjs");
const evidenceBinderPath = path.join(repositoryRoot, "scripts/record-goose-runner-containment.mjs");

describe("Goose native containment probe contract", () => {
  it("exposes the artifact-binding command without making it part of the macOS gate", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ).scripts;
    expect(scripts["goose:runner:containment"]).toBe(
      "node scripts/record-goose-runner-containment.mjs",
    );
  });

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

  it("rechecks Linux primitives without promoting the raw probe to verified", () => {
    const runner = fs.readFileSync(probeRunnerPath, "utf8");
    expect(runner).toContain("validateGooseContainmentPrimitiveEvidence");
    expect(runner).toContain('targetTriple === "x86_64-unknown-linux-gnu"');
    expect(runner).toContain("validateGooseContainmentEvidence");
  });

  it("binds only a verified native probe to the exact manifest atomically", () => {
    expect(fs.existsSync(evidenceBinderPath)).toBe(true);
    if (!fs.existsSync(evidenceBinderPath)) return;
    const binder = fs.readFileSync(evidenceBinderPath, "utf8");
    expect(binder).toContain("validateGooseContainmentEvidence");
    expect(binder).toContain("rename");
    expect(binder).toContain("containment");
    expect(binder).toContain("process.exitCode = 2");
    expect(binder).toContain("JSON.stringify(nextManifest");
    expect(binder).toContain("validation.ok");
  });

  it("requires a real Landlock filesystem rule setup, not only a syscall probe", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    expect(source).toContain("prepare_linux_filesystem_containment");
    expect(source).toContain("landlock_restrict_self");
    expect(source).toContain("LANDLOCK_ADD_RULE_SYSCALL");
    expect(source).toContain("CLONE_NEWUSER");
    expect(source).toContain("MS_PRIVATE");
  });

  it("reuses the production Linux filesystem setup entry point", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    expect(source).toContain("pub(crate) fn prepare_linux_filesystem_containment");
    expect(source).toContain("setup_user_and_mount_namespace");
    expect(source).toContain("CLONE_NEWNET");
  });

  it("requires an x86-64 thread-aware seccomp policy", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    for (const token of [
      "AUDIT_ARCH_X86_64",
      "X32_SYSCALL_BIT",
      "CLONE_THREAD",
      "CLONE_SIGHAND",
      "CLONE_VM",
      "SECCOMP_RET_KILL_PROCESS",
      "SECCOMP_RET_ERRNO | libc::ENOSYS as u32",
      "SECCOMP_RET_ERRNO | libc::EPERM as u32",
      "install_process_creation_filter",
    ]) {
      expect(source).toContain(token);
    }
    expect(source).toContain("BPF_JSET");
    expect(source).toContain("BPF_AND");
    expect(source).not.toContain("can_install_seccomp_filter");
  });

  it("checks the hostile thread result without requiring panic payload equality", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    expect(source).toMatch(/matches!\(std::thread::spawn\(\|\| 7_u8\)\.join\(\),\s*Ok\(7_u8\)\)/u);
    expect(source).not.toContain(".join() != Ok(7_u8)");
  });

  it("requires hostile network, resource, parent-death, and cleanup probes", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    for (const stage of [
      "run_network_isolation_probe",
      "run_resource_probe",
      "run_parent_death_probe",
      "run_cleanup_probe",
    ]) {
      expect(source).toContain(stage);
    }
    expect(source).toContain("CLONE_NEWNET");
    expect(source).toContain("ACTESTRA_PARENT_LIVENESS_FD");
    expect(source).toContain("WNOHANG");
    expect(source).toContain("ErrorKind::NotFound");
  });

  it("drives namespace and parent-death probes through production primitives", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    const networkProbe = source.slice(
      source.indexOf("fn run_network_isolation_probe"),
      source.indexOf("fn hard_limit_cannot_be_raised"),
    );
    const parentDeathProbe = source.slice(
      source.indexOf("fn run_parent_death_probe"),
      source.indexOf("fn run_cleanup_probe"),
    );
    expect(networkProbe).toContain("setup_user_and_mount_namespace()");
    expect(parentDeathProbe).toContain("set_parent_death_signal()");
    expect(parentDeathProbe).toContain("SIGTERM");
  });

  it("classifies every parent-death probe branch with bounded diagnostics", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    const parentDeathProbe = source.slice(
      source.indexOf("enum ParentDeathProbeFailure"),
      source.indexOf("fn write_fd_all"),
    );

    expect(parentDeathProbe).toContain("run_parent_death_probe_with_failure");
    expect(parentDeathProbe).toContain("parent_death_probe_failure_code");
    expect(parentDeathProbe).toContain('"Goose parent-death probe failed at bounded stage {}"');
    for (const code of [
      "parent-death-pipe-setup-failed",
      "parent-death-first-fork-failed",
      "parent-death-readiness-pipe-failed",
      "parent-death-second-fork-failed",
      "parent-death-signal-setup-failed",
      "parent-death-pid-transfer-failed",
      "parent-death-readiness-failed",
      "parent-death-intermediate-exit-timeout",
      "parent-death-intermediate-exit-failed",
      "parent-death-pid-read-failed",
      "parent-death-descriptor-setup-failed",
      "parent-death-observation-read-failed",
      "parent-death-observation-timeout",
    ]) {
      expect(parentDeathProbe).toContain(`"${code}"`);
    }
  });

  it("requires exact non-widenable RLIMIT evidence without mandatory cgroup authority", () => {
    const source = fs.readFileSync(linuxContainmentPath, "utf8");
    for (const token of [
      "run_rlimit_resource_probe",
      "current_virtual_size_bytes",
      "apply_resource_limits_with",
      "RLIMIT_CPU",
      "RLIMIT_AS",
      "resource-rlimit-mismatch",
      "resource-rlimit-widening-not-denied",
    ]) {
      expect(source).toContain(token);
    }
    for (const token of [
      "run_cgroup_v2_resource_probe",
      "cgroup.subtree_control",
      "cgroup.procs",
      "cpu.max",
      "memory.max",
      "pids.max",
    ]) {
      expect(source).not.toContain(token);
    }
    expect(source).toContain("let complete = false");
    expect(source).not.toContain("process_tree_available && complete");
    expect(source).not.toContain("resources_available && complete");
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
        probeSha256: evidence.probeSha256,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts all-true primitive evidence only while the raw probe stays incomplete", () => {
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
      status: "evidence-incomplete",
    };
    const binding = {
      targetTriple: evidence.targetTriple,
      sourceCommit: evidence.sourceCommit,
      executableSha256: evidence.executableSha256,
      probeSha256: evidence.probeSha256,
    };

    expect(validateGooseContainmentPrimitiveEvidence(evidence, binding)).toEqual({ ok: true });
    expect(
      validateGooseContainmentPrimitiveEvidence({ ...evidence, status: "verified" }, binding),
    ).toEqual({ ok: false, code: "evidence-incomplete" });
    expect(
      validateGooseContainmentPrimitiveEvidence({ ...evidence, cleanup: false }, binding),
    ).toEqual({ ok: false, code: "evidence-incomplete" });
    expect(
      validateGooseContainmentPrimitiveEvidence(evidence, {
        ...binding,
        executableSha256: "d".repeat(64),
      }),
    ).toEqual({ ok: false, code: "artifact-mismatch" });
  });

  it("rejects evidence whose probe digest differs from the bound implementation", () => {
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
        probeSha256: "d".repeat(64),
      }),
    ).toEqual({ ok: false, code: "artifact-mismatch" });
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
