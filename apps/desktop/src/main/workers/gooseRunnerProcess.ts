import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { constants as fsConstants, createReadStream, realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Duplex, Readable, Writable } from "node:stream";
import {
  GooseAcpHandshakeError,
  connectGooseAcp,
  type GooseAcpConnection,
  type GooseAcpInfo,
  type GooseAcpPromptOptions,
  type GooseAcpPromptResult,
  type GooseAcpSession,
  type GooseAcpSessionOptions,
  type GooseAcpToolDiscovery,
  type GooseAcpToolDiscoveryOptions,
  type GooseAcpTransport,
} from "./gooseAcpHandshake";
import {
  GOOSE_WORKER_RESOURCE_PROFILE,
  freezeWorkerResourceBudget,
  type WorkerResourceBudget,
} from "../../core";
import type { AdmittedGooseRunnerArtifact } from "./gooseRunnerArtifact";
import {
  assertGooseContainmentLaunch,
  hasVerifiedGooseContainment,
} from "./gooseRunnerContainment";
import { createGooseRunnerSandboxLaunch } from "./gooseRunnerSandbox";
import { GOOSE_LINUX_EXECUTABLE_PATH } from "../../shared/gooseRunnerLinuxPackage";
import {
  isGooseRunnerExecutableAuthorityAdmitted,
  resolveGooseRunnerExecutableAuthority,
  resolveGooseRunnerRuntimeTarget,
  type GooseExecutableAuthority,
} from "./gooseRunnerTarget";
import { GOOSE_WINDOWS_STDIO_CHANNELS } from "./gooseSessionTransport";

const MAX_STDOUT_LINE_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const STDIN_EXIT_OBSERVATION_MS = 100;
const CLOSE_GRACE_MS = 1_000;
const TERMINATE_GRACE_MS = 1_000;
export const GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER =
  "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";
export const GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER =
  "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
export const GOOSE_NATIVE_ASYNC_RUNTIME_FAILURE_MARKER =
  "ACTESTRA_GOOSE_ASYNC_RUNTIME_SETUP_FAILED";
export const GOOSE_NATIVE_ACP_SERVER_FAILURE_MARKER = "ACTESTRA_GOOSE_ACP_SERVER_FAILED";
export const GOOSE_NATIVE_RELAY_FAILURE_MARKER = "ACTESTRA_GOOSE_LINUX_RELAY_STOPPED";
export const GOOSE_NATIVE_PANIC_FAILURE_MARKER = "ACTESTRA_GOOSE_RUNNER_PANICKED";
function windowsRuntimeStageMarker(stage: string): string {
  return `Goose windows containment failed at bounded stage ${stage}`;
}
const GOOSE_WINDOWS_SUPERVISOR_FAILURE_STAGES = Object.freeze([
  "windows-control-channel-invalid",
  "windows-ready-channel-invalid",
  "windows-capability-pipe-invalid",
  "windows-model-pipe-invalid",
  "windows-acp-relay-failed",
  "windows-capability-relay-failed",
  "windows-model-relay-failed",
  "windows-worker-runtime-failed",
  "windows-runtime-timeout",
  "windows-runtime-cleanup-failed",
]);
/**
 * Worker startup stages carry their own closed code all the way to CI evidence.
 * Collapsing them into one token would erase the only signal that distinguishes
 * a capability-pipe ACL rejection from a control-frame or runtime fault.
 */
export const GOOSE_WINDOWS_WORKER_STARTUP_STAGES = Object.freeze([
  "windows-worker-control-frame-invalid",
  "windows-worker-boundary-verification-failed",
  "windows-worker-runtime-creation-failed",
  "windows-worker-capability-pipe-failed",
  "windows-worker-model-pipe-failed",
  "windows-worker-state-directory-failed",
  "windows-worker-ready-signal-failed",
  "windows-worker-acp-handshake-failed",
] as const);
export type GooseRunnerWindowsWorkerStartupFailure =
  (typeof GOOSE_WINDOWS_WORKER_STARTUP_STAGES)[number];
export type GooseRunnerProcessErrorCode =
  | "invalid-options"
  | "artifact-mismatch"
  | "network-policy-unavailable"
  | "worker-resource-enforcement-unavailable"
  | "spawn-failed"
  | "cleanup-failed"
  | GooseRunnerWindowsWorkerStartupFailure;

export class GooseRunnerProcessError extends Error {
  constructor(
    readonly code: GooseRunnerProcessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseRunnerProcessError";
  }
}

export interface GooseAcpSpawnOptions {
  readonly executablePath: string;
  readonly executableAuthority?: GooseExecutableAuthority;
  readonly workingDirectory: string;
  readonly workspaceDirectory?: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly resourceBudget: WorkerResourceBudget;
  readonly networkPolicy:
    | "deny-all"
    | {
        readonly kind: "loopback-session";
        readonly host: "127.0.0.1";
        readonly capabilityProxyPort: number;
        readonly modelProxyPort: number;
      };
  readonly windows?: Readonly<{
    readonly supervisorMode: "--actestra-windows-supervisor-v1";
    readonly capabilityPipeName: string;
    readonly modelPipeName: string;
    readonly attemptLease: string;
    readonly attemptId: string;
    readonly executableSha256: string;
    readonly modelId: string;
    readonly targetTriple: "x86_64-pc-windows-msvc";
  }>;
  readonly attachWindowsChannels?: (channels: GooseWindowsSupervisorChannels) => void;
}

export type GooseAcpTransportFactory = (options: GooseAcpSpawnOptions) => GooseAcpTransport;

export interface GooseRunnerResourceFailureMatcher {
  push(chunk: Uint8Array): boolean;
}

export interface GooseRunnerSetupFailureMatcher {
  push(chunk: Uint8Array): GooseRunnerSetupFailure | undefined;
}

export type GooseRunnerSetupFailure =
  | "network-policy-unavailable"
  | "worker-resource-enforcement-unavailable"
  | "runner-runtime"
  | "runner-acp"
  | "runner-relay"
  | "runner-panic"
  | "windows-runtime"
  | GooseRunnerWindowsWorkerStartupFailure;

type GooseChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export interface GooseWindowsSupervisorChannels {
  readonly capability: Duplex;
  readonly model: Duplex;
}

export interface GooseAcpLaunchCommand {
  readonly command: string;
  readonly arguments: readonly string[];
}

const WINDOWS_CONTROL_MAX_BYTES = 32 * 1024;

export interface GooseRunnerModelBinding {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly attemptLease: string;
}

export interface GooseRunnerPreparedRoot {
  readonly root: string;
  readonly bridgeDirectory: string;
  readonly executableAuthority?: GooseExecutableAuthority;
  readonly executablePath: string;
  readonly workingDirectory: string;
}

export interface GooseRunnerPreparedBridge {
  readonly capabilityProxyUrl?: string;
  readonly modelBinding?: GooseRunnerModelBinding;
  readonly capabilitySocketPath?: string;
  readonly modelSocketPath?: string;
  readonly windows?: GooseRunnerWindowsBridgeEnvironment;
  readonly modelId?: string;
  readonly attachWindowsChannels?: (channels: GooseWindowsSupervisorChannels) => void;
  close(): Promise<void>;
}

export interface GooseRunnerLinuxBridgeEnvironment {
  readonly capabilitySocketPath: string;
  readonly modelSocketPath: string;
  readonly capabilityPort: number;
  readonly modelPort: number;
  readonly workspaceRoot: string;
}

