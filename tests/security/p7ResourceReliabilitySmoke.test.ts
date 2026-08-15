// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  P7_RESOURCE_RELIABILITY_CASES,
  assertP7ResourceReliabilityResults,
  resolveP7ResourceReliabilitySmokeIsolation,
  runP7GooseForkDenialProbe,
  runP7GooseOutputBoundaryProbe,
  runP7GooseStorageBoundaryProbe,
} from "../../apps/desktop/src/main/security/p7ResourceReliabilitySmoke";

const fixtureRoots: string[] = [];

async function fixtureRoot(parent = os.tmpdir()): Promise<string> {
  const root = await mkdtemp(path.join(parent, "actestra-p7-resource-test-"));
  fixtureRoots.push(root);
  await Promise.all([
    mkdir(path.join(root, "user-data")),
    mkdir(path.join(root, "home")),
    mkdir(path.join(root, "temp")),
    mkdir(path.join(root, "goose-private")),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("P7.2 packaged resource reliability smoke", () => {
  it("uses a closed General and Goose result vocabulary", () => {
    expect(P7_RESOURCE_RELIABILITY_CASES).toEqual([
      "P7-R-GENERAL-CPU-001",
      "P7-R-GENERAL-MEMORY-001",
      "P7-R-GOOSE-OUTPUT-001",
      "P7-R-GOOSE-STORAGE-001",
      "P7-R-GOOSE-FORK-001",
    ]);
  });

  it("admits only a fresh contained E2E configuration", async () => {
    const root = await fixtureRoot();
    const environment = {
      ACTESTRA_E2E_TEST: "1",
      ACTESTRA_E2E_ISOLATION_ROOT: root,
      ACTESTRA_USER_DATA_DIR: path.join(root, "user-data"),
      ACTESTRA_E2E_HOME_DIR: path.join(root, "home"),
      ACTESTRA_E2E_TEMP_DIR: path.join(root, "temp"),
      ACTESTRA_P7_RESOURCE_RELIABILITY_SMOKE: "1",
      ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE: path.join(root, "evidence.json"),
      ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE: path.join(root, "general-cpu.cjs"),
      ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE: path.join(root, "general-memory.cjs"),
      ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE: path.join(root, "goose-fork.pl"),
      ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT: path.join(root, "goose-private"),
    };
    await Promise.all([
      writeFile(environment.ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE, "fixture"),
      writeFile(environment.ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE, "fixture"),
      writeFile(environment.ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE, "fixture"),
    ]);

    expect(resolveP7ResourceReliabilitySmokeIsolation(environment)).toEqual({
      root,
      evidence: environment.ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE,
      generalCpuProbe: environment.ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE,
      generalMemoryProbe: environment.ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE,
      gooseForkProbe: environment.ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE,
      goosePrivateRoot: environment.ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT,
    });
    expect(
      resolveP7ResourceReliabilitySmokeIsolation({
        ...environment,
        ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE: path.join(os.tmpdir(), "escaped.cjs"),
      }),
    ).toBeNull();
    expect(
      resolveP7ResourceReliabilitySmokeIsolation({
        ...environment,
        ACTESTRA_E2E_TEST: "0",
      }),
    ).toBeNull();
  });

  it("accepts only exact redacted failed-closed results with verified cleanup", () => {
    const results = [
      {
        id: "P7-R-GENERAL-CPU-001",
        workerKind: "general",
        incidentCode: "worker-resource-cpu-exceeded",
      },
      {
        id: "P7-R-GENERAL-MEMORY-001",
        workerKind: "general",
        incidentCode: "worker-resource-memory-exceeded",
      },
      {
        id: "P7-R-GOOSE-OUTPUT-001",
        workerKind: "goose",
        incidentCode: "worker-resource-output-exceeded",
      },
      {
        id: "P7-R-GOOSE-STORAGE-001",
        workerKind: "goose",
        incidentCode: "worker-resource-storage-exceeded",
      },
      {
        id: "P7-R-GOOSE-FORK-001",
        workerKind: "goose",
        incidentCode: "worker-process-tree-violated",
      },
    ].map((result) => ({
      ...result,
      outcome: "failed-closed",
      terminalState: "failed",
      cleanup: "verified",
      redacted: true,
    }));

    expect(() => assertP7ResourceReliabilityResults(results)).not.toThrow();
    expect(() =>
      assertP7ResourceReliabilityResults([
        ...results.slice(0, -1),
        { ...results.at(-1), cleanup: "skipped" },
      ]),
    ).toThrow("P7.2 resource evidence is incomplete");
    expect(() =>
      assertP7ResourceReliabilityResults([
        ...results,
        { ...results[0], id: "P7-R-UNKNOWN-999", privatePath: "/tmp/secret" },
      ]),
    ).toThrow("P7.2 resource evidence is incomplete");
  });

  it("physically denies Goose fork through the production sandbox profile", async () => {
    if (process.platform !== "darwin") return;
    const root = await fixtureRoot("/private/var/tmp");
    const probe = path.join(root, "goose-fork.pl");
    await writeFile(
      probe,
      `use strict; use warnings;
my ($result) = @ARGV;
my $child = fork();
if (!defined($child)) {
  open(my $fh, '>', $result) or exit 3;
  print $fh 'fork-denied';
  close($fh) or exit 3;
  exit 0;
}
exit 9;`,
    );

    const originalKill = process.kill.bind(process);
    let groupKillCount = 0;
    const kill = vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
      if (processId < 0 && signal === "SIGKILL") {
        groupKillCount += 1;
        return true;
      }
      return originalKill(processId, signal);
    }) as typeof process.kill);
    try {
      await expect(
        runP7GooseForkDenialProbe({
          privateRoot: path.join(root, "goose-private"),
          probePath: probe,
        }),
      ).resolves.toMatchObject({
        id: "P7-R-GOOSE-FORK-001",
        incidentCode: "worker-process-tree-violated",
        cleanup: "verified",
        redacted: true,
      });
    } finally {
      kill.mockRestore();
    }
    expect(groupKillCount).toBe(0);
  });

  it("rejects oversized Goose output and storage with closed metadata", async () => {
    const root = await fixtureRoot();
    await expect(runP7GooseOutputBoundaryProbe()).resolves.toMatchObject({
      id: "P7-R-GOOSE-OUTPUT-001",
      incidentCode: "worker-resource-output-exceeded",
    });
    await expect(
      runP7GooseStorageBoundaryProbe(path.join(root, "goose-private")),
    ).resolves.toMatchObject({
      id: "P7-R-GOOSE-STORAGE-001",
      incidentCode: "worker-resource-storage-exceeded",
      cleanup: "verified",
    });
  });
});
