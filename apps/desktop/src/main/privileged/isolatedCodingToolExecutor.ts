import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  ARTIFACT_APPLY_TOOL_DEFINITION,
  CODING_DIFF_TOOL_ID,
  CODING_ARTIFACT_PUBLISH_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
  REGISTERED_ISOLATED_CODING_TOOL_IDS,
  MAX_ISOLATED_CODING_TEXT_BYTES,
  PRIVILEGED_CONTRACT_VERSION,
  ProtectedToolExecutionError,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  assertAuthorizationGrant,
  assertPersistContentReferenceResult,
  assertProtectedOperation,
  assertResolvedContentReference,
  authorizationMatchesOperation,
  codingToolDefinition,
  instant,
  parseCodingToolInput,
  toolId,
  toolOutputReference,
  type CodingArtifactPublishInput,
  type CodingFileReadInput,
  type CodingFileWriteInput,
  type CodingGitInput,
  type CodingTerminalInput,
  type CodingTestInput,
  type ContentReferenceOwner,
  type IsolatedCodingToolDefinition,
  type PrivilegedClock,
  type ProtectedAction,
  type ProtectedResourceKind,
  type ProtectedToolExecutor,
  type ToolCapabilityManifest,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolId,
  type ToolOutputReference,
  type WorkloadPersistencePort,
  type WorkspaceGrant,
} from "../../core";
import type { IsolatedCodingProcessDefinition } from "./isolatedCodingToolPlatform";
import { captureIsolatedCodingPatch } from "../workers/isolatedCodingPatch";

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const PROCESS_TERMINATE_GRACE_MS = 1_000;
const STDERR_SIGNATURE_PROBE_BYTES = 4_096;
const PROCESS_REGISTRY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MACOS_DENIED_HOST_READ_ROOTS = Object.freeze([
  "/Users",
  "/Volumes",
  "/private/tmp",
  "/private/var/folders",
  "/Library",
] as const);
const CLOSED_GIT_CONFIG_ARGUMENTS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
] as const);

export interface IsolatedCodingToolExecutorConfig {
  readonly persistence: WorkloadPersistencePort;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  readonly clock: PrivilegedClock;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly newOutputReference: () => ToolOutputReference;
}

/**
 * Copy the process registries at the authority boundary.  The Worker only
 * supplies an identifier later; it must never be able to observe a registry
 * entry (or an argument mutation) that was added after this executor was
 * constructed.
 */
function snapshotProcessRegistry(
  registry: Readonly<Record<string, IsolatedCodingProcessDefinition>>,
  label: "command" | "test",
): Readonly<Record<string, IsolatedCodingProcessDefinition>> {
  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    throw new TypeError(`Coding ${label} registry must be a record`);
  }

  const snapshot: Record<string, IsolatedCodingProcessDefinition> = Object.create(null) as Record<
    string,
    IsolatedCodingProcessDefinition
  >;
  for (const key of Object.keys(registry)) {
    if (key.length === 0 || key.length > 128 || !PROCESS_REGISTRY_ID_PATTERN.test(key)) {
      throw new TypeError(`Coding ${label} registry contains an invalid identifier`);
    }

    const definition = registry[key];
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new TypeError(`Coding ${label} registry contains an invalid process definition`);
    }
    const ownKeys = Reflect.ownKeys(definition);
    if (ownKeys.length !== 2 || !ownKeys.includes("executablePath") || !ownKeys.includes("args")) {
      throw new TypeError(`Coding ${label} process definition has an unsupported shape`);
    }
    const executableDescriptor = Object.getOwnPropertyDescriptor(definition, "executablePath");
    const argsDescriptor = Object.getOwnPropertyDescriptor(definition, "args");
    if (
      executableDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(executableDescriptor, "value") ||
      argsDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(argsDescriptor, "value")
    ) {
      throw new TypeError(`Coding ${label} process definition must contain data properties`);
    }

    const executablePath = executableDescriptor.value;
    const args = argsDescriptor.value;
    if (
      typeof executablePath !== "string" ||
      !Array.isArray(args) ||
      args.some((argument: unknown) => typeof argument !== "string")
    ) {
      throw new TypeError(`Coding ${label} process definition has invalid values`);
    }
    snapshot[key] = Object.freeze({
      executablePath,
      args: Object.freeze([...args]),
    });
  }
  return Object.freeze(snapshot);
}

interface ExecutionCancellation {
  readonly signal: AbortSignal;
  close(): void;
}

function executionError(
  errorCode: string,
  message: string,
  options?: ErrorOptions & { readonly mayHaveExecuted?: boolean },
): ProtectedToolExecutionError {
  return new ProtectedToolExecutionError(errorCode, message, options);
}

/**
 * Classify a failed process's stderr into one closed set of tokens.
 *
 * The audit sink is contractually redacted and stderr routinely carries workspace
 * paths, branch names, and file contents, so the text itself can never be recorded.
 * A signature token carries the one thing the exit code cannot: whether a non-zero
 * exit was transient contention, a misconfigured workspace, or host exhaustion.
 * Every branch returns a fixed literal, so no caller can widen this into a content leak.
 */
