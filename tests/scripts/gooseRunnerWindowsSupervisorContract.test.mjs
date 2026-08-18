// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

describe("Windows Goose supervisor source contract", () => {
  it("declares only the bounded Windows APIs needed by the admitted supervisor", () => {
    const manifest = read("workers/goose-runner/Cargo.toml");

    expect(manifest).toContain("[target.'cfg(windows)'.dependencies]");
    expect(manifest).toContain('windows-sys = { version = "0.61.2"');
    for (const feature of [
      "Win32_Foundation",
      "Win32_Networking_WinSock",
      "Win32_Security",
      "Win32_Security_Isolation",
      "Win32_Storage_FileSystem",
      "Win32_System_JobObjects",
      "Win32_System_Pipes",
      "Win32_System_SystemInformation",
      "Win32_System_SystemServices",
      "Win32_System_Threading",
    ]) {
      expect(manifest).toContain(`"${feature}"`);
    }
    expect(manifest).not.toContain("Win32_Security_AppLocker");
  });

  it("dispatches exact Windows modes before ordinary Goose while the skeleton stays closed", () => {
    const main = read("workers/goose-runner/src/main.rs");
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");
    const containment = read("workers/goose-runner/src/containment/windows.rs");

    expect(main).toContain("windows_supervisor::run_supervisor()");
    expect(main).toContain("windows_supervisor::run_worker()");
    expect(main.indexOf("windows_supervisor::run_supervisor()")).toBeLessThan(
      main.indexOf("tokio::runtime::Builder::new_multi_thread()"),
    );
    expect(supervisor).toContain("ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED");
    expect(supervisor).toContain("ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED");
    expect(supervisor).toContain("pub(crate) fn derive_pipe_names");
    expect(supervisor).not.toContain("CheckNetIsolation");
    expect(supervisor).not.toContain("privateNetworkClientServer");
    expect(containment).toContain('"status":"unsupported-platform"');
    expect(containment).toContain("parse_resource_limits_with");
    expect(containment).toContain("Err(())");
  });

  it("keeps native worker launch diagnostics on one closed stage vocabulary", () => {
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");

    for (const stage of [
      "input-validation",
      "attribute-list-init",
      "security-capabilities-attribute",
      "handle-list-attribute",
      "create-process",
      "assign-job",
      "query-job-membership",
      "resume-thread",
    ]) {
      expect(supervisor).toContain(`"${stage}"`);
    }
    expect(supervisor).toContain("WorkerLaunchFailureStage");
    expect(supervisor).toContain("WINDOWS_LAUNCH_DIAGNOSTIC variant={label} status=failure");
    expect(supervisor).toContain("stage={stage} reason={reason} win32_code={win32_code}");
  });

  it("classifies CreateProcess failures through one closed redacted reason vocabulary", () => {
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");

    for (const reason of [
      "file-not-found",
      "path-not-found",
      "access-denied",
      "invalid-handle",
      "bad-environment",
      "not-supported",
      "invalid-parameter",
      "elevation-required",
      "privilege-not-held",
      "other",
    ]) {
      expect(supervisor).toContain(`"${reason}"`);
    }
    expect(supervisor).toContain("GetLastError()");
    expect(supervisor).toContain("reason={reason}");
    expect(supervisor).toContain("Other(u32)");
    expect(supervisor).toContain("unclassified_win32_code");
    expect(supervisor).toContain("win32_code={win32_code}");
  });

  it("inherits the supervisor environment cleaned by Main instead of building a sparse block", () => {
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");

    expect(supervisor).toContain("GetWindowsDirectoryW");
    expect(supervisor).toContain("build_minimal_windows_environment_block");
    expect(supervisor).toContain('"SystemRoot="');
    expect(supervisor).toContain(
      "// Production inherits the supervisor environment, which Main has already cleaned.",
    );
    expect(supervisor).toContain(
      "// Sparse hand-built environment blocks fail AppContainer process initialization.",
    );
    expect(supervisor).toContain("Self::Production => Ok(None)");
    expect(supervisor).not.toContain("let empty_environment = [0_u16, 0_u16]");
    expect(supervisor).not.toMatch(/std::env::vars(?:_os)?\s*\(/u);
    expect(supervisor).toContain('std::env::var_os("ACTESTRA_ENVIRONMENT_CANARY")');
    expect(supervisor).toContain("std::env::var_os(forbidden)");
    expect(supervisor).not.toContain('std::env::var("ACTESTRA_GOOSE_CONTAINMENT_PROBE")');
  });

  it("runs one test-only sanitized launch matrix without weakening the production variant", () => {
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");
    const workflow = read(".github/workflows/ci.yml");

    for (const label of [
      "full-system-root",
      "full-inherit",
      "full-system-root-windir",
      "full-system-root-windir-comspec",
      "security-only-inherit",
      "handle-list-only-inherit",
      "plain-inherit",
    ]) {
      expect(supervisor).toContain(`"${label}"`);
    }
    expect(supervisor).toContain("WINDOWS_LAUNCH_DIAGNOSTIC");
    expect(supervisor).toContain("WorkerLaunchVariant::Production");
    expect(supervisor).toContain("diagnoses_create_process_attribute_and_environment_boundary");
    expect(workflow).toContain("--nocapture");
    expect(workflow).toContain("--test-threads=1");
    expect(supervisor).not.toMatch(/std::env::vars(?:_os)?\s*\(/u);
    expect(supervisor).not.toContain('std::env::var("ACTESTRA_GOOSE_CONTAINMENT_PROBE")');
  });

  it("runs the real supervisor spawn boundary after the Windows artifact is built", () => {
    const workflow = read(".github/workflows/ci.yml");

    const buildJob = workflow.slice(
      workflow.indexOf("goose-runner-windows:"),
      workflow.indexOf("goose-runner-linux:"),
    );
    expect(buildJob).toContain("tests/main/gooseRunnerWindowsBridge.test.ts");
    expect(buildJob.indexOf("Build Goose runner artifact")).toBeLessThan(
      buildJob.indexOf("tests/main/gooseRunnerWindowsBridge.test.ts"),
    );
  });

  it("proves the production worker token is an AppContainer rather than an ordinary token", () => {
    const supervisor = read("workers/goose-runner/src/windows_supervisor.rs");

    expect(supervisor).toContain("OpenProcessToken");
    expect(supervisor).toContain("GetTokenInformation");
    expect(supervisor).toContain("TokenIsAppContainer");
    expect(supervisor).toContain("TOKEN_QUERY");
    expect(supervisor).toContain("was_assigned_before_resume()");
    expect(supervisor).toContain("was_resumed_from_one_suspend()");
    expect(supervisor).toContain(
      "Worker process token must have AppContainer isolation, not a plain token",
    );
  });
});
