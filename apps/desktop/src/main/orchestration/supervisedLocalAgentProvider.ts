import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type LocalAgentEngine = "claude-cli" | "codex-cli";
export type LocalAgentCapability = "planner" | "aggregation" | "goose-model";

export interface LocalAgentProviderCatalogEntry {
  readonly contractVersion: 1;
  readonly providerId: `local-agent.${LocalAgentEngine}`;
  readonly engine: LocalAgentEngine;
  readonly version: string;
  readonly capabilities: readonly LocalAgentCapability[];
}

export interface LocalAgentStructuredInvocation {
  readonly capability: LocalAgentCapability;
  readonly model: string;
  readonly prompt: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface LocalAgentStructuredResult {
  readonly provider: LocalAgentProviderCatalogEntry;
  readonly model: string;
  readonly result: unknown;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}

export interface SupervisedLocalAgentProvider {
  readonly catalogEntry: LocalAgentProviderCatalogEntry;
  invokeStructured(input: LocalAgentStructuredInvocation): Promise<LocalAgentStructuredResult>;
  close(): Promise<void>;
}

export interface AdmitSupervisedLocalAgentProviderOptions {
  readonly engine: LocalAgentEngine;
  readonly executable: string;
  readonly workingDirectory: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly terminationGraceMs?: number;
}

export type SupervisedLocalAgentProviderErrorCode =
  | "invalid-config"
  | "admission-failed"
  | "capability-unavailable"
  | "cancelled"
  | "timeout"
  | "provider-failed"
  | "invalid-output"
  | "cleanup-failed"
  | "closed";

export class SupervisedLocalAgentProviderError extends Error {
  constructor(
    readonly code: SupervisedLocalAgentProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupervisedLocalAgentProviderError";
  }
}

interface ValidatedProviderOptions {
  readonly engine: LocalAgentEngine;
  readonly executable: string;
  readonly workingDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly terminationGraceMs: number;
}

interface ProcessResult {
  readonly stdout: string;
}

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const ADMISSION_TIMEOUT_MS = 5_000;
const MAX_DURATION_MS = 120_000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MACOS_DENIED_HOST_READ_ROOTS = Object.freeze([
  "/Users",
  "/Volumes",
  "/private/tmp",
  "/private/var/folders",
  "/Library",
] as const);
const MACOS_NATIVE_EXECUTABLE_MAGICS = Object.freeze(
  new Set(["cffaedfe", "feedfacf", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]),
);

function providerError(
  code: SupervisedLocalAgentProviderErrorCode,
  message: string,
): SupervisedLocalAgentProviderError {
  return new SupervisedLocalAgentProviderError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDuration(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_DURATION_MS) {
    throw providerError("invalid-config", `${label} is invalid`);
  }
  return resolved;
}

function closedEnvironment(
  source: NodeJS.ProcessEnv,
  home: string,
  temporaryDirectory: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: source.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    NO_COLOR: "1",
    TERM: "dumb",
    CI: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_BUG_COMMAND: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
  };
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function sandboxLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function sandboxTraversalPaths(...values: readonly string[]): readonly string[] {
  const traversal = new Set<string>();
  for (const value of values) {
    let current = path.resolve(value);
    while (path.parse(current).root !== current) {
      traversal.add(current);
      current = path.dirname(current);
    }
  }
  return [...traversal];
}

export interface MacosLocalAgentSandboxLaunch {
  readonly executable: "/usr/bin/sandbox-exec";
  readonly args: readonly string[];
  readonly profile: string;
}

export interface MacosLocalAgentSandboxOptions {
  readonly executablePath: string;
  readonly privateRoot: string;
  readonly networkPorts: readonly number[];
}

export function createMacosLocalAgentSandboxLaunch(
  options: MacosLocalAgentSandboxOptions,
): MacosLocalAgentSandboxLaunch {
  if (
    process.platform !== "darwin" ||
    !path.isAbsolute(options.executablePath) ||
    path.resolve(options.executablePath) !== options.executablePath ||
    !path.isAbsolute(options.privateRoot) ||
    path.resolve(options.privateRoot) !== options.privateRoot ||
    options.privateRoot === path.parse(options.privateRoot).root ||
    !Array.isArray(options.networkPorts) ||
    options.networkPorts.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error("Local-Agent macOS sandbox options are invalid");
  }
  const traversalPaths = sandboxTraversalPaths(options.privateRoot, options.executablePath);
  const networkPorts = [...new Set(options.networkPorts)];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny process-exec)",
    "(deny network*)",
    `(deny file-read* ${MACOS_DENIED_HOST_READ_ROOTS.map(
      (root) => `(subpath "${sandboxLiteral(root)}")`,
    ).join(" ")})`,
    "(deny file-write*)",
    `(allow process-exec (literal "${sandboxLiteral(options.executablePath)}"))`,
    `(allow file-read-metadata ${traversalPaths
      .map((root) => `(literal "${sandboxLiteral(root)}")`)
      .join(" ")})`,
    `(allow file-read* (subpath "${sandboxLiteral(options.privateRoot)}") (literal "${sandboxLiteral(options.executablePath)}"))`,
    `(allow file-write* (subpath "${sandboxLiteral(options.privateRoot)}") (literal "/dev/null"))`,
    ...networkPorts.map(
      (port) => `(allow network-outbound (remote ip "localhost:${String(port)}"))`,
    ),
  ].join("");
  return Object.freeze({
    executable: "/usr/bin/sandbox-exec",
    args: Object.freeze(["-p", profile, options.executablePath]),
    profile,
  });
}