export interface GooseRunnerWindowsBridgeEnvironment {
  readonly capabilityPipeName: string;
  readonly modelPipeName: string;
  readonly attemptLease: string;
}

export type GooseRunnerBridgeFactory = (
  root: GooseRunnerPreparedRoot,
) => Promise<GooseRunnerPreparedBridge>;

export interface OpenGooseRunnerHandshakeOptions {
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly workspaceDirectory?: string;
  readonly capabilityProxyUrl?: string;
  readonly modelBinding?: GooseRunnerModelBinding;
  readonly prepareBridge?: GooseRunnerBridgeFactory;
  readonly handshakeTimeoutMs?: number;
  readonly transportFactory?: GooseAcpTransportFactory;
}

export interface OpenGooseRunnerHandshakeResult {
  readonly info: GooseAcpInfo;
  readonly privateRoot: string;
  openSession(options: GooseAcpSessionOptions): Promise<GooseAcpSession>;
  discoverTools(options: GooseAcpToolDiscoveryOptions): Promise<GooseAcpToolDiscovery>;
  prompt(options: GooseAcpPromptOptions): Promise<GooseAcpPromptResult>;
  close(): Promise<void>;
}

export interface GooseRunnerProcessDependencies {
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
}

const DEFAULT_PROCESS_DEPENDENCIES: GooseRunnerProcessDependencies = Object.freeze({
  platform: process.platform,
  architecture: process.arch,
});

function isAbsoluteDirectory(value: string): boolean {
  return typeof value === "string" && path.isAbsolute(value);
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

export function createGooseRunnerEnvironment(
  privateRoot: string,
  modelBinding?: GooseRunnerModelBinding,
  linuxBridge?: GooseRunnerLinuxBridgeEnvironment,
): Readonly<Record<string, string>> {
  if (!isAbsoluteDirectory(privateRoot)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose private root must be an absolute path",
    );
  }
  const stableModelBinding =
    modelBinding === undefined ? undefined : validateModelBinding(modelBinding).binding;
  const stableLinuxBridge =
    linuxBridge === undefined
      ? undefined
      : validateLinuxBridgeEnvironment(privateRoot, linuxBridge);
  const temporaryDirectory = path.join(privateRoot, "tmp");
  const localAppDataDirectory = path.join(privateRoot, "local-app-data");
  // Main constructs a strict whitelist environment for the supervisor process.
  // On Windows, the supervisor then inherits this cleaned environment to the Worker
  // (lpEnvironment=nullptr), because sparse hand-built environment blocks fail
  // AppContainer process initialization with ERROR_ENVVAR_NOT_FOUND.
  // On macOS/Linux, the Worker receives this exact environment through Node spawn.
  return Object.freeze({
    GOOSE_PATH_ROOT: privateRoot,
    GOOSE_TELEMETRY_OFF: "1",
    GOOSE_DISABLE_KEYRING: "1",
    GOOSE_DISABLE_SESSION_NAMING: "true",
    HOME: path.join(privateRoot, "home"),
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    // Windows AppContainer process creation requires this value; keep it attempt-private.
    LOCALAPPDATA: localAppDataDirectory,
    TZ: "UTC",
    OTEL_SDK_DISABLED: "true",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    ACTESTRA_GOOSE_CPU_SECONDS: String(GOOSE_WORKER_RESOURCE_PROFILE.maxCpuSeconds),
    ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES: String(GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateMemoryBytes),
    ...(stableModelBinding === undefined
      ? {}
      : {
          GOOSE_PROVIDER: "openai",
          GOOSE_MODEL: stableModelBinding.modelId,
          OPENAI_BASE_URL: stableModelBinding.baseUrl,
          OPENAI_API_KEY: stableModelBinding.attemptLease,
          NO_PROXY: "127.0.0.1,localhost",
        }),
    ...(stableLinuxBridge === undefined
      ? {}
      : {
          ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET: stableLinuxBridge.capabilitySocketPath,
          ACTESTRA_GOOSE_LINUX_MODEL_SOCKET: stableLinuxBridge.modelSocketPath,
          ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT: String(stableLinuxBridge.capabilityPort),
          ACTESTRA_GOOSE_LINUX_MODEL_PORT: String(stableLinuxBridge.modelPort),
          ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT: stableLinuxBridge.workspaceRoot,
        }),
  });
}

function hasExactGooseResourceBudget(value: WorkerResourceBudget): boolean {
  return (
    value.maxActiveDurationMs === GOOSE_WORKER_RESOURCE_PROFILE.maxActiveDurationMs &&
    value.maxCpuSeconds === GOOSE_WORKER_RESOURCE_PROFILE.maxCpuSeconds &&
    value.maxPrivateMemoryBytes === GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateMemoryBytes &&
    value.maxOutputBytes === GOOSE_WORKER_RESOURCE_PROFILE.maxOutputBytes &&
    value.maxPrivateStorageBytes === GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateStorageBytes &&
    value.maxChildProcesses === GOOSE_WORKER_RESOURCE_PROFILE.maxChildProcesses
  );
}

function hasExactWindowsSupervisorSpawnContract(options: GooseAcpSpawnOptions): boolean {
  const windows = options.windows;
  if (
    windows === undefined ||
    !Object.isFrozen(windows) ||
    Reflect.ownKeys(windows).length !== 8 ||
    Reflect.ownKeys(windows).some(
      (key) =>
        typeof key !== "string" ||
        ![
          "attemptLease",
          "attemptId",
          "capabilityPipeName",
          "executableSha256",
          "modelId",
          "modelPipeName",
          "supervisorMode",
          "targetTriple",
        ].includes(key),
    ) ||
    windows.supervisorMode !== "--actestra-windows-supervisor-v1" ||
    options.networkPolicy !== "deny-all"
  ) {
    return false;
  }
  const validPipeName = (pipeName: string): boolean =>
    /^\\\\\.\\pipe\\LOCAL\\Actestra\.Goose\.[A-Za-z0-9._-]{16,128}$/.test(pipeName) &&
    Buffer.byteLength(pipeName, "utf8") <= 180;
  if (
    !validPipeName(windows.capabilityPipeName) ||
    !validPipeName(windows.modelPipeName) ||
    windows.capabilityPipeName === windows.modelPipeName ||
    !/^[a-f0-9]{32}$/.test(windows.attemptId) ||
    !/^[a-f0-9]{64}$/.test(windows.executableSha256) ||
    windows.modelId.length < 1 ||
    windows.modelId.length > 256 ||
    Array.from(windows.modelId).some((character) => /\p{Cc}/u.test(character)) ||
    windows.targetTriple !== "x86_64-pc-windows-msvc" ||
    windows.attemptLease.length < 32 ||
    windows.attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(windows.attemptLease)
  ) {
    return false;
  }
  const forbiddenEnvironmentKeys = [
    "GOOSE_PROVIDER",
    "GOOSE_MODEL",
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "NO_PROXY",
    "ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET",
    "ACTESTRA_GOOSE_LINUX_MODEL_SOCKET",
    "ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT",
    "ACTESTRA_GOOSE_LINUX_MODEL_PORT",
    "ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT",
  ];
  if (forbiddenEnvironmentKeys.some((key) => Object.hasOwn(options.environment, key))) {
    return false;
  }
  const environmentValues = new Set(Object.values(options.environment));
  return (
    !environmentValues.has(windows.attemptLease) &&
    !environmentValues.has(windows.capabilityPipeName) &&
    !environmentValues.has(windows.modelPipeName)
  );
}