function classifyProcessStderr(stderr: Buffer): string {
  if (stderr.byteLength === 0) {
    return "none";
  }
  const probe = new TextDecoder("utf-8", { fatal: false })
    .decode(stderr.subarray(0, STDERR_SIGNATURE_PROBE_BYTES))
    .toLowerCase();
  if (probe.includes(".lock")) {
    return "git-lock-contention";
  }
  if (probe.includes("not a git repository")) {
    return "git-not-a-repository";
  }
  if (probe.includes("dubious ownership")) {
    return "git-dubious-ownership";
  }
  if (probe.includes("unknown revision") || probe.includes("bad revision")) {
    return "git-bad-revision";
  }
  if (probe.includes("permission denied") || probe.includes("operation not permitted")) {
    return "permission-denied";
  }
  if (
    probe.includes("resource temporarily unavailable") ||
    probe.includes("cannot allocate memory") ||
    probe.includes("too many open files")
  ) {
    return "resource-exhausted";
  }
  if (probe.includes("fatal:")) {
    return "git-fatal";
  }
  if (probe.includes("error:")) {
    return "git-error";
  }
  return "unclassified";
}

function nodeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function mapFileError(
  error: unknown,
  message: string,
  mayHaveExecuted = false,
): ProtectedToolExecutionError {
  if (error instanceof ProtectedToolExecutionError) {
    return error;
  }
  switch (nodeErrorCode(error)) {
    case "ENOENT":
      return executionError("path-not-found", "Coding tool path does not exist", {
        cause: error,
        mayHaveExecuted,
      });
    case "ELOOP":
      return executionError("symlink-denied", "Coding tool symbolic links are denied", {
        cause: error,
        mayHaveExecuted,
      });
    case "EACCES":
    case "EPERM":
      return executionError("filesystem-denied", "Operating system denied the coding tool", {
        cause: error,
        mayHaveExecuted,
      });
    default:
      return executionError("filesystem-failed", message, {
        cause: error,
        mayHaveExecuted,
      });
  }
}

function cancellationFor(request: ToolExecutionRequest): ExecutionCancellation {
  const controller = new AbortController();
  const externalSignal = request.signal;
  const abortFromCaller = (): void => {
    controller.abort("tool-cancelled");
  };
  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort("tool-timeout");
  }, request.timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function throwIfCancelled(signal: AbortSignal, mayHaveExecuted = false): void {
  if (!signal.aborted) {
    return;
  }
  const timedOut = signal.reason === "tool-timeout";
  throw executionError(
    timedOut ? "tool-timeout" : "tool-cancelled",
    timedOut ? "Coding tool exceeded its manifest timeout" : "Coding tool was cancelled",
    { mayHaveExecuted },
  );
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function requireWorktreeRoot(
  configuredRoot: string,
  grant: WorkspaceGrant,
  signal: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  if (
    !path.isAbsolute(configuredRoot) ||
    path.resolve(configuredRoot) !== configuredRoot ||
    path.parse(configuredRoot).root === configuredRoot ||
    grant.rootPath !== configuredRoot
  ) {
    throw executionError(
      "worktree-scope-denied",
      "Active workspace grant does not identify this isolated coding worktree",
    );
  }
  try {
    const [metadata, canonical] = await Promise.all([
      fs.lstat(configuredRoot),
      fs.realpath(configuredRoot),
    ]);
    throwIfCancelled(signal);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== configuredRoot) {
      throw executionError(
        "worktree-scope-denied",
        "Isolated coding worktree root is no longer canonical",
      );
    }
    return canonical;
  } catch (error) {
    throw mapFileError(error, "Isolated coding worktree root cannot be verified");
  }
}