async function requirePrivateSubdirectory(root: string, name: "home" | "tmp"): Promise<string> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const [canonical, metadata] = await Promise.all([realpath(directory), stat(directory)]);
  if (
    canonical !== directory ||
    !metadata.isDirectory() ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  ) {
    throw providerError("invalid-config", "Local-Agent provider private directory is unavailable");
  }
  return canonical;
}

async function validateOptions(
  options: AdmitSupervisedLocalAgentProviderOptions,
): Promise<ValidatedProviderOptions> {
  if (
    !isRecord(options) ||
    (options.engine !== "claude-cli" && options.engine !== "codex-cli") ||
    typeof options.executable !== "string" ||
    !path.isAbsolute(options.executable) ||
    typeof options.workingDirectory !== "string" ||
    !path.isAbsolute(options.workingDirectory)
  ) {
    throw providerError("invalid-config", "Local-Agent provider options are invalid");
  }
  const terminationGraceMs = requireDuration(
    options.terminationGraceMs,
    DEFAULT_TERMINATION_GRACE_MS,
    "Local-Agent termination grace",
  );
  await mkdir(options.workingDirectory, { recursive: true, mode: 0o700 });
  const [executable, workingDirectory] = await Promise.all([
    realpath(options.executable),
    realpath(options.workingDirectory),
  ]).catch(() => {
    throw providerError("invalid-config", "Local-Agent provider paths are unavailable");
  });
  const [executableStat, workingDirectoryStat] = await Promise.all([
    stat(executable),
    stat(workingDirectory),
  ]);
  if (
    !executableStat.isFile() ||
    !workingDirectoryStat.isDirectory() ||
    workingDirectory === path.parse(workingDirectory).root ||
    (process.platform !== "win32" && (workingDirectoryStat.mode & 0o077) !== 0)
  ) {
    throw providerError("invalid-config", "Local-Agent provider paths are unsafe");
  }
  await access(executable, 1).catch(() => {
    throw providerError("invalid-config", "Local-Agent provider executable is unavailable");
  });
  const [home, temporaryDirectory] = await Promise.all([
    requirePrivateSubdirectory(workingDirectory, "home"),
    requirePrivateSubdirectory(workingDirectory, "tmp"),
  ]);
  return Object.freeze({
    engine: options.engine,
    executable,
    workingDirectory,
    environment: closedEnvironment(options.environment ?? process.env, home, temporaryDirectory),
    terminationGraceMs,
  });
}

