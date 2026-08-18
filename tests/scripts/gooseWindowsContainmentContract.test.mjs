// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const supervisorPath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/windows_supervisor.rs",
);
const probePath = path.join(
  repositoryRoot,
  "workers/goose-runner/src/containment/windows.rs",
);

describe("Windows Goose containment source contract", () => {
  it("reuses one opaque production launch seam", async () => {
    const [supervisor, probe] = await Promise.all([
      readFile(supervisorPath, "utf8"),
      readFile(probePath, "utf8"),
    ]);

    expect(supervisor).toContain("pub(crate) struct WindowsContainmentLaunch");
    expect(supervisor).toContain("pub(crate) struct WindowsContainmentObservation");
    expect(supervisor).toContain("pub(crate) struct ProbeHandle");
    expect(supervisor).toContain("pub(crate) fn launch_windows_containment_worker");
    expect(supervisor).toContain("PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES");
    expect(supervisor).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST");
    expect(supervisor).toContain("AssignProcessToJobObject");
    expect(supervisor).toContain("ResumeThread");
    expect(supervisor).toContain("TokenIsAppContainer");
    expect(probe).toContain("launch_windows_containment_worker");
    expect(probe).not.toContain("windows_sys::Win32");
  });
});
