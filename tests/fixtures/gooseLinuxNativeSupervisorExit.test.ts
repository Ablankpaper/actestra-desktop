// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, it, vi } from "vitest";
import { admitInstalledGooseRunnerLinuxPackage } from "../../apps/desktop/src/main/workers/gooseRunnerLinuxPackage";
import { openGooseMcpSessionComposition } from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import {
  GOOSE_LINUX_EXECUTABLE_PATH,
  GOOSE_LINUX_RESOURCES_PATH,
} from "../../apps/desktop/src/shared/gooseRunnerLinuxPackage";

vi.mock("../../apps/desktop/src/main/workers/gooseRunnerTarget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/desktop/src/main/workers/gooseRunnerTarget")>();
  return {
    ...actual,
    resolveGooseRunnerRuntimeTarget(platform: string, architecture: string) {
      return actual.resolveGooseRunnerBuildTarget(platform, architecture);
    },
  };
});

const enabled =
  process.platform === "linux" &&
  process.arch === "x64" &&
  process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION === "1" &&
  process.env.ACTESTRA_GOOSE_NATIVE_SUPERVISOR === "1";
const nativeCommandIds = Object.freeze(["git.status"]);
const nativeTestIds = Object.freeze(["git.diff-check"]);

async function waitForRunner(privateRoot: string): Promise<number> {
  const executableNeedle =
    process.platform === "linux"
      ? GOOSE_LINUX_EXECUTABLE_PATH
      : `${privateRoot}/bin/actestra-goose-runner`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const entries = await readdir("/proc", { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[1-9][0-9]*$/u.test(entry.name)) continue;
      const commandLine = await readFile(path.join("/proc", entry.name, "cmdline")).catch(
        (): undefined => undefined,
      );
      if (commandLine?.includes(Buffer.from(executableNeedle))) {
        return Number(entry.name);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("supervisor fixture could not resolve the staged runner");
}

describe.skipIf(!enabled)("native Linux Goose supervisor-death fixture", () => {
  it(
    "holds one authenticated composition until its process is killed",
    async () => {
      const manifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256!;
      const fixtureRoot = process.env.ACTESTRA_GOOSE_NATIVE_SUPERVISOR_ROOT!;
      const statePath = process.env.ACTESTRA_GOOSE_NATIVE_SUPERVISOR_STATE!;
      const installed = await admitInstalledGooseRunnerLinuxPackage(GOOSE_LINUX_RESOURCES_PATH);
      if (installed === null || installed.artifact.manifestSha256 !== manifestSha256) {
        throw new Error("supervisor fixture Linux Goose package admission failed");
      }
      const admitted = installed.artifact;
      if (admitted.sourceCommit === undefined) {
        throw new Error("supervisor fixture artifact lacks its source commit");
      }
      const probe = await readFile(path.resolve("workers/goose-runner/src/containment/linux.rs"));
      const artifact = Object.freeze({
        ...admitted,
        containment: Object.freeze({
          contractVersion: 1 as const,
          targetTriple: admitted.targetTriple,
          sourceCommit: admitted.sourceCommit,
          probeSha256: createHash("sha256").update(probe).digest("hex"),
          executableSha256: admitted.executableSha256,
          filesystem: true as const,
          network: true as const,
          processTree: true as const,
          resources: true as const,
          parentDeath: true as const,
          cleanup: true as const,
        }),
      });
      const opened = await openGooseMcpSessionComposition({
        artifact,
        privateRootParent: path.join(fixtureRoot, "attempts"),
        workspaceDirectory: path.join(fixtureRoot, "workspace"),
        modelId: "actestra-linux-native-parent-death",
        modelInvoker: async () =>
          Object.freeze({
            type: "message" as const,
            text: "supervisor fixture",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          }),
        toolInvoker: async () => {
          throw new Error("supervisor fixture does not invoke tools");
        },
        commandIds: nativeCommandIds,
        testIds: nativeTestIds,
        handshakeTimeoutMs: 20_000,
        sessionTimeoutMs: 30_000,
      });
      const runnerPid = await waitForRunner(opened.privateRoot);
      await writeFile(
        statePath,
        JSON.stringify({
          privateRoot: opened.privateRoot,
          runnerPid,
          capabilitySocketPath: path.join(opened.privateRoot, "bridge", "capability.sock"),
          modelSocketPath: path.join(opened.privateRoot, "bridge", "model.sock"),
        }),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      process.stdout.write("READY\n");
      await new Promise<never>(() => undefined);
    },
    60 * 60 * 1_000,
  );
});