function groupExists(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !groupExists(pid);
}

async function terminateOwnedProcessGroup(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined || !Number.isSafeInteger(pid) || pid < 2) return false;
  if (process.platform === "win32") {
    if (child.exitCode !== null) return false;
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    if (child.exitCode === null) child.kill("SIGKILL");
    return true;
  }
  if (!groupExists(pid)) return false;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw providerError("cleanup-failed", "Local-Agent provider process cleanup failed");
    }
  }
  if (await waitForGroupExit(pid, graceMs)) return true;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw providerError("cleanup-failed", "Local-Agent provider process cleanup failed");
    }
  }
  if (!(await waitForGroupExit(pid, graceMs))) {
    throw providerError("cleanup-failed", "Local-Agent provider process group survived cleanup");
  }
  return true;
}

async function invokeOwnedProcess(options: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
  readonly signal?: AbortSignal;
  readonly sandboxLaunch?: MacosLocalAgentSandboxLaunch;
}): Promise<ProcessResult> {
  if (options.signal?.aborted === true) {
    throw providerError("cancelled", "Local-Agent provider invocation was cancelled");
  }
  let child: ChildProcessWithoutNullStreams;
  const executable = options.sandboxLaunch?.executable ?? options.executable;
  const args =
    options.sandboxLaunch === undefined
      ? options.args
      : [...options.sandboxLaunch.args, ...options.args];
  try {
    child = spawn(executable, [...args], {
      cwd: options.workingDirectory,
      detached: process.platform !== "win32",
      env: options.environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw providerError("provider-failed", "Local-Agent provider process could not start");
  }

  let stdout = Buffer.alloc(0);
  let stderrBytes = 0;
  let stopError: SupervisedLocalAgentProviderError | null = null;
  let termination: Promise<boolean> | null = null;
  const requestStop = (error: SupervisedLocalAgentProviderError): void => {
    if (stopError !== null) return;
    stopError = error;
    termination = terminateOwnedProcessGroup(child, options.terminationGraceMs);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    if (stopError !== null) return;
    if (stdout.byteLength + chunk.byteLength > MAX_STDOUT_BYTES) {
      requestStop(
        providerError("invalid-output", "Local-Agent provider output exceeded its limit"),
      );
      return;
    }
    stdout = Buffer.concat([stdout, chunk]);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes = Math.min(MAX_STDERR_BYTES + 1, stderrBytes + chunk.byteLength);
    if (stderrBytes > MAX_STDERR_BYTES) {
      requestStop(
        providerError("provider-failed", "Local-Agent provider diagnostics exceeded its limit"),
      );
    }
  });
  child.stdin.on("error", () => {
    if (stopError === null) {
      requestStop(providerError("provider-failed", "Local-Agent provider input failed"));
    }
  });

  const closed = new Promise<Readonly<{ code: number | null; spawnFailed: boolean }>>((resolve) => {
    let spawnFailed = false;
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code) => resolve({ code, spawnFailed }));
  });
  const abort = () =>
    requestStop(providerError("cancelled", "Local-Agent provider invocation was cancelled"));
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => requestStop(providerError("timeout", "Local-Agent provider invocation timed out")),
    options.timeoutMs,
  );
  child.stdin.end(options.stdin, "utf8");

  const result = await closed;
  clearTimeout(timeout);
  options.signal?.removeEventListener("abort", abort);
  if (termination !== null) {
    await termination;
  }
  const requestedStop = stopError as SupervisedLocalAgentProviderError | null;
  if (requestedStop !== null) throw requestedStop;
  const removedDescendant = await terminateOwnedProcessGroup(child, options.terminationGraceMs);
  if (removedDescendant) {
    throw providerError(
      "cleanup-failed",
      "Local-Agent provider left a descendant after its leader exited",
    );
  }
  if (result.spawnFailed || result.code !== 0) {
    throw providerError("provider-failed", "Local-Agent provider invocation failed");
  }
  return Object.freeze({ stdout: stdout.toString("utf8") });
}