async function requireSafeParent(
  root: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<{ readonly parent: string; readonly target: string }> {
  const segments = relativePath.split("/");
  const fileName = segments.pop();
  if (fileName === undefined) {
    throw executionError("invalid-input", "Coding file path has no file name");
  }
  let parent = root;
  for (const segment of segments) {
    throwIfCancelled(signal);
    parent = path.join(parent, segment);
    let metadata;
    try {
      metadata = await fs.lstat(parent);
    } catch (error) {
      throw mapFileError(error, "Coding file parent cannot be inspected");
    }
    if (metadata.isSymbolicLink()) {
      throw executionError("symlink-denied", "Coding file parent cannot be a symbolic link");
    }
    if (!metadata.isDirectory()) {
      throw executionError("path-type-denied", "Coding file parent must be a directory");
    }
  }
  const canonicalParent = await fs.realpath(parent).catch((error: unknown) => {
    throw mapFileError(error, "Coding file parent cannot be canonicalized");
  });
  if (
    canonicalParent !== parent ||
    (canonicalParent !== root && !isInside(root, canonicalParent))
  ) {
    throw executionError("worktree-scope-denied", "Coding file parent escapes the worktree");
  }
  const target = path.join(parent, fileName);
  if (!isInside(root, target)) {
    throw executionError("worktree-scope-denied", "Coding file target escapes the worktree");
  }
  return { parent, target };
}

async function writeCodingFile(
  root: string,
  input: CodingFileWriteInput,
  signal: AbortSignal,
): Promise<{ readonly byteLength: number; readonly relativePath: string }> {
  const { parent, target } = await requireSafeParent(root, input.relativePath, signal);
  try {
    const targetMetadata = await fs.lstat(target);
    if (targetMetadata.isSymbolicLink()) {
      throw executionError("symlink-denied", "Coding file target cannot be a symbolic link");
    }
    if (!targetMetadata.isFile()) {
      throw executionError("path-type-denied", "Coding file target must be a regular file");
    }
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") {
      throw mapFileError(error, "Coding file target cannot be inspected");
    }
  }

  const bytes = new TextEncoder().encode(input.content);
  const temporary = path.join(parent, `.actestra-coding-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let published = false;
  try {
    throwIfCancelled(signal);
    handle = await fs.open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes, { signal });
    await handle.sync();
    await handle.close();
    handle = undefined;
    throwIfCancelled(signal);
    if ((await fs.realpath(parent)) !== parent) {
      throw executionError("worktree-scope-denied", "Coding file parent changed before publish");
    }
    await fs.rename(temporary, target);
    published = true;
    return { relativePath: input.relativePath, byteLength: bytes.byteLength };
  } catch (error) {
    if (!published) {
      throwIfCancelled(signal);
    }
    throw mapFileError(error, "Coding file write failed", published);
  } finally {
    await handle?.close().catch((): undefined => undefined);
    await fs.rm(temporary, { force: true }).catch((): undefined => undefined);
  }
}

async function readCodingFile(
  root: string,
  input: CodingFileReadInput,
  signal: AbortSignal,
): Promise<{ readonly content: string; readonly relativePath: string }> {
  const maximumBytes = input.maximumBytes ?? MAX_ISOLATED_CODING_TEXT_BYTES;
  const { target } = await requireSafeParent(root, input.relativePath, signal);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    throwIfCancelled(signal);
    const metadata = await fs.lstat(target);
    if (metadata.isSymbolicLink()) {
      throw executionError("symlink-denied", "Coding file target cannot be a symbolic link");
    }
    if (!metadata.isFile()) {
      throw executionError("path-type-denied", "Coding file read requires a regular file");
    }
    const canonical = await fs.realpath(target);
    if (!isInside(root, canonical) || canonical !== target) {
      throw executionError("worktree-scope-denied", "Coding file target escapes the worktree");
    }
    if (metadata.size > maximumBytes) {
      throw executionError(
        "content-too-large",
        `Coding file content exceeds ${maximumBytes} bytes`,
      );
    }
    handle = await fs.open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.byteLength) {
      throwIfCancelled(signal);
      const read = await handle.read(bytes, bytesRead, bytes.byteLength - bytesRead, bytesRead);
      if (read.bytesRead === 0) {
        break;
      }
      bytesRead += read.bytesRead;
    }
    throwIfCancelled(signal);
    if (bytesRead > maximumBytes) {
      throw executionError(
        "content-too-large",
        `Coding file content exceeds ${maximumBytes} bytes`,
      );
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead));
    } catch (error) {
      throw executionError("invalid-utf8", "Coding file is not valid UTF-8", { cause: error });
    }
    return { relativePath: input.relativePath, content };
  } catch (error) {
    throwIfCancelled(signal);
    throw mapFileError(error, "Coding file read failed");
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

function gitEnvironment(root: string): Readonly<Record<string, string>> {
  const privateRoot = path.dirname(root);
  return Object.freeze({
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    HOME: privateRoot,
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  });
}

async function requireExactGitBinding(
  root: string,
  gitDirectory: string,
  gitCommonDirectory: string,
  signal: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal);
  let canonicalBinding: readonly [string, string, string];
  try {
    const result = await execFileAsync(
      GIT_EXECUTABLE,
      [
        "-C",
        root,
        ...CLOSED_GIT_CONFIG_ARGUMENTS,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-common-dir",
      ],
      {
        encoding: "utf8",
        env: gitEnvironment(root),
        maxBuffer: MAX_ISOLATED_CODING_TEXT_BYTES,
        signal,
        timeout: 0,
      },
    );
    throwIfCancelled(signal);
    const serialized = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
    const binding = serialized.split("\n");
    if (binding.length !== 3 || binding.some((value) => !path.isAbsolute(value))) {
      throw new TypeError("Coding worktree returned an invalid Git binding");
    }
    canonicalBinding = (await Promise.all(binding.map((value) => fs.realpath(value)))) as [
      string,
      string,
      string,
    ];
    throwIfCancelled(signal);
  } catch (error) {
    throwIfCancelled(signal);
    throw executionError(
      "worktree-scope-denied",
      "Isolated coding worktree Git binding could not be verified",
      { cause: error },
    );
  }

  if (
    canonicalBinding[0] !== root ||
    canonicalBinding[1] !== gitDirectory ||
    canonicalBinding[2] !== gitCommonDirectory
  ) {
    throw executionError(
      "worktree-scope-denied",
      "Isolated coding worktree Git binding no longer matches its creator",
    );
  }
}

async function requireClosedGitConfiguration(root: string, signal: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  let serialized: string;
  try {
    const result = await execFileAsync(
      GIT_EXECUTABLE,
      [
        "-C",
        root,
        ...CLOSED_GIT_CONFIG_ARGUMENTS,
        "config",
        "--local",
        "--no-includes",
        "--null",
        "--list",
      ],
      {
        encoding: "utf8",
        env: gitEnvironment(root),
        maxBuffer: MAX_ISOLATED_CODING_TEXT_BYTES,
        signal,
        timeout: 0,
      },
    );
    serialized = result.stdout;
  } catch (error) {
    throwIfCancelled(signal);
    throw executionError(
      "git-command-failed",
      "Coding repository configuration could not be inspected",
      { cause: error },
    );
  }

  for (const entry of serialized.split("\0")) {
    const separator = entry.indexOf("\n");
    const key = (separator === -1 ? entry : entry.slice(0, separator)).toLowerCase();
    if (
      /^filter\..+\.(?:clean|smudge|process)$/.test(key) ||
      key === "include.path" ||
      /^includeif\..+\.path$/.test(key)
    ) {
      throw executionError(
        "repository-config-denied",
        "Coding repository configuration can invoke an external Git process",
      );
    }
  }
}

async function runReadOnlyGit(
  root: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  await requireClosedGitConfiguration(root, signal);
  try {
    const result = await execFileAsync(
      GIT_EXECUTABLE,
      ["-C", root, ...CLOSED_GIT_CONFIG_ARGUMENTS, ...args],
      {
        encoding: "utf8",
        env: gitEnvironment(root),
        maxBuffer: MAX_ISOLATED_CODING_TEXT_BYTES,
        signal,
        timeout: 0,
      },
    );
    throwIfCancelled(signal);
    return result.stdout.trimEnd();
  } catch (error) {
    throwIfCancelled(signal);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    ) {
      throw executionError(
        "output-too-large",
        `Coding Git output exceeds ${MAX_ISOLATED_CODING_TEXT_BYTES} bytes`,
      );
    }
    throw executionError("git-command-failed", "Closed coding Git query failed", {
      cause: error,
    });
  }
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

function processEnvironment(root: string): Readonly<Record<string, string>> {
  const privateRoot = path.dirname(root);
  const temporaryRoot = path.join(privateRoot, "tmp");
  return Object.freeze({
    CI: "1",
    HOME: path.join(privateRoot, "home"),
    NO_COLOR: "1",
    PATH: "/usr/bin:/bin",
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
    TZ: "UTC",
  });
}

async function requirePrivateProcessDirectories(root: string): Promise<void> {
  const privateRoot = path.dirname(root);
  for (const name of ["home", "tmp"] as const) {
    const directory = path.join(privateRoot, name);
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") {
        throw mapFileError(error, "Coding process private directory cannot be created");
      }
    }
    const [metadata, canonical] = await Promise.all([fs.lstat(directory), fs.realpath(directory)]);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== directory) {
      throw executionError(
        "process-scope-denied",
        "Coding process private directory is not canonical",
      );
    }
  }
}

async function requireProcessDefinition(
  definition: IsolatedCodingProcessDefinition | undefined,
): Promise<IsolatedCodingProcessDefinition> {
  if (
    definition === undefined ||
    typeof definition !== "object" ||
    definition === null ||
    Array.isArray(definition) ||
    Object.keys(definition).some((key) => key !== "executablePath" && key !== "args") ||
    !path.isAbsolute(definition.executablePath) ||
    path.resolve(definition.executablePath) !== definition.executablePath ||
    !Array.isArray(definition.args) ||
    definition.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length === 0 ||
        argument.includes("\0") ||
        new TextEncoder().encode(argument).byteLength > 4_096,
    ) ||
    definition.args.reduce(
      (total, argument) => total + new TextEncoder().encode(argument).byteLength,
      0,
    ) > 16_384
  ) {
    throw executionError(
      "process-definition-denied",
      "Coding process must use one exact main-owned executable and argument list",
    );
  }
  try {
    const [metadata, canonical] = await Promise.all([
      fs.lstat(definition.executablePath),
      fs.realpath(definition.executablePath),
    ]);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      canonical !== definition.executablePath
    ) {
      throw executionError(
        "process-definition-denied",
        "Coding process executable must be a canonical regular file",
      );
    }
  } catch (error) {
    throw mapFileError(error, "Coding process executable cannot be verified");
  }
  return Object.freeze({
    executablePath: definition.executablePath,
    args: Object.freeze([...definition.args]),
  });
}

function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): boolean {
  if (child.pid === undefined) {
    return false;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function processGroupIsAlive(child: ChildProcessWithoutNullStreams): boolean {
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
      return true;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(
  child: ChildProcessWithoutNullStreams,
  milliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (processGroupIsAlive(child)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 10)));
  }
  return true;
}

async function runRegisteredProcess(
  root: string,
  repositoryRoot: string,
  definition: IsolatedCodingProcessDefinition,
  signal: AbortSignal,
): Promise<{ readonly exitCode: 0; readonly stderr: string; readonly stdout: string }> {
  if (process.platform !== "darwin") {
    throw executionError(
      "process-policy-unavailable",
      "P5.2 coding process execution requires the admitted macOS sandbox",
    );
  }
  const stableDefinition = await requireProcessDefinition(definition);
  await requirePrivateProcessDirectories(root);
  throwIfCancelled(signal);
  const privateRoot = path.dirname(root);
  const deniedReadRoots = [...MACOS_DENIED_HOST_READ_ROOTS, repositoryRoot];
  const traversalPaths = sandboxTraversalPaths(privateRoot, stableDefinition.executablePath);
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read* ${deniedReadRoots
      .map((deniedRoot) => `(subpath "${sandboxLiteral(deniedRoot)}")`)
      .join(" ")})`,
    `(allow file-read-metadata ${traversalPaths
      .map((traversalPath) => `(literal "${sandboxLiteral(traversalPath)}")`)
      .join(" ")})`,
    `(allow file-read* (subpath "${sandboxLiteral(privateRoot)}") (literal "${sandboxLiteral(stableDefinition.executablePath)}"))`,
    "(deny file-write*)",
    `(allow file-write* (subpath "${sandboxLiteral(privateRoot)}") (literal "/dev/null"))`,
    `(deny file-write* (literal "${sandboxLiteral(root)}") (literal "${sandboxLiteral(path.join(root, ".git"))}"))`,
  ].join(" ");
  const environment = processEnvironment(root);
  const environmentArguments = Object.entries(environment).map(([key, value]) => `${key}=${value}`);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      SANDBOX_EXECUTABLE,
      [
        "-p",
        profile,
        "/usr/bin/env",
        "-i",
        ...environmentArguments,
        stableDefinition.executablePath,
        ...stableDefinition.args,
      ],
      {
        cwd: root,
        detached: true,
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (error) {
    throw executionError("process-spawn-failed", "Failed to launch the coding process", {
      cause: error,
    });
  }
  child.stdin.end();

  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let terminalError: ProtectedToolExecutionError | undefined;
    let directCloseCode: number | null | undefined;
    let directCloseSignal: NodeJS.Signals | null = null;
    let terminationRequested = false;
    let forcedCleanupComplete = false;
    let settled = false;

    const settle = (): void => {
      if (
        settled ||
        directCloseCode === undefined ||
        (terminationRequested && !forcedCleanupComplete)
      ) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (terminalError?.errorCode === "process-cleanup-failed") {
        reject(terminalError);
        return;
      }
      if (signal.aborted) {
        const timedOut = signal.reason === "tool-timeout";
        reject(
          executionError(
            timedOut ? "tool-timeout" : "tool-cancelled",
            timedOut ? "Coding process exceeded its timeout" : "Coding process was cancelled",
            { mayHaveExecuted: true },
          ),
        );
        return;
      }
      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }
      if (directCloseCode !== 0) {
        reject(
          executionError(
            "process-exit-failed",
            // Metadata only: the audit sink is contractually redacted, so record the
            // exit shape that distinguishes a signal kill from a real non-zero exit
            // without copying stderr text, which routinely carries workspace paths.
            `Coding process exited unsuccessfully (exitCode=${directCloseCode === null ? "none" : String(directCloseCode)}, signal=${directCloseSignal ?? "none"}, stderrBytes=${String(stderr.byteLength)}, stderrSignature=${classifyProcessStderr(stderr)})`,
            { mayHaveExecuted: true },
          ),
        );
        return;
      }
      let stdoutText: string;
      let stderrText: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        stdoutText = decoder.decode(stdout).trimEnd();
        stderrText = decoder.decode(stderr).trimEnd();
      } catch (error) {
        reject(
          executionError("invalid-utf8", "Coding process output is not valid UTF-8", {
            cause: error,
            mayHaveExecuted: true,
          }),
        );
        return;
      }
      resolve({ exitCode: 0, stdout: stdoutText, stderr: stderrText });
    };

    const terminate = (): void => {
      if (terminationRequested) {
        return;
      }
      terminationRequested = true;
      void (async () => {
        try {
          const termSent = signalProcessGroup(child, "SIGTERM");
          if (termSent && !(await waitForProcessGroupExit(child, PROCESS_TERMINATE_GRACE_MS))) {
            const killSent = signalProcessGroup(child, "SIGKILL");
            if (killSent && !(await waitForProcessGroupExit(child, PROCESS_TERMINATE_GRACE_MS))) {
              throw executionError(
                "process-cleanup-failed",
                "Coding process group survived forced termination",
                { mayHaveExecuted: true },
              );
            }
          }
        } catch (error) {
          terminalError =
            error instanceof ProtectedToolExecutionError &&
            error.errorCode === "process-cleanup-failed"
              ? error
              : executionError(
                  "process-cleanup-failed",
                  "Coding process group could not be terminated",
                  { cause: error, mayHaveExecuted: true },
                );
        } finally {
          forcedCleanupComplete = true;
          settle();
        }
      })();
    };
    const onAbort = (): void => {
      terminate();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }

    const appendOutput = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (terminalError !== undefined) {
        return;
      }
      if (
        stdout.byteLength + stderr.byteLength + chunk.byteLength >
        MAX_ISOLATED_CODING_TEXT_BYTES
      ) {
        terminalError = executionError(
          "output-too-large",
          `Coding process output exceeds ${MAX_ISOLATED_CODING_TEXT_BYTES} bytes`,
          { mayHaveExecuted: true },
        );
        terminate();
        return;
      }
      if (target === "stdout") {
        stdout = Buffer.concat([stdout, chunk]);
      } else {
        stderr = Buffer.concat([stderr, chunk]);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.once("error", (error) => {
      terminalError ??= executionError("process-spawn-failed", "Coding process transport failed", {
        cause: error,
        mayHaveExecuted: child.pid !== undefined,
      });
      terminate();
    });
    child.once("close", (code, signal) => {
      directCloseCode = code;
      directCloseSignal = signal;
      terminate();
      settle();
    });
  });
}