/** Validates Main-created native limit inputs immediately before process launch. */
export function assertGooseAcpSpawnOptions(
  options: GooseAcpSpawnOptions | undefined,
): asserts options is GooseAcpSpawnOptions {
  if (
    options === undefined ||
    !Object.isFrozen(options) ||
    !Object.isFrozen(options.environment) ||
    !Object.isFrozen(options.resourceBudget)
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose native resource launch options must be immutable",
    );
  }
  try {
    freezeWorkerResourceBudget(options.resourceBudget);
  } catch {
    throw new GooseRunnerProcessError("invalid-options", "Goose native resource budget is invalid");
  }
  if (!hasExactGooseResourceBudget(options.resourceBudget)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose native resource budget differs from the admitted profile",
    );
  }
  if (
    options.environment.ACTESTRA_GOOSE_CPU_SECONDS !==
      String(options.resourceBudget.maxCpuSeconds) ||
    options.environment.ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES !==
      String(options.resourceBudget.maxPrivateMemoryBytes)
  ) {
    throw new GooseRunnerProcessError(
      "worker-resource-enforcement-unavailable",
      "Goose native resource limits are unavailable before launch",
    );
  }
  if (
    options.executableAuthority !== undefined &&
    options.executableAuthority !== "attempt-private" &&
    options.executableAuthority !== "linux-package" &&
    options.executableAuthority !== "windows-supervisor"
  ) {
    throw new GooseRunnerProcessError("invalid-options", "Goose executable authority is invalid");
  }
  if (
    options.executableAuthority === "windows-supervisor" &&
    !hasExactWindowsSupervisorSpawnContract(options)
  ) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "Windows Goose launch requires the exact admitted supervisor contract",
    );
  }
  if (options.executableAuthority !== "windows-supervisor" && options.windows !== undefined) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Windows Goose supervisor metadata is unavailable for this executable authority",
    );
  }
}

/**
 * Recognizes only the runner's fixed setup marker. Its state retains no stderr
 * content, so native diagnostic text never crosses the process boundary.
 */
function createGooseRunnerFixedMarkerMatcher(
  markerText: string,
): GooseRunnerResourceFailureMatcher {
  const marker = Buffer.from(markerText, "utf8");
  const fallback = new Uint8Array(marker.length);
  for (let index = 1, prefixLength = 0; index < marker.length; ) {
    if (marker[index] === marker[prefixLength]) {
      prefixLength += 1;
      fallback[index] = prefixLength;
      index += 1;
    } else if (prefixLength > 0) {
      prefixLength = fallback[prefixLength - 1] ?? 0;
    } else {
      index += 1;
    }
  }
  let matched = 0;
  let detected = false;
  return Object.freeze({
    push(chunk: Uint8Array): boolean {
      if (detected) return true;
      for (const byte of chunk) {
        while (matched > 0 && byte !== marker[matched]) {
          matched = fallback[matched - 1] ?? 0;
        }
        if (byte === marker[matched]) {
          matched += 1;
          if (matched === marker.length) {
            detected = true;
            return true;
          }
        }
      }
      return false;
    },
  });
}

export function createGooseRunnerResourceFailureMatcher(): GooseRunnerResourceFailureMatcher {
  return createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER);
}

export function createGooseRunnerSetupFailureMatcher(): GooseRunnerSetupFailureMatcher {
  const network = createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER);
  const resources = createGooseRunnerResourceFailureMatcher();
  const runtime = createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_ASYNC_RUNTIME_FAILURE_MARKER);
  const acp = createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_ACP_SERVER_FAILURE_MARKER);
  const relay = createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_RELAY_FAILURE_MARKER);
  const panic = createGooseRunnerFixedMarkerMatcher(GOOSE_NATIVE_PANIC_FAILURE_MARKER);
  const windowsRuntime = GOOSE_WINDOWS_SUPERVISOR_FAILURE_STAGES.map((stage) =>
    createGooseRunnerFixedMarkerMatcher(windowsRuntimeStageMarker(stage)),
  );
  const windowsWorkerStartup = GOOSE_WINDOWS_WORKER_STARTUP_STAGES.map(
    (stage) =>
      [stage, createGooseRunnerFixedMarkerMatcher(windowsRuntimeStageMarker(stage))] as const,
  );
  let detected: GooseRunnerSetupFailure | undefined;
  return Object.freeze({
    push(chunk: Uint8Array) {
      if (detected !== undefined) return detected;
      if (network.push(chunk)) {
        detected = "network-policy-unavailable";
      } else if (resources.push(chunk)) {
        detected = "worker-resource-enforcement-unavailable";
      } else if (runtime.push(chunk)) {
        detected = "runner-runtime";
      } else if (acp.push(chunk)) {
        detected = "runner-acp";
      } else if (relay.push(chunk)) {
        detected = "runner-relay";
      } else if (panic.push(chunk)) {
        detected = "runner-panic";
      } else {
        let workerStartup: GooseRunnerWindowsWorkerStartupFailure | undefined;
        for (const [stage, matcher] of windowsWorkerStartup) {
          if (matcher.push(chunk)) workerStartup ??= stage;
        }
        const supervisorRuntime = windowsRuntime.reduce(
          (seen, matcher) => matcher.push(chunk) || seen,
          false,
        );
        if (workerStartup !== undefined) {
          detected = workerStartup;
        } else if (supervisorRuntime) {
          detected = "windows-runtime";
        }
      }
      return detected;
    },
  });
}

