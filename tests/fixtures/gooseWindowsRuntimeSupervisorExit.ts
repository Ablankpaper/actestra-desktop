import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { classifyGooseWindowsOpeningFailure } from "../../scripts/gooseWindowsRuntimeEvidence.mjs";
import { openGooseMcpSessionComposition } from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";

const execFileAsync = promisify(execFile);

async function findRuntimeProcessIds(executablePath: string): Promise<readonly number[]> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$target = $env:ACTESTRA_GOOSE_WINDOWS_STAGED_EXECUTABLE;",
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.ExecutablePath -eq $target } |",
        "ForEach-Object { $_.ProcessId }",
      ].join(" "),
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        ACTESTRA_GOOSE_WINDOWS_STAGED_EXECUTABLE: executablePath,
      },
      windowsHide: true,
      maxBuffer: 16 * 1024,
    },
  );
  return Object.freeze(
    result.stdout
      .split(/\r?\n/u)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
      .sort((left, right) => left - right),
  );
}

async function waitForRuntimeProcesses(executablePath: string): Promise<readonly number[]> {
  const deadline = Date.now() + 10_000;
  let observed: readonly number[] = [];
  while (Date.now() < deadline) {
    observed = await findRuntimeProcessIds(executablePath);
    if (observed.length >= 2) return observed;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Windows runtime supervisor fixture resolved ${String(observed.length)} of 2 runtime processes`,
  );
}

/**
 * The probe spawns this fixture with every stdio stream ignored, so an
 * unpublished failure would reach CI as an unexplained early exit. Naming the
 * step in a bounded sibling file keeps the reason legible without carrying any
 * private path into the evidence artifact.
 */
async function publishFailureStage(statePath: string, stage: string): Promise<void> {
  await writeFile(`${statePath}.failure`, `${JSON.stringify({ contractVersion: 1, stage })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  }).catch((): undefined => undefined);
}

async function publishFailureDetail(statePath: string, detail: string): Promise<void> {
  if (!/^[a-z0-9-]{1,128}$/u.test(detail)) return;
  await writeFile(
    `${statePath}.failure-detail`,
    `${JSON.stringify({ contractVersion: 1, detail })}\n`,
    { encoding: "utf8", mode: 0o600 },
  ).catch((): undefined => undefined);
}

async function main(): Promise<never> {
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_EXIT !== "1"
  ) {
    throw new Error("Windows runtime supervisor fixture is unavailable");
  }
  const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
  const manifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
  const fixtureRoot = process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_ROOT;
  const statePath = process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_STATE;
  const workspaceDirectory = process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_WORKSPACE;
  if (
    artifactDirectory === undefined ||
    manifestSha256 === undefined ||
    fixtureRoot === undefined ||
    statePath === undefined ||
    workspaceDirectory === undefined
  ) {
    throw new Error("Windows runtime supervisor fixture configuration is invalid");
  }
  await publishFailureStage(statePath, "fixture-artifact-admission");
  const artifact = await admitGooseRunnerArtifact(artifactDirectory, {
    expectedTargetTriple: "x86_64-pc-windows-msvc",
    trustedManifestSha256: manifestSha256,
  });
  if (artifact.containment === undefined) {
    throw new Error("Windows runtime supervisor fixture lacks containment evidence");
  }
  await publishFailureStage(statePath, "fixture-session-open");
  let opened;
  try {
    opened = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent: path.join(fixtureRoot, "attempts"),
      // Keep the fixture on the same admitted isolated coding worktree contract
      // as the main journey; the parent-death probe must not invent a bare cwd.
      workspaceDirectory,
      modelId: "actestra-windows-runtime-parent-death",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "supervisor fixture",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      toolInvoker: async () => {
        throw new Error("Windows runtime supervisor fixture does not invoke tools");
      },
      commandIds: [],
      testIds: [],
      handshakeTimeoutMs: 30_000,
      sessionTimeoutMs: 60_000,
    });
  } catch (error) {
    await publishFailureDetail(statePath, classifyGooseWindowsOpeningFailure(error));
    throw error;
  }
  await publishFailureStage(statePath, "fixture-process-tree");
  const stagedExecutable = path.join(opened.privateRoot, "bin", "actestra-goose-runner.exe");
  const processIds = await waitForRuntimeProcesses(stagedExecutable);
  await publishFailureStage(statePath, "fixture-state-publish");
  await writeFile(
    statePath,
    `${JSON.stringify({ privateRoot: opened.privateRoot, processIds })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return new Promise<never>(() => undefined);
}

await main();