async function storeOutput(
  config: IsolatedCodingToolExecutorConfig,
  owner: ContentReferenceOwner,
  content: string,
  mayHaveExecuted: boolean,
  signal: AbortSignal,
): Promise<ToolOutputReference> {
  throwIfCancelled(signal, mayHaveExecuted);
  const outputRef = config.newOutputReference();
  toolOutputReference(outputRef);
  try {
    await config.persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: outputRef,
      kind: "tool-output",
      owner,
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content,
      createdAt: config.clock.now(),
    });
  } catch (error) {
    throw executionError(
      "output-reference-unavailable",
      "Coding tool output evidence could not be persisted",
      { cause: error, mayHaveExecuted },
    );
  }
  throwIfCancelled(signal, mayHaveExecuted);
  return outputRef;
}

async function storePublishedPatch(
  config: IsolatedCodingToolExecutorConfig,
  owner: ContentReferenceOwner,
  input: CodingArtifactPublishInput,
  patch: string,
  signal: AbortSignal,
): Promise<ToolOutputReference> {
  throwIfCancelled(signal);
  let stored;
  try {
    stored = await config.persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: input.outputReference,
      kind: "tool-output",
      owner,
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: patch,
      createdAt: config.clock.now(),
    });
    assertPersistContentReferenceResult(stored);
  } catch (error) {
    let committedMatches = false;
    try {
      const committed = await config.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: input.outputReference,
        kind: "tool-output",
        owner,
        resolvedAt: config.clock.now(),
        consume: false,
      });
      assertResolvedContentReference(committed);
      committedMatches =
        committed.content === patch &&
        committed.metadata.reference === input.outputReference &&
        committed.metadata.kind === "tool-output" &&
        committed.metadata.owner.workspaceId === owner.workspaceId &&
        committed.metadata.owner.taskId === owner.taskId &&
        committed.metadata.owner.sessionId === owner.sessionId &&
        committed.metadata.owner.workerId === owner.workerId &&
        committed.metadata.owner.requestId === owner.requestId &&
        committed.metadata.owner.grantId === owner.grantId &&
        committed.metadata.classification === "task-content" &&
        committed.metadata.mediaType === "text/plain; charset=utf-8" &&
        committed.metadata.byteLength === input.patchByteLength &&
        committed.metadata.sha256 === input.patchSha256;
    } catch {
      // Preserve the original store failure when its exact commit cannot be proven.
    }
    if (committedMatches) {
      throwIfCancelled(signal, true);
      return input.outputReference;
    }
    throw executionError(
      "output-reference-unavailable",
      "Coding publish output evidence could not be persisted",
      { cause: error, mayHaveExecuted: true },
    );
  }
  if (
    stored.metadata.reference !== input.outputReference ||
    stored.metadata.kind !== "tool-output" ||
    stored.metadata.owner.workspaceId !== owner.workspaceId ||
    stored.metadata.owner.taskId !== owner.taskId ||
    stored.metadata.owner.sessionId !== owner.sessionId ||
    stored.metadata.owner.workerId !== owner.workerId ||
    stored.metadata.owner.requestId !== owner.requestId ||
    stored.metadata.owner.grantId !== owner.grantId ||
    stored.metadata.classification !== "task-content" ||
    stored.metadata.mediaType !== "text/plain; charset=utf-8" ||
    stored.metadata.byteLength !== input.patchByteLength ||
    stored.metadata.sha256 !== input.patchSha256
  ) {
    throw executionError(
      "output-reference-unavailable",
      "Coding publish output persistence returned mismatched evidence",
      { mayHaveExecuted: true },
    );
  }
  throwIfCancelled(signal, true);
  return input.outputReference;
}

