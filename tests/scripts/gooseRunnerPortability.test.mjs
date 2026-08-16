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
});