async function isMacosNativeExecutable(executablePath: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(executablePath, "r");
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    return (
      bytesRead === header.byteLength && MACOS_NATIVE_EXECUTABLE_MAGICS.has(header.toString("hex"))
    );
  } catch {
    return false;
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

function parseVersion(engine: LocalAgentEngine, source: string): string {
  const match =
    engine === "claude-cli"
      ? /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/u.exec(source)
      : /^codex-cli (\d+\.\d+\.\d+)\s*$/u.exec(source);
  if (match?.[1] === undefined) {
    throw providerError("admission-failed", "Local-Agent provider version is incompatible");
  }
  return match[1];
}

function assertCapabilities(
  engine: LocalAgentEngine,
  help: string,
): readonly LocalAgentCapability[] {
  const required =
    engine === "claude-cli"
      ? [
          "--print",
          "--bare",
          "--input-format",
          "--output-format",
          "--json-schema",
          "--tools",
          "--no-session-persistence",
          "--setting-sources",
          "--strict-mcp-config",
          "--no-chrome",
          "--permission-mode",
          "--model",
        ]
      : [
          "--json",
          "--output-schema",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--sandbox",
          "--skip-git-repo-check",
          "--model",
        ];
  if (required.some((flag) => !help.includes(flag))) {
    throw providerError("admission-failed", "Local-Agent provider capabilities are incompatible");
  }
  return Object.freeze([] as const);
}

class AdmittedSupervisedLocalAgentProvider implements SupervisedLocalAgentProvider {
  #closed = false;

  constructor(readonly catalogEntry: LocalAgentProviderCatalogEntry) {}

  async invokeStructured(
    _input: LocalAgentStructuredInvocation,
  ): Promise<LocalAgentStructuredResult> {
    if (this.#closed) {
      throw providerError("closed", "Local-Agent provider is closed");
    }
    throw providerError("capability-unavailable", "Local-Agent provider capability is unavailable");
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }
}

export async function admitSupervisedLocalAgentProvider(
  options: AdmitSupervisedLocalAgentProviderOptions,
): Promise<SupervisedLocalAgentProvider> {
  const validated = await validateOptions(options);
  const nativeExecutable = await isMacosNativeExecutable(validated.executable);
  const sandboxLaunch =
    validated.engine === "claude-cli" && nativeExecutable
      ? createMacosLocalAgentSandboxLaunch({
          executablePath: validated.executable,
          privateRoot: validated.workingDirectory,
          networkPorts: [],
        })
      : undefined;
  const versionOutput = await invokeOwnedProcess({
    executable: validated.executable,
    args: ["--version"],
    workingDirectory: validated.workingDirectory,
    environment: validated.environment,
    stdin: "",
    timeoutMs: ADMISSION_TIMEOUT_MS,
    terminationGraceMs: validated.terminationGraceMs,
    sandboxLaunch,
  }).catch(() => {
    throw providerError("admission-failed", "Local-Agent provider version probe failed");
  });
  const helpOutput = await invokeOwnedProcess({
    executable: validated.executable,
    args: validated.engine === "codex-cli" ? ["exec", "--help"] : ["--help"],
    workingDirectory: validated.workingDirectory,
    environment: validated.environment,
    stdin: "",
    timeoutMs: ADMISSION_TIMEOUT_MS,
    terminationGraceMs: validated.terminationGraceMs,
    sandboxLaunch,
  }).catch(() => {
    throw providerError("admission-failed", "Local-Agent provider capability probe failed");
  });
  const version = parseVersion(validated.engine, versionOutput.stdout);
  const capabilities = assertCapabilities(validated.engine, helpOutput.stdout);
  const catalogEntry = Object.freeze({
    contractVersion: 1 as const,
    providerId: `local-agent.${validated.engine}` as const,
    engine: validated.engine,
    version,
    capabilities,
  });
  return new AdmittedSupervisedLocalAgentProvider(catalogEntry);
}
