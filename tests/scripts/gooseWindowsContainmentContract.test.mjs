// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const supervisorPath = path.join(repositoryRoot, "workers/goose-runner/src/windows_supervisor.rs");
const probePath = path.join(repositoryRoot, "workers/goose-runner/src/containment/windows.rs");
const mainPath = path.join(repositoryRoot, "workers/goose-runner/src/main.rs");
const controlPath = path.join(repositoryRoot, "workers/goose-runner/src/windows_control.rs");

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
    expect(supervisor).toContain("exchange_probe_request");
    expect(supervisor).toContain("single_active_process");
    expect(probe).toContain("launch_windows_containment_worker");
    expect(probe).toContain("execute_windows_hostile_probe");
    expect(probe).not.toContain("windows_sys::Win32");
  });

  it("keeps probe-only modes behind the exact containment marker", async () => {
    const [main, control] = await Promise.all([
      readFile(mainPath, "utf8"),
      readFile(controlPath, "utf8"),
    ]);

    expect(main).toContain("dispatch_windows_containment_role");
    expect(main).toContain('as_deref() == Ok("1")');
    expect(control).not.toContain("--actestra-windows-containment-child-v1");
    expect(control).not.toContain("--actestra-windows-containment-parent-v1");
  });

  it("separates parent-death evidence from explicit cleanup", async () => {
    const [supervisor, probe] = await Promise.all([
      readFile(supervisorPath, "utf8"),
      readFile(probePath, "utf8"),
    ]);

    expect(supervisor).toContain("pub(crate) struct WindowsCleanupReceipt");
    expect(supervisor).toContain("open_windows_probe_process");
    expect(supervisor).toContain("remove_windows_probe_profile");
    expect(probe).toContain("run_windows_parent_death_probe");
    expect(probe).toContain("intermediate.kill()");
    expect(probe).toContain("wait_for_exit");
    expect(probe).not.toContain("TerminateJobObject");
  });

  it("separates hostile-result framing from parent-death framing", async () => {
    const probe = await readFile(probePath, "utf8");
    const parentDeathStart = probe.indexOf("fn run_windows_parent_death_probe()");
    const hostileStart = probe.indexOf("fn collect_windows_hostile_evidence()");
    const parentDeath = probe.slice(parentDeathStart, hostileStart);
    const hostile = probe.slice(hostileStart);

    expect(parentDeathStart).toBeGreaterThan(-1);
    expect(hostileStart).toBeGreaterThan(parentDeathStart);
    expect(parentDeath).toContain("WindowsProbeFailure::ParentDeathFrame");
    expect(parentDeath).not.toContain("WindowsProbeFailure::ChildFrame");
    expect(hostile).toContain("WindowsProbeFailure::ChildFrame");
    expect(probe).toContain('"windows-parent-death-frame-invalid"');
  });

  it("keeps the hostile exchange phases separately classified", async () => {
    const [supervisor, probe] = await Promise.all([
      readFile(supervisorPath, "utf8"),
      readFile(probePath, "utf8"),
    ]);
    expect(supervisor).toContain("WindowsProbeExchangeFailure");
    expect(supervisor).toContain("Result<WindowsProbeResult, WindowsProbeExchangeFailure>");
    expect(supervisor).toContain("RequestFrame");
    expect(supervisor).toContain("WorkerWait");
    expect(supervisor).toContain("ResultFrame");
    expect(probe).toContain("ChildRequestFrame");
    expect(probe).toContain("ChildWorkerWait");
    expect(probe).toContain("ChildResultFrame");
  });

  it("separates probe request, result, wait, and unexpected child exits", async () => {
    const [supervisor, probe] = await Promise.all([
      readFile(supervisorPath, "utf8"),
      readFile(probePath, "utf8"),
    ]);
    expect(supervisor).toContain("WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE");
    expect(supervisor).toContain("WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE");
    expect(supervisor).toContain("WorkerWait");
    expect(supervisor).toContain("WorkerRequest");
    expect(supervisor).toContain("WorkerResult");
    expect(supervisor).toContain("WorkerUnexpectedExit");
    expect(probe).toContain("ChildWorkerWait");
    expect(probe).toContain("ChildRequestRead");
    expect(probe).toContain("ChildResultWrite");
    expect(probe).toContain("ChildUnexpectedExit");
  });
});