function setupFailureError(failure: GooseRunnerSetupFailure): GooseRunnerProcessError {
  if (failure === "network-policy-unavailable") {
    return new GooseRunnerProcessError(failure, "Goose native network policy is unavailable");
  }
  if (failure === "worker-resource-enforcement-unavailable") {
    return new GooseRunnerProcessError(failure, "Goose native resource enforcement is unavailable");
  }
  if (
    (GOOSE_WINDOWS_WORKER_STARTUP_STAGES as readonly string[]).includes(failure) &&
    failure !== "windows-runtime"
  ) {
    return new GooseRunnerProcessError(
      failure as GooseRunnerWindowsWorkerStartupFailure,
      "Goose Windows worker startup failed",
    );
  }
  const message =
    failure === "runner-runtime"
      ? "Goose async runtime failed"
      : failure === "runner-acp"
        ? "Goose ACP server failed"
        : failure === "runner-relay"
          ? "Goose Linux relay stopped"
          : failure === "runner-panic"
            ? "Goose runner panicked"
            : "Goose Windows runtime failed";
  return new GooseRunnerProcessError("spawn-failed", message);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function signalProcessGroup(child: GooseChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function processGroupIsAlive(child: GooseChildProcess, leaderHasExited: () => boolean): boolean {
  if (child.pid === undefined) {
    return false;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return !leaderHasExited();
    }
    throw error;
  }
}

async function waitForProcessGroupExit(
  child: GooseChildProcess,
  milliseconds: number,
  leaderHasExited: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (processGroupIsAlive(child, leaderHasExited)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await wait(Math.min(remaining, 10));
  }
  return true;
}

function exactLoopbackMcpPort(url: string): number | undefined {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/mcp$/.exec(url);
  if (match === null) {
    return undefined;
  }
  const port = Number(match[1]);
  return port <= 65_535 ? port : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateModelBinding(modelBinding: GooseRunnerModelBinding): {
  readonly binding: GooseRunnerModelBinding;
  readonly port: number;
} {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/v1$/.exec(modelBinding.baseUrl);
  const port = match === null ? 0 : Number(match[1]);
  if (
    port < 1 ||
    port > 65_535 ||
    typeof modelBinding.modelId !== "string" ||
    modelBinding.modelId.length < 1 ||
    modelBinding.modelId.length > 256 ||
    !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(modelBinding.modelId) ||
    typeof modelBinding.attemptLease !== "string" ||
    modelBinding.attemptLease.length < 32 ||
    modelBinding.attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(modelBinding.attemptLease)
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose runner model binding must use the exact admitted loopback model endpoint and opaque lease",
    );
  }
  return Object.freeze({
    binding: Object.freeze({
      baseUrl: modelBinding.baseUrl,
      modelId: modelBinding.modelId,
      attemptLease: modelBinding.attemptLease,
    }),
    port,
  });
}

function validatePreparedBridge(
  root: GooseRunnerPreparedRoot,
  value: unknown,
): GooseRunnerPreparedBridge {
  if (!isRecord(value)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory must return an object",
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 2 ||
    keys.length > 9 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        ![
          "capabilityProxyUrl",
          "modelBinding",
          "capabilitySocketPath",
          "modelSocketPath",
          "modelId",
          "windows",
          "attachWindowsChannels",
          "close",
        ].includes(key),
    )
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned unsupported fields",
    );
  }
  const capabilityProxyUrl = value.capabilityProxyUrl;
  const capabilitySocketPath = value.capabilitySocketPath;
  const modelSocketPath = value.modelSocketPath;
  const windows = value.windows;
  const modelId = value.modelId;
  const attachWindowsChannels = value.attachWindowsChannels;
  const close = value.close;
  if (typeof close !== "function") {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned an invalid endpoint contract",
    );
  }
  if (windows !== undefined) {
    if (typeof attachWindowsChannels !== "function") {
      throw new GooseRunnerProcessError(
        "invalid-options",
        "Windows Goose bridge factory must attach the authenticated channels",
      );
    }
    return Object.freeze({
      windows: validateWindowsBridgeEnvironment(windows),
      modelId:
        typeof modelId === "string" && modelId.length > 0 && modelId.length <= 256
          ? modelId
          : (() => {
              throw new GooseRunnerProcessError(
                "invalid-options",
                "Windows Goose bridge factory must return the admitted model identifier",
              );
            })(),
      attachWindowsChannels: attachWindowsChannels as (
        channels: GooseWindowsSupervisorChannels,
      ) => void,
      close: close as () => Promise<void>,
    });
  }
  if (
    typeof capabilityProxyUrl !== "string" ||
    typeof capabilitySocketPath !== "string" ||
    typeof modelSocketPath !== "string"
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned an invalid endpoint contract",
    );
  }
  const bridgeDirectory = path.join(root.root, "bridge");
  const validSocketPath = (socketPath: string): boolean =>
    path.isAbsolute(socketPath) &&
    path.resolve(socketPath) === socketPath &&
    !socketPath.includes("\0") &&
    Buffer.byteLength(socketPath, "utf8") <= 103 &&
    path.dirname(socketPath) === bridgeDirectory;
  if (
    !validSocketPath(capabilitySocketPath) ||
    !validSocketPath(modelSocketPath) ||
    capabilitySocketPath === modelSocketPath
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned sockets outside the prepared bridge",
    );
  }
  const capabilityPort = exactLoopbackMcpPort(capabilityProxyUrl);
  let modelBinding: { readonly binding: GooseRunnerModelBinding; readonly port: number };
  try {
    modelBinding = validateModelBinding(value.modelBinding as GooseRunnerModelBinding);
  } catch (error) {
    if (error instanceof GooseRunnerProcessError) {
      throw error;
    }
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned an invalid model binding",
      { cause: error },
    );
  }
  if (capabilityPort === undefined || capabilityPort === modelBinding.port) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory returned ambiguous loopback endpoints",
    );
  }
  return Object.freeze({
    capabilityProxyUrl,
    modelBinding: modelBinding.binding,
    capabilitySocketPath,
    modelSocketPath,
    ...(windows === undefined ? {} : { windows: validateWindowsBridgeEnvironment(windows) }),
    ...(attachWindowsChannels === undefined
      ? {}
      : {
          attachWindowsChannels: attachWindowsChannels as (
            channels: GooseWindowsSupervisorChannels,
          ) => void,
        }),
    ...(modelId === undefined ? {} : { modelId: modelId as string }),
    close: close as () => Promise<void>,
  });
}

function validateWindowsBridgeEnvironment(value: unknown): GooseRunnerWindowsBridgeEnvironment {
  if (!isRecord(value)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Windows bridge environment must be an object",
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !["attemptLease", "capabilityPipeName", "modelPipeName"].includes(key),
    )
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Windows bridge environment contains unsupported fields",
    );
  }
  const { capabilityPipeName, modelPipeName, attemptLease } = value;
  const validPipeName = (pipeName: unknown): pipeName is string =>
    typeof pipeName === "string" &&
    /^\\\\\.\\pipe\\LOCAL\\Actestra\.Goose\.[a-f0-9]{32}\.(?:capability|model)$/.test(pipeName) &&
    Buffer.byteLength(pipeName, "utf8") <= 180;
  if (
    !validPipeName(capabilityPipeName) ||
    !validPipeName(modelPipeName) ||
    capabilityPipeName === modelPipeName ||
    !capabilityPipeName.endsWith(".capability") ||
    !modelPipeName.endsWith(".model") ||
    capabilityPipeName.slice(0, -"capability".length) !== modelPipeName.slice(0, -"model".length) ||
    typeof attemptLease !== "string" ||
    attemptLease.length < 32 ||
    attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(attemptLease)
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Windows bridge environment is invalid",
    );
  }
  return Object.freeze({ capabilityPipeName, modelPipeName, attemptLease });
}

function windowsBridgeAttemptId(value: GooseRunnerWindowsBridgeEnvironment): string {
  const match = value.capabilityPipeName.match(
    /^\\\\\.\\pipe\\LOCAL\\Actestra\.Goose\.([a-f0-9]{32})\.capability$/,
  );
  if (match?.[1] === undefined) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Windows bridge attempt identity is invalid",
    );
  }
  return match[1];
}

function validateLinuxBridgeEnvironment(
  privateRoot: string,
  value: GooseRunnerLinuxBridgeEnvironment,
): GooseRunnerLinuxBridgeEnvironment {
  if (!isRecord(value)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Linux bridge environment must be an object",
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 5 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        ![
          "capabilitySocketPath",
          "modelSocketPath",
          "capabilityPort",
          "modelPort",
          "workspaceRoot",
        ].includes(key),
    )
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Linux bridge environment contains unsupported fields",
    );
  }
  const { capabilitySocketPath, modelSocketPath, capabilityPort, modelPort, workspaceRoot } = value;
  const bridgeDirectory = path.join(privateRoot, "bridge");
  const validSocketPath = (socketPath: unknown): socketPath is string =>
    typeof socketPath === "string" &&
    path.isAbsolute(socketPath) &&
    path.resolve(socketPath) === socketPath &&
    !socketPath.includes("\0") &&
    Buffer.byteLength(socketPath, "utf8") <= 103 &&
    path.dirname(socketPath) === bridgeDirectory;
  const validPort = (port: unknown): port is number =>
    Number.isSafeInteger(port) && (port as number) >= 1 && (port as number) <= 65_535;
  if (
    !validSocketPath(capabilitySocketPath) ||
    !validSocketPath(modelSocketPath) ||
    capabilitySocketPath === modelSocketPath ||
    !validPort(capabilityPort) ||
    !validPort(modelPort) ||
    capabilityPort === modelPort ||
    typeof workspaceRoot !== "string" ||
    !path.isAbsolute(workspaceRoot) ||
    path.resolve(workspaceRoot) !== workspaceRoot ||
    path.parse(workspaceRoot).root === workspaceRoot ||
    workspaceRoot.includes("\0") ||
    Buffer.byteLength(workspaceRoot, "utf8") > 4 * 1024
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose Linux bridge environment is invalid",
    );
  }
  return Object.freeze({
    capabilitySocketPath,
    modelSocketPath,
    capabilityPort,
    modelPort,
    workspaceRoot,
  });
}

