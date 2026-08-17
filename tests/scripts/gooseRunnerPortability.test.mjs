// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runnerSourcePath = path.join(repositoryRoot, "workers/goose-runner/src/main.rs");
const containmentModulePath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/mod.rs",
);
const unixContainmentPath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/unix.rs",
);
const windowsContainmentPath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/windows.rs",
);
const linuxRuntimePath = path.join(repositoryRoot, "workers/goose-runner/src/linux_runtime.rs");
const mainProcessPath = path.join(
  repositoryRoot,
  "apps/desktop/src/main/workers/gooseRunnerProcess.ts",
);

describe("Goose runner native source portability", () => {
  it("gates Unix process authority and keeps Windows resource admission fail closed", () => {
    const source = fs.readFileSync(runnerSourcePath, "utf8");
    const containment = fs.readFileSync(containmentModulePath, "utf8");
    const unixContainment = fs.readFileSync(unixContainmentPath, "utf8");
    const windowsContainment = fs.readFileSync(windowsContainmentPath, "utf8");

    expect(containment).toContain("#[cfg(unix)]\npub(crate) mod unix;");
    expect(unixContainment).toContain("use std::io::Read;");
    expect(unixContainment).toContain("use std::os::fd::FromRawFd;");
    expect(source).not.toContain("use std::os::unix::io::FromRawFd;");
    expect(unixContainment).toContain(
      '#[cfg(target_os = "linux")]\npub(crate) fn current_virtual_size_bytes()',
    );
    expect(unixContainment).toContain("/proc/self/statm");
    expect(unixContainment).toContain("libc::_SC_PAGESIZE");
    expect(windowsContainment).toContain("pub(crate) fn apply_resource_limits() -> Result<(), ()>");
    expect(windowsContainment).toContain("pub(crate) fn watch_parent_liveness()");
    expect(source).toContain("fn reads_a_real_linux_virtual_size_baseline()");
    expect(source).toContain("fn keeps_windows_native_resource_enforcement_unavailable()");
  });

  it("installs the Linux process policy before constructing Tokio", () => {
    const source = fs.readFileSync(runnerSourcePath, "utf8");
    const containment = fs.readFileSync(containmentModulePath, "utf8");
    expect(containment).toContain("pub(crate) use linux::install_process_creation_filter");
    const policy = source.indexOf("install_process_creation_filter()");
    const runtime = source.indexOf("tokio::runtime::Builder::new_multi_thread()");
    expect(policy).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(policy);
  });

  it("exports the resource-limit test seam only in Rust test builds", () => {
    const containment = fs.readFileSync(containmentModulePath, "utf8");
    expect(containment).toContain(
      "#[cfg(all(unix, test))]\npub(crate) use unix::apply_resource_limits_with;",
    );
    expect(containment).not.toContain(
      "pub(crate) use unix::{apply_resource_limits, apply_resource_limits_with, watch_parent_liveness};",
    );
  });

  it("declares the closed Linux bridge environment and transport-only relay", () => {
    const source = fs.readFileSync(runnerSourcePath, "utf8");
    const runtime = fs.readFileSync(linuxRuntimePath, "utf8");
    for (const key of [
      "ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET",
      "ACTESTRA_GOOSE_LINUX_MODEL_SOCKET",
      "ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT",
      "ACTESTRA_GOOSE_LINUX_MODEL_PORT",
      "ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT",
    ]) {
      expect(source).toContain(key);
    }
    expect(runtime).toContain("UnixStream");
    expect(runtime).toContain("127.0.0.1");
    expect(runtime).toContain("MAX_RELAY_CONNECTIONS");
    expect(runtime).toContain("MAX_RELAY_BYTES");
    expect(runtime).toContain("timeout");
    expect(runtime).not.toContain("Command::new");
  });

  it("requires parent-death and namespace setup before the Linux relay", () => {
    const source = fs.readFileSync(runnerSourcePath, "utf8");
    const containment = fs.readFileSync(containmentModulePath, "utf8");
    const runtime = fs.readFileSync(linuxRuntimePath, "utf8");
    expect(containment).toContain("PR_SET_PDEATHSIG");
    expect(containment).toContain("CLONE_NEWNET");
    expect(source.indexOf("prepare_linux_runtime")).toBeGreaterThan(-1);
    expect(source.indexOf("prepare_linux_runtime")).toBeLessThan(
      source.indexOf("tokio::runtime::Builder::new_multi_thread()"),
    );
    expect(runtime).toContain("TcpListener");
  });

  it("keeps the Linux direct launcher behind the unchanged runtime ceiling", () => {
    const source = fs.readFileSync(mainProcessPath, "utf8");
    const runtimeResolution = source.indexOf(
      "resolveGooseRunnerRuntimeTarget(process.platform, process.arch)",
    );
    const privateRootPreparation = source.indexOf(
      "prepared = await preparePrivateRoot(options.privateRootParent, options.artifact)",
    );

    expect(runtimeResolution).toBeGreaterThan(-1);
    expect(runtimeResolution).toBeLessThan(privateRootPreparation);
    expect(source).toContain('process.platform === "linux"');
    expect(source).toContain('process.arch === "x64"');
    expect(source).toContain("const policy = options.networkPolicy");
    expect(source).toContain('policy === "deny-all"');
    expect(source).toContain("ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET");
    expect(source).toContain("ACTESTRA_GOOSE_LINUX_MODEL_SOCKET");
    expect(source).toContain("command = options.executablePath");
    expect(source).toContain("arguments_ = []");
    expect(source).toContain('ACTESTRA_PARENT_LIVENESS_FD: "3"');
    expect(source).toContain('stdio: ["pipe", "pipe", "pipe", "pipe"]');
    expect(source).not.toContain("shell: true");
  });
});
