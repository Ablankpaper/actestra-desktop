// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runnerSourcePath = path.join(repositoryRoot, "workers/goose-runner/src/main.rs");

describe("Goose runner native source portability", () => {
  it("gates Unix process authority and keeps Windows resource admission fail closed", () => {
    const source = fs.readFileSync(runnerSourcePath, "utf8");

    expect(source).toContain("#[cfg(unix)]\nuse std::io::Read;");
    expect(source).toContain("#[cfg(unix)]\nuse std::os::fd::FromRawFd;");
    expect(source).not.toContain("use std::os::unix::io::FromRawFd;");
    expect(source).toContain('#[cfg(target_os = "linux")]\nfn current_virtual_size_bytes()');
    expect(source).toContain("/proc/self/statm");
    expect(source).toContain("libc::_SC_PAGESIZE");
    expect(source).toContain("#[cfg(windows)]\nfn apply_resource_limits() -> Result<(), ()>");
    expect(source).toContain("#[cfg(windows)]\nfn watch_parent_liveness()");
    expect(source).toContain("fn reads_a_real_linux_virtual_size_baseline()");
    expect(source).toContain("fn keeps_windows_native_resource_enforcement_unavailable()");
  });
});