function macosNetworkProfile(options: GooseAcpSpawnOptions): string | undefined {
  const ports: number[] = [];
  if (options.networkPolicy !== "deny-all") {
    const policy = options.networkPolicy;
    if (
      policy.kind !== "loopback-session" ||
      policy.host !== "127.0.0.1" ||
      !Number.isSafeInteger(policy.capabilityProxyPort) ||
      policy.capabilityProxyPort < 1 ||
      policy.capabilityProxyPort > 65_535 ||
      !Number.isSafeInteger(policy.modelProxyPort) ||
      policy.modelProxyPort < 1 ||
      policy.modelProxyPort > 65_535
    ) {
      return undefined;
    }
    ports.push(policy.capabilityProxyPort, policy.modelProxyPort);
  }
  if (!path.isAbsolute(options.workingDirectory) || !path.isAbsolute(options.executablePath)) {
    return undefined;
  }
  const privateRoot = realpathSync(path.dirname(options.workingDirectory));
  const executablePath = realpathSync(options.executablePath);
  const launch = createGooseRunnerSandboxLaunch({
    executablePath,
    privateRoot,
    networkPorts: ports,
  });
  if (options.workspaceDirectory === undefined) {
    return launch.profile;
  }
  const workspaceDirectory = realpathSync(options.workspaceDirectory);
  const traversalPaths = sandboxTraversalPaths(workspaceDirectory);
  return `${launch.profile}(allow file-read-metadata ${traversalPaths
    .map((root) => `(literal "${sandboxLiteral(root)}")`)
    .join(" ")})(allow file-read* (subpath "${sandboxLiteral(workspaceDirectory)}"))`;
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

class NodeGooseAcpTransport implements GooseAcpTransport {
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>();
  private readonly exitPromise: Promise<void>;
  private readonly nativeSetupFailureMatcher = createGooseRunnerSetupFailureMatcher();
  private stdoutBuffer = "";
  private stderrBytes = 0;
  private exited = false;
  private transportFailed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly child: GooseChildProcess,
    private readonly parentLiveness?: Writable,
    readonly windowsChannels?: GooseWindowsSupervisorChannels,
  ) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      if (Buffer.byteLength(this.stdoutBuffer, "utf8") > MAX_STDOUT_LINE_BYTES) {
        this.failTransport(new Error("Goose ACP stdout line exceeded the bounded frame size"));
        return;
      }
      let newline = this.stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (line.length > 0) {
          for (const listener of this.lineListeners) {
            listener(line);
          }
        }
        newline = this.stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const setupFailure = this.nativeSetupFailureMatcher.push(chunk);
      if (setupFailure !== undefined) {
        this.failTransport(setupFailureError(setupFailure));
        return;
      }
      this.stderrBytes += chunk.byteLength;
      if (this.stderrBytes > MAX_STDERR_BYTES) {
        this.failTransport(new Error("Goose stderr exceeded the bounded diagnostic size"));
      }
    });
    child.stdin.on("error", (error) => {
      const failure = new Error("Goose stdin stream failed", { cause: error });
      const observation = setTimeout(() => {
        if (!this.exited) this.failTransport(failure);
      }, STDIN_EXIT_OBSERVATION_MS);
      observation.unref();
    });
    for (const [stream, message] of [
      [child.stdout, "Goose stdout stream failed"],
      [child.stderr, "Goose stderr stream failed"],
    ] as const) {
      stream.on("error", (error) => {
        this.failTransport(new Error(message, { cause: error }));
      });
    }
    child.once("error", (error) => {
      this.failTransport(new Error("Goose child process emitted an error", { cause: error }));
    });
    this.exitPromise = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.exited = true;
        for (const listener of this.exitListeners) {
          listener(code, signal);
        }
        resolve();
      });
    });
  }

  sendLine(line: string): void {
    if (this.exited || this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new GooseRunnerProcessError("spawn-failed", "Goose stdin is not writable");
    }
    this.child.stdin.write(`${line}\n`);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => {
      this.lineListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onExit(listener: (code: number | null, signal: string | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeProcess();
    return this.closePromise;
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private failTransport(error: Error): void {
    if (this.transportFailed) {
      return;
    }
    this.transportFailed = true;
    this.emitError(error);
    void this.close().catch((closeError: unknown) => {
      this.emitError(closeError instanceof Error ? closeError : new Error(String(closeError)));
    });
  }

  private async waitForProcessTreeExit(milliseconds: number): Promise<boolean> {
    if (process.platform !== "win32") {
      return waitForProcessGroupExit(this.child, milliseconds, () => this.exited);
    }
    if (this.exited) return true;
    await Promise.race([this.exitPromise, wait(milliseconds)]);
    return this.exited;
  }

  private async closeProcess(): Promise<void> {
    this.parentLiveness?.end();
    this.windowsChannels?.capability.end();
    this.windowsChannels?.model.end();
    this.child.stdin.end();
    if (await this.waitForProcessTreeExit(CLOSE_GRACE_MS)) {
      return;
    }
    signalProcessGroup(this.child, "SIGTERM");
    if (await this.waitForProcessTreeExit(TERMINATE_GRACE_MS)) {
      return;
    }
    signalProcessGroup(this.child, "SIGKILL");
    if (!(await this.waitForProcessTreeExit(TERMINATE_GRACE_MS))) {
      throw new GooseRunnerProcessError(
        "cleanup-failed",
        "Goose process group did not exit after forced termination",
      );
    }
  }
}

export function encodeWindowsSupervisorControlFrame(options: GooseAcpSpawnOptions): Uint8Array {
  assertGooseAcpSpawnOptions(options);
  const windows = options.windows;
  const workspaceDirectory = options.workspaceDirectory;
  if (
    options.executableAuthority !== "windows-supervisor" ||
    windows === undefined ||
    workspaceDirectory === undefined ||
    !path.isAbsolute(workspaceDirectory) ||
    path.parse(workspaceDirectory).root === workspaceDirectory
  ) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "Windows Goose control requires the exact admitted supervisor contract",
    );
  }
  const payload = Buffer.from(
    JSON.stringify({
      attemptId: windows.attemptId,
      attemptLease: windows.attemptLease,
      contractVersion: 1,
      executableSha256: windows.executableSha256,
      modelId: windows.modelId,
      privateRoot: path.dirname(options.workingDirectory),
      resourceBudget: options.resourceBudget,
      targetTriple: windows.targetTriple,
      worktreeRoot: workspaceDirectory,
    }),
    "utf8",
  );
  if (payload.byteLength === 0 || payload.byteLength > WINDOWS_CONTROL_MAX_BYTES) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Windows Goose control exceeded the bounded contract",
    );
  }
  const frame = Buffer.alloc(payload.byteLength + 4);
  frame.writeUInt32LE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

