import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
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
  while (Date.now() < deadline) {
    const processIds = await findRuntimeProcessIds(executablePath);
    if (processIds.length >= 2) return processIds;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Windows runtime supervisor fixture could not resolve its process tree");
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
  if (
    artifactDirectory === undefined ||
    manifestSha256 === undefined ||
    fixtureRoot === undefined ||
    statePath === undefined
  ) {
    throw new Error("Windows runtime supervisor fixture configuration is invalid");
  }
  const artifact = await admitGooseRunnerArtifact(artifactDirectory, {
    expectedTargetTriple: "x86_64-pc-windows-msvc",
    trustedManifestSha256: manifestSha256,
  });
  if (artifact.containment === undefined) {
    throw new Error("Windows runtime supervisor fixture lacks containment evidence");
  }
  const opened = await openGooseMcpSessionComposition({
    artifact,
    privateRootParent: path.join(fixtureRoot, "attempts"),
    workspaceDirectory: path.join(fixtureRoot, "workspace"),
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
  const stagedExecutable = path.join(opened.privateRoot, "bin", "actestra-goose-runner.exe");
  const processIds = await waitForRuntimeProcesses(stagedExecutable);
  await writeFile(
    statePath,
    `${JSON.stringify({ privateRoot: opened.privateRoot, processIds })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return new Promise<never>(() => undefined);
}

await main();
