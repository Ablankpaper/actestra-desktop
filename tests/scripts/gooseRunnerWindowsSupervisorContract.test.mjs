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
    expect(supervisor).toContain("worker launch failed at stage={stage}");
  });
});