export function resolveGooseAcpLaunchCommand(
  options: GooseAcpSpawnOptions,
  dependencies: GooseRunnerProcessDependencies = DEFAULT_PROCESS_DEPENDENCIES,
): GooseAcpLaunchCommand {
  assertGooseAcpSpawnOptions(options);
  if (!path.isAbsolute(options.executablePath) || !path.isAbsolute(options.workingDirectory)) {
    throw new GooseRunnerProcessError("invalid-options", "Goose spawn options are invalid");
  }
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.architecture ?? process.arch;
  const privateRoot = path.dirname(options.workingDirectory);
  const executableAuthority =
    options.executableAuthority ??
    (platform === "darwin" ? ("attempt-private" as const) : undefined);
  if (!isGooseRunnerExecutableAuthorityAdmitted(platform, architecture, executableAuthority)) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "Goose launch requires the exact executable authority for this host",
    );
  }
  if (
    executableAuthority === "attempt-private" &&
    path.dirname(path.dirname(options.executablePath)) !== privateRoot
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose executable and working directory must share one private root",
    );
  }
  if (
    executableAuthority === "linux-package" &&
    (platform !== "linux" || options.executablePath !== GOOSE_LINUX_EXECUTABLE_PATH)
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Linux Goose must launch from the fixed packaged executable",
    );
  }
  let command: string;
  let arguments_: readonly string[];
  if (platform === "darwin" && architecture.includes("64")) {
    const networkProfile = macosNetworkProfile(options);
    if (networkProfile === undefined) {
      throw new GooseRunnerProcessError("invalid-options", "Goose spawn options are invalid");
    }
    command = "/usr/bin/sandbox-exec";
    arguments_ = ["-p", networkProfile, options.executablePath];
  } else if (platform === "linux" && architecture === "x64") {
    const policy = options.networkPolicy;
    const workspaceDirectory = options.workspaceDirectory;
    const capabilitySocket = options.environment.ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET;
    const modelSocket = options.environment.ACTESTRA_GOOSE_LINUX_MODEL_SOCKET;
    const bridgeDirectory = path.join(privateRoot, "bridge");
    const validBridgeSocket = (socketPath: string | undefined): socketPath is string =>
      socketPath !== undefined &&
      path.isAbsolute(socketPath) &&
      path.resolve(socketPath) === socketPath &&
      path.dirname(socketPath) === bridgeDirectory;
    if (
      policy === "deny-all" ||
      policy.kind !== "loopback-session" ||
      policy.host !== "127.0.0.1" ||
      policy.capabilityProxyPort === policy.modelProxyPort ||
      workspaceDirectory === undefined ||
      !path.isAbsolute(workspaceDirectory) ||
      !validBridgeSocket(capabilitySocket) ||
      !validBridgeSocket(modelSocket) ||
      capabilitySocket === modelSocket ||
      options.environment.ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT !==
        String(policy.capabilityProxyPort) ||
      options.environment.ACTESTRA_GOOSE_LINUX_MODEL_PORT !== String(policy.modelProxyPort) ||
      options.environment.ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT !== workspaceDirectory
    ) {
      throw new GooseRunnerProcessError(
        "network-policy-unavailable",
        "Linux Goose launch requires the exact admitted bridge contract",
      );
    }
    command = options.executablePath;
    arguments_ = [];
  } else if (platform === "win32" && architecture === "x64") {
    const windows = options.windows;
    if (
      executableAuthority !== "windows-supervisor" ||
      windows === undefined ||
      options.networkPolicy !== "deny-all" ||
      path.dirname(path.dirname(options.executablePath)) !== privateRoot
    ) {
      throw new GooseRunnerProcessError(
        "network-policy-unavailable",
        "Windows Goose launch requires the exact admitted supervisor contract",
      );
    }
    command = options.executablePath;
    arguments_ = [windows.supervisorMode];
  } else {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "The current host lacks an admitted Goose process launcher",
    );
  }
  return Object.freeze({ command, arguments: Object.freeze([...arguments_]) });
}

export function createNodeGooseAcpTransport(
  options: GooseAcpSpawnOptions,
  dependencies: GooseRunnerProcessDependencies = DEFAULT_PROCESS_DEPENDENCIES,
): GooseAcpTransport {
  const launch = resolveGooseAcpLaunchCommand(options, dependencies);
  const platform = dependencies.platform ?? process.platform;
  const windowsSupervisor = platform === "win32";

  let child: GooseChildProcess;
  try {
    child = spawn(launch.command, launch.arguments, {
      cwd: options.workingDirectory,
      env: windowsSupervisor
        ? { ...options.environment }
        : { ...options.environment, ACTESTRA_PARENT_LIVENESS_FD: "3" },
      detached: true,
      // Windows reserves fd 3 for the one-shot control frame, fd 4 for parent liveness,
      // and fd 5/fd 6 for the duplex capability/model supervisor channels. Other hosts
      // retain the existing fd 3 liveness pipe.
      stdio: windowsSupervisor
        ? GOOSE_WINDOWS_STDIO_CHANNELS.map(() => "pipe" as const)
        : ["pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw new GooseRunnerProcessError("spawn-failed", "Failed to launch Goose ACP process", {
      cause: error,
    });
  }
  if (!windowsSupervisor) {
    return new NodeGooseAcpTransport(child);
  }
  const control = child.stdio[3];
  const parentLiveness = child.stdio[4];
  const extendedStdio = child.stdio as unknown as readonly [
    Writable,
    Readable,
    Readable,
    Readable | Writable | null | undefined,
    Readable | Writable | null | undefined,
    Duplex | null | undefined,
    Duplex | null | undefined,
  ];
  const capability = extendedStdio[5];
  const model = extendedStdio[6];
  if (
    control === null ||
    parentLiveness === null ||
    capability === null ||
    model === null ||
    typeof (control as Writable).write !== "function" ||
    typeof (parentLiveness as Writable).write !== "function" ||
    typeof (capability as Duplex).write !== "function" ||
    typeof (capability as Duplex).on !== "function" ||
    typeof (model as Duplex).write !== "function" ||
    typeof (model as Duplex).on !== "function"
  ) {
    child.kill();
    throw new GooseRunnerProcessError(
      "spawn-failed",
      "Windows Goose inherited control channels are unavailable",
    );
  }
  const controlWriter = control as Writable;
  controlWriter.once("error", () => child.kill());
  controlWriter.end(Buffer.from(encodeWindowsSupervisorControlFrame(options)));
  options.attachWindowsChannels?.({ capability: capability as Duplex, model: model as Duplex });
  return new NodeGooseAcpTransport(child, parentLiveness as Writable, {
    capability: capability as Duplex,
    model: model as Duplex,
  });
}

async function preparePrivateRoot(
  parent: string,
  artifact: AdmittedGooseRunnerArtifact,
  executableAuthority: GooseExecutableAuthority,
): Promise<GooseRunnerPreparedRoot> {
  if (!isAbsoluteDirectory(parent)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose private-root parent must be an absolute path",
    );
  }
  const parentStat = await lstat(parent).catch((error: unknown) => {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose private-root parent does not exist",
      { cause: error },
    );
  });
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose private-root parent must be a real directory",
    );
  }
  await realpath(parent);

  if (executableAuthority === "linux-package") {
    const linuxInstall = artifact.linuxInstall;
    if (
      linuxInstall === undefined ||
      !Object.isFrozen(linuxInstall) ||
      linuxInstall.contractVersion !== 1 ||
      linuxInstall.resourcesPath !== "/opt/Actestra/resources" ||
      linuxInstall.executablePath !== GOOSE_LINUX_EXECUTABLE_PATH ||
      linuxInstall.runnerManifestSha256 !== artifact.manifestSha256 ||
      linuxInstall.executableSha256 !== artifact.executableSha256
    ) {
      throw new GooseRunnerProcessError(
        "artifact-mismatch",
        "Linux Goose launch lacks the fixed package attestation",
      );
    }
  }

  const root = await mkdtemp(path.join(parent, "goose-attempt-"));
  try {
    const workingDirectory = path.join(root, "work");
    const directories = [
      "config",
      "data",
      "state",
      "home",
      "tmp",
      "local-app-data",
      "work",
      "bridge",
    ];
    if (executableAuthority !== "linux-package") directories.push("bin");
    await Promise.all(directories.map((name) => mkdir(path.join(root, name), { mode: 0o700 })));
    let executablePath: string;
    if (executableAuthority === "linux-package") {
      executablePath = GOOSE_LINUX_EXECUTABLE_PATH;
    } else {
      const binaryDirectory = path.join(root, "bin");
      const executableName = path.basename(artifact.executablePath);
      executablePath = path.join(binaryDirectory, executableName);
      await copyFile(artifact.executablePath, executablePath, fsConstants.COPYFILE_EXCL);
      if (process.platform !== "win32") {
        await chmod(executablePath, 0o500);
      }
      const stagedStat = await lstat(executablePath);
      if (
        !stagedStat.isFile() ||
        stagedStat.isSymbolicLink() ||
        stagedStat.size !== artifact.executableSize ||
        (await sha256File(executablePath)) !== artifact.executableSha256
      ) {
        throw new GooseRunnerProcessError(
          "artifact-mismatch",
          "Staged Goose executable does not match the admitted artifact",
        );
      }
    }
    return Object.freeze({
      root,
      bridgeDirectory: path.join(root, "bridge"),
      executableAuthority,
      executablePath,
      workingDirectory,
    });
  } catch (error) {
    try {
      await rm(root, { recursive: true });
    } catch (cleanupError) {
      throw new GooseRunnerProcessError(
        "cleanup-failed",
        "Failed to remove a partially prepared Goose private root",
        { cause: new AggregateError([error, cleanupError]) },
      );
    }
    throw error;
  }
}