function ownerFor(request: ToolExecutionRequest, grant: WorkspaceGrant): ContentReferenceOwner {
  return Object.freeze({
    workspaceId: request.operation.workspaceId,
    taskId: request.operation.taskId,
    sessionId: request.operation.sessionId,
    workerId: request.operation.workerId,
    requestId: request.operation.requestId,
    grantId: grant.grantId,
  });
}

export class IsolatedCodingToolExecutor implements ProtectedToolExecutor {
  private readonly manifests: ReadonlyMap<ToolId, ToolCapabilityManifest>;
  private readonly config: IsolatedCodingToolExecutorConfig;

  constructor(config: IsolatedCodingToolExecutorConfig) {
    this.config = Object.freeze({
      ...config,
      commands: snapshotProcessRegistry(config.commands, "command"),
      tests: snapshotProcessRegistry(config.tests, "test"),
    });
    const manifestFor = (definition: {
      readonly toolId: ToolId;
      readonly action: ProtectedAction;
      readonly resourceKind: ProtectedResourceKind;
      readonly timeoutMs: number;
    }): readonly [ToolId, ToolCapabilityManifest] =>
      [
        definition.toolId,
        Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          toolId: definition.toolId,
          actions: Object.freeze([definition.action]),
          resourceKinds: Object.freeze([definition.resourceKind]),
          credentialUse: "forbidden",
          timeoutMs: definition.timeoutMs,
        } satisfies ToolCapabilityManifest),
      ] as const;
    this.manifests = new Map([
      ...REGISTERED_ISOLATED_CODING_TOOL_IDS.map((registeredTool) =>
        manifestFor(codingToolDefinition(registeredTool)),
      ),
      // Declared so the gateway can reach the apply approval rule. `execute` still refuses this
      // tool, because Main applies the patch itself once the user approves.
      manifestFor(ARTIFACT_APPLY_TOOL_DEFINITION),
    ]);
  }

  async manifest(requestedTool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(requestedTool);
    const manifest = this.manifests.get(requestedTool);
    if (manifest === undefined) {
      throw executionError("unsupported-tool", "Isolated coding tool is not registered");
    }
    return manifest;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    assertProtectedOperation(request.operation);
    assertAuthorizationGrant(request.authorization);
    let definition: IsolatedCodingToolDefinition;
    try {
      definition = codingToolDefinition(request.operation.toolId);
    } catch (error) {
      throw executionError("unsupported-tool", "Isolated coding tool is not registered", {
        cause: error,
      });
    }
    if (
      !authorizationMatchesOperation(request.authorization, request.operation) ||
      request.operation.action !== definition.action ||
      request.operation.resourceKind !== definition.resourceKind ||
      request.credentialLeases.length !== 0 ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > definition.timeoutMs
    ) {
      throw executionError(
        "authorization-mismatch",
        "Isolated coding tool request does not match its authorization",
      );
    }

    const cancellation = cancellationFor(request);
    try {
      throwIfCancelled(cancellation.signal);
      const grant = await this.config.persistence
        .getActiveWorkspaceGrant(request.operation.workspaceId)
        .catch((error: unknown) => {
          throw executionError(
            "worktree-grant-unavailable",
            "Active coding worktree grant is unavailable",
            { cause: error },
          );
        });
      if (grant === null) {
        throw executionError(
          "worktree-grant-unavailable",
          "No active grant authorizes this coding worktree",
        );
      }
      const root = await requireWorktreeRoot(this.config.worktreeRoot, grant, cancellation.signal);
      await requireExactGitBinding(
        root,
        this.config.gitDirectory,
        this.config.gitCommonDirectory,
        cancellation.signal,
      );
      const owner = ownerFor(request, grant);
      const inputReference = await this.config.persistence
        .resolveContentReference({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: request.operation.inputRef,
          kind: "tool-input",
          owner,
          resolvedAt: this.now(),
          consume: true,
        })
        .catch((error: unknown) => {
          throw executionError(
            "input-ownership-denied",
            "Coding tool input is unavailable for this exact request owner",
            { cause: error },
          );
        });
      let input;
      try {
        input = parseCodingToolInput(request.operation.toolId, inputReference.content);
      } catch (error) {
        throw executionError("invalid-input", "Coding tool input is invalid", { cause: error });
      }

      let output: Record<string, unknown>;
      let mayHaveExecuted = false;
      switch (definition.toolId) {
        case CODING_FILE_READ_TOOL_ID: {
          const result = await readCodingFile(
            root,
            input as CodingFileReadInput,
            cancellation.signal,
          );
          output = {
            contractVersion: 1,
            type: "file-read",
            relativePath: result.relativePath,
            content: result.content,
          };
          break;
        }
        case CODING_FILE_WRITE_TOOL_ID: {
          const result = await writeCodingFile(
            root,
            input as CodingFileWriteInput,
            cancellation.signal,
          );
          mayHaveExecuted = true;
          output = {
            contractVersion: 1,
            type: "file-written",
            relativePath: result.relativePath,
            byteLength: result.byteLength,
          };
          break;
        }
        case CODING_GIT_TOOL_ID: {
          const gitInput = input as CodingGitInput;
          const gitOutput = await runReadOnlyGit(
            root,
            gitInput.query === "status"
              ? ["status", "--porcelain=v1", "--untracked-files=all"]
              : ["rev-parse", "--verify", "HEAD"],
            cancellation.signal,
          );
          output = {
            contractVersion: 1,
            type: gitInput.query === "status" ? "git-status" : "git-head",
            output: gitOutput,
          };
          break;
        }
        case CODING_DIFF_TOOL_ID: {
          const diff = await runReadOnlyGit(
            root,
            ["diff", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "--"],
            cancellation.signal,
          );
          output = { contractVersion: 1, type: "diff", output: diff };
          break;
        }
        case CODING_ARTIFACT_PUBLISH_TOOL_ID: {
          const publishInput = input as CodingArtifactPublishInput;
          const publishPatch = await this.config.persistence
            .resolveContentReference({
              contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
              reference: publishInput.patchReference,
              kind: "tool-input",
              owner,
              resolvedAt: this.now(),
              consume: true,
            })
            .catch((error: unknown) => {
              throw executionError(
                "input-ownership-denied",
                "Coding publish patch is unavailable for this exact request owner",
                { cause: error },
              );
            });
          assertResolvedContentReference(publishPatch);
          if (
            publishPatch.metadata.reference !== publishInput.patchReference ||
            publishPatch.metadata.kind !== "tool-input" ||
            publishPatch.metadata.owner.workspaceId !== owner.workspaceId ||
            publishPatch.metadata.owner.taskId !== owner.taskId ||
            publishPatch.metadata.owner.sessionId !== owner.sessionId ||
            publishPatch.metadata.owner.workerId !== owner.workerId ||
            publishPatch.metadata.owner.requestId !== owner.requestId ||
            publishPatch.metadata.owner.grantId !== owner.grantId ||
            publishPatch.metadata.classification !== "task-content" ||
            publishPatch.metadata.mediaType !== "text/plain; charset=utf-8" ||
            publishPatch.metadata.byteLength !== publishInput.patchByteLength ||
            publishPatch.metadata.sha256 !== publishInput.patchSha256
          ) {
            throw executionError(
              "input-ownership-denied",
              "Coding publish patch persistence returned mismatched evidence",
            );
          }
          const snapshot = await captureIsolatedCodingPatch({
            worktreeRoot: this.config.worktreeRoot,
            gitDirectory: this.config.gitDirectory,
            gitCommonDirectory: this.config.gitCommonDirectory,
          });
          if (
            snapshot.baseCommit !== publishInput.baseCommit ||
            snapshot.patch !== publishPatch.content ||
            snapshot.patchSha256 !== publishInput.patchSha256 ||
            createHash("sha256").update(publishPatch.content, "utf8").digest("hex") !==
              publishInput.patchSha256
          ) {
            throw executionError(
              "publish-snapshot-changed",
              "Coding worktree changed after the publish approval snapshot",
            );
          }
          const outputRef = await storePublishedPatch(
            this.config,
            owner,
            publishInput,
            publishPatch.content,
            cancellation.signal,
          );
          return Object.freeze({ status: "succeeded", outputRef });
        }
        case CODING_TERMINAL_TOOL_ID: {
          const terminalInput = input as CodingTerminalInput;
          const definition = this.config.commands[terminalInput.commandId];
          if (definition === undefined) {
            throw executionError(
              "process-definition-denied",
              "Coding terminal command is not in the main-owned registry",
            );
          }
          const result = await runRegisteredProcess(
            root,
            this.config.repositoryRoot,
            definition,
            cancellation.signal,
          );
          mayHaveExecuted = true;
          output = {
            contractVersion: 1,
            type: "terminal",
            commandId: terminalInput.commandId,
            ...result,
          };
          break;
        }
        case CODING_TEST_TOOL_ID: {
          const testInput = input as CodingTestInput;
          const definition = this.config.tests[testInput.testId];
          if (definition === undefined) {
            throw executionError(
              "process-definition-denied",
              "Coding test is not in the main-owned registry",
            );
          }
          const result = await runRegisteredProcess(
            root,
            this.config.repositoryRoot,
            definition,
            cancellation.signal,
          );
          mayHaveExecuted = true;
          output = {
            contractVersion: 1,
            type: "test",
            testId: testInput.testId,
            ...result,
          };
          break;
        }
        default:
          throw executionError("unsupported-tool", "Coding tool execution is not implemented");
      }
      const outputRef = await storeOutput(
        this.config,
        owner,
        JSON.stringify(output),
        mayHaveExecuted,
        cancellation.signal,
      );
      return Object.freeze({ status: "succeeded", outputRef });
    } finally {
      cancellation.close();
    }
  }

  private now() {
    const now = this.config.clock.now();
    instant(now);
    return now;
  }
}
