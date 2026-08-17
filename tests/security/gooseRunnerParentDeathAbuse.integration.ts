// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { GOOSE_LINUX_EXECUTABLE_PATH } from "../../apps/desktop/src/shared/gooseRunnerLinuxPackage";

const SUPERVISOR_FIXTURE = path.resolve("tests/fixtures/gooseRunnerSupervisorExit.ts");
const fixtureDirectories: string[] = [];
const fixtureProcessGroups = new Set<number>();

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function expectProcessGone(processId: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processIsAlive(processId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(processIsAlive(processId)).toBe(false);
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function readChildLine(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null) {
      reject(new Error("supervisor fixture stdout is unavailable"));
      return;
    }
    let errorOutput = "";
    stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8");
    });
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      stdout.off("data", onData);
      resolve(output.slice(0, newline));
    };
    stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `supervisor exited before readiness (code=${String(code)}, signal=${String(signal)}): ${errorOutput}`,
        ),
      );
    });
  });
}

function cleanupProcessGroup(leaderPid: number): void {
  try {
    process.kill(-leaderPid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

afterEach(async () => {
  for (const processGroupId of fixtureProcessGroups) {
    cleanupProcessGroup(processGroupId);
  }
  fixtureProcessGroups.clear();
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P7 admitted Goose process abuse", () => {
  it("P7-A-PROCESS-002 terminates a real Goose runner when its supervisor dies", async () => {
    const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
    const trustedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
    if (artifactDirectory === undefined || trustedManifestSha256 === undefined) {
      throw new Error("P7 parent-death attack requires the admitted real Goose artifact");
    }
    const artifact = await admitGooseRunnerArtifact(artifactDirectory, {
      trustedManifestSha256,
      expectedTargetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-parent-death-"));
    fixtureDirectories.push(directory);
    const privateRootParent = path.join(directory, "attempts");
    const metadataPath = path.join(directory, "supervisor-options.json");
    const statePath = path.join(directory, "supervisor-state.json");
    await mkdir(privateRootParent);
    await writeFile(
      metadataPath,
      JSON.stringify({
        artifact,
        privateRootParent,
        handshakeTimeoutMs: 20_000,
      }),
    );
    const supervisor = spawn("bun", [SUPERVISOR_FIXTURE, metadataPath, statePath], {
      cwd: path.resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const readyLine = await readChildLine(supervisor);
    expect(readyLine).toBe("READY");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      readonly privateRoot: string;
    };
    const executableNeedle =
      process.platform === "linux"
        ? GOOSE_LINUX_EXECUTABLE_PATH
        : path.join(state.privateRoot, "bin", "actestra-goose-runner");
    const leader = spawnSync("pgrep", ["-f", executableNeedle], { encoding: "utf8" });
    const leaderPid = Number(leader.stdout.trim().split("\n")[0]);
    expect(Number.isSafeInteger(leaderPid)).toBe(true);
    fixtureProcessGroups.add(leaderPid);
    try {
      expect(supervisor.pid).toEqual(expect.any(Number));
      process.kill(supervisor.pid!, "SIGKILL");
      await expect(waitForChildExit(supervisor)).resolves.toBeNull();
      await expectProcessGone(leaderPid);
    } finally {
      cleanupProcessGroup(leaderPid);
      fixtureProcessGroups.delete(leaderPid);
    }
  }, 30_000);
});