async function removePrivateRoot(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true });
  } catch (error) {
    throw new GooseRunnerProcessError("cleanup-failed", "Failed to remove Goose private root", {
      cause: error,
    });
  }
}

async function closeAndRemove(
  connection: GooseAcpConnection,
  privateRoot: string,
  bridge: GooseRunnerPreparedBridge | undefined,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await connection.close();
  } catch (error) {
    errors.push(error);
  }
  if (bridge !== undefined) {
    try {
      await bridge.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await removePrivateRoot(privateRoot);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new GooseRunnerProcessError(
      "cleanup-failed",
      "Goose process or private root cleanup failed",
      { cause: errors.length === 1 ? errors[0] : new AggregateError(errors) },
    );
  }
}

export async function openGooseRunnerHandshake(
  options: OpenGooseRunnerHandshakeOptions,
  dependencies: GooseRunnerProcessDependencies = DEFAULT_PROCESS_DEPENDENCIES,
): Promise<OpenGooseRunnerHandshakeResult> {
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.architecture ?? process.arch;
  const runtimeTarget = resolveGooseRunnerRuntimeTarget(platform, architecture);
  if (runtimeTarget === undefined || options.artifact.targetTriple !== runtimeTarget.targetTriple) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "The current host lacks admitted Goose runtime containment",
    );
  }
  const executableAuthority = resolveGooseRunnerExecutableAuthority(runtimeTarget.platform);
  if (executableAuthority === undefined) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "The current host lacks admitted Goose executable authority",
    );
  }
  const containmentVerified = hasVerifiedGooseContainment(options.artifact.containment, {
    targetTriple: options.artifact.targetTriple,
    executableSha256: options.artifact.executableSha256,
    sourceCommit: options.artifact.sourceCommit ?? "",
  });
  if (runtimeTarget.platform !== "darwin" && !containmentVerified) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "The admitted Goose artifact lacks exact native containment evidence",
    );
  }
  const admittedWorkspaceDirectory =
    options.workspaceDirectory === undefined
      ? undefined
      : await realpath(options.workspaceDirectory).catch((error: unknown) => {
          throw new GooseRunnerProcessError(
            "invalid-options",
            "Goose runner workspace directory is unavailable",
            { cause: error },
          );
        });
  if (options.prepareBridge !== undefined && typeof options.prepareBridge !== "function") {
    throw new GooseRunnerProcessError("invalid-options", "Goose bridge factory must be a function");
  }
  if (
    options.prepareBridge !== undefined &&
    (options.capabilityProxyUrl !== undefined || options.modelBinding !== undefined)
  ) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose bridge factory cannot be combined with direct loopback bindings",
    );
  }
  if (options.prepareBridge === undefined) {
    const capabilityProxyPort =
      options.capabilityProxyUrl === undefined
        ? undefined
        : exactLoopbackMcpPort(options.capabilityProxyUrl);
    if (options.capabilityProxyUrl !== undefined && capabilityProxyPort === undefined) {
      throw new GooseRunnerProcessError(
        "invalid-options",
        "Goose runner capability proxy must use the exact admitted loopback MCP endpoint",
      );
    }
    if ((capabilityProxyPort === undefined) !== (options.modelBinding === undefined)) {
      throw new GooseRunnerProcessError(
        "invalid-options",
        "Goose runner loopback session requires both MCP and model bindings",
      );
    }
    if (options.modelBinding !== undefined) {
      validateModelBinding(options.modelBinding);
    }
  }
  if (
    runtimeTarget.platform === "linux" &&
    (options.prepareBridge === undefined || admittedWorkspaceDirectory === undefined)
  ) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "Linux Goose runtime requires one prepared bridge and admitted workspace",
    );
  }
  if (runtimeTarget.platform === "win32" && options.prepareBridge === undefined) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "Windows Goose runtime requires the exact admitted named-pipe bridge contract",
    );
  }
  let prepared: GooseRunnerPreparedRoot | undefined;
  let bridge: GooseRunnerPreparedBridge | undefined;
  let transport: GooseAcpTransport | undefined;
  try {
    prepared = await preparePrivateRoot(
      options.privateRootParent,
      options.artifact,
      executableAuthority,
    );
    if (options.prepareBridge !== undefined) {
      const candidate = await options.prepareBridge(prepared);
      try {
        bridge = validatePreparedBridge(prepared, candidate);
      } catch (error) {
        try {
          await candidate.close();
        } catch (cleanupError) {
          throw new GooseRunnerProcessError(
            "cleanup-failed",
            "Goose bridge contract was invalid and bridge cleanup failed",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
        throw error;
      }
      if (runtimeTarget.platform === "win32" && bridge.windows === undefined) {
        throw new GooseRunnerProcessError(
          "network-policy-unavailable",
          "Windows Goose runtime requires the exact admitted named-pipe bridge contract",
        );
      }
    }
    const resourceBudget = freezeWorkerResourceBudget(GOOSE_WORKER_RESOURCE_PROFILE);
    const capabilityProxyUrl = bridge?.capabilityProxyUrl ?? options.capabilityProxyUrl;
    const modelBinding = bridge?.modelBinding ?? options.modelBinding;
    const capabilityProxyPort =
      capabilityProxyUrl === undefined ? undefined : exactLoopbackMcpPort(capabilityProxyUrl);
    if (capabilityProxyUrl !== undefined && capabilityProxyPort === undefined) {
      throw new GooseRunnerProcessError(
        "invalid-options",
        "Goose runner capability proxy must use the exact admitted loopback MCP endpoint",
      );
    }
    const stableModelBinding =
      modelBinding === undefined ? undefined : validateModelBinding(modelBinding);
    const linuxBridgeEnvironment =
      runtimeTarget.platform === "linux" &&
      bridge !== undefined &&
      capabilityProxyPort !== undefined &&
      stableModelBinding !== undefined &&
      admittedWorkspaceDirectory !== undefined &&
      typeof bridge.capabilitySocketPath === "string" &&
      typeof bridge.modelSocketPath === "string"
        ? Object.freeze({
            capabilitySocketPath: bridge.capabilitySocketPath,
            modelSocketPath: bridge.modelSocketPath,
            capabilityPort: capabilityProxyPort,
            modelPort: stableModelBinding.port,
            workspaceRoot: admittedWorkspaceDirectory,
          })
        : undefined;
    const windowsBridgeEnvironment =
      runtimeTarget.platform === "win32" ? bridge?.windows : undefined;
    const spawnOptions: GooseAcpSpawnOptions = Object.freeze({
      executablePath: prepared.executablePath,
      executableAuthority,
      workingDirectory: prepared.workingDirectory,
      ...(admittedWorkspaceDirectory === undefined
        ? {}
        : { workspaceDirectory: admittedWorkspaceDirectory }),
      environment: createGooseRunnerEnvironment(
        prepared.root,
        runtimeTarget.platform === "win32" ? undefined : stableModelBinding?.binding,
        linuxBridgeEnvironment,
      ),
      resourceBudget,
      networkPolicy:
        runtimeTarget.platform === "win32" ||
        capabilityProxyPort === undefined ||
        stableModelBinding === undefined
          ? "deny-all"
          : Object.freeze({
              kind: "loopback-session",
              host: "127.0.0.1",
              capabilityProxyPort,
              modelProxyPort: stableModelBinding.port,
            }),
      ...(windowsBridgeEnvironment === undefined
        ? {}
        : {
            windows: Object.freeze({
              supervisorMode: "--actestra-windows-supervisor-v1" as const,
              capabilityPipeName: windowsBridgeEnvironment.capabilityPipeName,
              modelPipeName: windowsBridgeEnvironment.modelPipeName,
              attemptLease: windowsBridgeEnvironment.attemptLease,
              attemptId: windowsBridgeAttemptId(windowsBridgeEnvironment),
              executableSha256: options.artifact.executableSha256,
              modelId: stableModelBinding?.binding.modelId ?? bridge?.modelId ?? "",
              targetTriple: "x86_64-pc-windows-msvc" as const,
            }),
          }),
      ...(bridge?.attachWindowsChannels === undefined
        ? {}
        : { attachWindowsChannels: bridge.attachWindowsChannels }),
    });
    assertGooseContainmentLaunch(
      Object.freeze({
        platform: runtimeTarget.platform,
        architecture: runtimeTarget.architecture,
        targetTriple: runtimeTarget.targetTriple,
        executableAuthority,
        executablePath: prepared.executablePath,
        privateRoot: prepared.root,
        ...(admittedWorkspaceDirectory === undefined
          ? {}
          : { workspaceDirectory: admittedWorkspaceDirectory }),
        networkPolicy:
          spawnOptions.networkPolicy === "deny-all"
            ? "deny-all"
            : Object.freeze({
                kind: "loopback-session",
                host: "127.0.0.1",
                capabilityProxyPort: spawnOptions.networkPolicy.capabilityProxyPort,
                modelProxyPort: spawnOptions.networkPolicy.modelProxyPort,
              }),
        resourceBudget,
        parentLiveness: Object.freeze({
          kind: "inherited-ipc",
          token: randomBytes(16).toString("hex"),
        }),
      }),
    );
    transport = (options.transportFactory ?? createNodeGooseAcpTransport)(spawnOptions);
    const connection = await connectGooseAcp(transport, {
      timeoutMs: options.handshakeTimeoutMs,
    });
    let closePromise: Promise<void> | undefined;
    return Object.freeze({
      info: connection.info,
      privateRoot: prepared.root,
      async openSession(sessionOptions: GooseAcpSessionOptions): Promise<GooseAcpSession> {
        try {
          if (
            admittedWorkspaceDirectory !== undefined &&
            (await realpath(sessionOptions.workspaceDirectory).catch(
              (): undefined => undefined,
            )) !== admittedWorkspaceDirectory
          ) {
            throw new GooseRunnerProcessError(
              "invalid-options",
              "Goose ACP session workspace differs from the admitted sandbox root",
            );
          }
          return await connection.openSession(sessionOptions);
        } catch (error) {
          closePromise ??= closeAndRemove(connection, prepared!.root, bridge);
          try {
            await closePromise;
          } catch (cleanupError) {
            throw new GooseRunnerProcessError(
              "cleanup-failed",
              "Goose session setup failed and process or private-root cleanup also failed",
              { cause: new AggregateError([error, cleanupError]) },
            );
          }
          throw error;
        }
      },
      async discoverTools(
        discoveryOptions: GooseAcpToolDiscoveryOptions,
      ): Promise<GooseAcpToolDiscovery> {
        try {
          return await connection.discoverTools(discoveryOptions);
        } catch (error) {
          closePromise ??= closeAndRemove(connection, prepared!.root, bridge);
          try {
            await closePromise;
          } catch (cleanupError) {
            throw new GooseRunnerProcessError(
              "cleanup-failed",
              "Goose tool discovery failed and process or private-root cleanup also failed",
              { cause: new AggregateError([error, cleanupError]) },
            );
          }
          throw error;
        }
      },
      async prompt(promptOptions: GooseAcpPromptOptions): Promise<GooseAcpPromptResult> {
        try {
          return await connection.prompt(promptOptions);
        } catch (error) {
          closePromise ??= closeAndRemove(connection, prepared!.root, bridge);
          try {
            await closePromise;
          } catch (cleanupError) {
            throw new GooseRunnerProcessError(
              "cleanup-failed",
              "Goose prompt failed and process or private-root cleanup also failed",
              { cause: new AggregateError([error, cleanupError]) },
            );
          }
          throw error;
        }
      },
      close(): Promise<void> {
        closePromise ??= closeAndRemove(connection, prepared!.root, bridge);
        return closePromise;
      },
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (transport !== undefined) {
      try {
        await transport.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (bridge !== undefined) {
      try {
        await bridge.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (prepared !== undefined) {
      try {
        await removePrivateRoot(prepared.root);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new GooseRunnerProcessError(
        "cleanup-failed",
        "Goose handshake failed and one or more cleanup steps also failed",
        { cause: new AggregateError([error, ...cleanupErrors]) },
      );
    }
    if (
      error instanceof GooseAcpHandshakeError &&
      error.code === "transport-error" &&
      error.cause instanceof GooseRunnerProcessError &&
      (error.cause.code === "network-policy-unavailable" ||
        error.cause.code === "worker-resource-enforcement-unavailable")
    ) {
      throw error.cause;
    }
    if (error instanceof GooseAcpHandshakeError || error instanceof GooseRunnerProcessError) {
      throw error;
    }
    throw new GooseRunnerProcessError("spawn-failed", "Goose handshake launch failed", {
      cause: error,
    });
  }
}
