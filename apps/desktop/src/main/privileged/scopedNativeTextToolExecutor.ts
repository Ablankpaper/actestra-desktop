import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_WORKLOAD_CONTENT_BYTES,
  PersistenceError,
  PRIVILEGED_CONTRACT_VERSION,
  ProtectedToolExecutionError,
  SCOPED_NATIVE_TOOL_IDS,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  WORKSPACE_READ_TEXT_TOOL_ID,
  assertPortableRelativePath,
  assertAuthorizationGrant,
  assertProtectedOperation,
  authorizationMatchesOperation,
  instant,
  parseScopedNativeToolInput,
  scopedNativeToolDefinition,
  toolId,
  type ContentReferenceOwner,
  type PrivilegedClock,
  type ProtectedToolExecutor,
  type ScopedNativeToolDefinition,
  type TaskOutputWriteTextInput,
  type ToolCapabilityManifest,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolId,
  type ToolOutputReference,
  type WorkloadPersistencePort,
  type WorkspaceGrant,
  type WorkspaceReadTextInput,
} from "../../core";

const OUTPUT_ROOT_SEGMENTS = [".actestra", "task-output"] as const;

export interface ScopedNativeTextToolExecutorConfig {
  readonly persistence: WorkloadPersistencePort;
  readonly clock: PrivilegedClock;
  readonly newOutputReference: () => ToolOutputReference;
}

interface ExecutionCancellation {
  readonly signal: AbortSignal;
  close(): void;
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

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  const timedOut = signal.reason === "tool-timeout";
  throw new ProtectedToolExecutionError(
    timedOut ? "tool-timeout" : "tool-cancelled",
    timedOut ? "Scoped native tool exceeded its manifest timeout" : "Scoped native tool cancelled",
  );
}

function executionError(
  errorCode: string,
  message: string,
  options?: ErrorOptions & { readonly mayHaveExecuted?: boolean },
): ProtectedToolExecutionError {
  return new ProtectedToolExecutionError(errorCode, message, options);
}

function mapFileError(
  error: unknown,
  fallbackMessage: string,
  mayHaveExecuted = false,
): ProtectedToolExecutionError {
  if (error instanceof ProtectedToolExecutionError) {
    return error;
  }
  switch (nodeErrorCode(error)) {
    case "ENOENT":
      return executionError("path-not-found", "Scoped native tool path does not exist", {
        cause: error,
        mayHaveExecuted,
      });
    case "EEXIST":
      return executionError("output-conflict", "Task output already exists", {
        cause: error,
        mayHaveExecuted,
      });
    case "ELOOP":
      return executionError("symlink-denied", "Symbolic links are outside the native tool scope", {
        cause: error,
        mayHaveExecuted,
      });
    case "EACCES":
    case "EPERM":
      return executionError("filesystem-denied", "Operating system denied the scoped operation", {
        cause: error,
        mayHaveExecuted,
      });
    default:
      return executionError("filesystem-failed", fallbackMessage, {
        cause: error,
        mayHaveExecuted,
      });
  }
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

function targetPath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!isInside(root, candidate)) {
    throw executionError("path-scope-denied", "Native tool path escapes its canonical scope");
  }
  return candidate;
}

async function requireCanonicalGrantRoot(
  grant: WorkspaceGrant,
  signal: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  if (!path.isAbsolute(grant.rootPath) || path.resolve(grant.rootPath) !== grant.rootPath) {
    throw executionError(
      "workspace-grant-invalid",
      "Workspace grant root is not an absolute normalized path",
    );
  }
  if (path.parse(grant.rootPath).root === grant.rootPath) {
    throw executionError(
      "workspace-grant-invalid",
      "Filesystem root cannot be used as a native tool workspace grant",
    );
  }
  try {
    const [rootStat, realRoot] = await Promise.all([
      fs.lstat(grant.rootPath),
      fs.realpath(grant.rootPath),
    ]);
    throwIfCancelled(signal);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      path.resolve(realRoot) !== grant.rootPath
    ) {
      throw executionError(
        "workspace-grant-invalid",
        "Workspace grant root is no longer canonical",
      );
    }
    return realRoot;
  } catch (error) {
    throw mapFileError(error, "Workspace grant root cannot be verified");
  }
}

async function requireNoSymlinkComponents(
  root: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<string> {
  let current = root;
  for (const segment of relativePath.split("/")) {
    throwIfCancelled(signal);
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      throw mapFileError(error, "Native tool path cannot be inspected");
    }
    if (stat.isSymbolicLink()) {
      throw executionError("symlink-denied", "Symbolic links are outside the native tool scope");
    }
  }
  const canonical = await fs.realpath(current).catch((error: unknown) => {
    throw mapFileError(error, "Native tool path cannot be canonicalized");
  });
  if (!isInside(root, canonical) || canonical !== current) {
    throw executionError("path-scope-denied", "Canonical native tool path escapes its grant");
  }
  return current;
}

async function readBoundedUtf8(
  root: string,
  input: WorkspaceReadTextInput,
  signal: AbortSignal,
): Promise<string> {
  const candidate = targetPath(root, input.relativePath);
  const verified = await requireNoSymlinkComponents(root, input.relativePath, signal);
  if (verified !== candidate) {
    throw executionError("path-scope-denied", "Native tool path normalization changed");
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    throwIfCancelled(signal);
    handle = await fs.open(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    throwIfCancelled(signal);
    if (!stat.isFile()) {
      throw executionError("path-type-denied", "Workspace text read requires a regular file");
    }
    if (stat.size > MAX_WORKLOAD_CONTENT_BYTES) {
      throw executionError(
        "content-too-large",
        `Workspace text exceeds ${MAX_WORKLOAD_CONTENT_BYTES} bytes`,
      );
    }
    const bytes = Buffer.allocUnsafe(MAX_WORKLOAD_CONTENT_BYTES + 1);
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
    if (bytesRead > MAX_WORKLOAD_CONTENT_BYTES) {
      throw executionError(
        "content-too-large",
        `Workspace text exceeds ${MAX_WORKLOAD_CONTENT_BYTES} bytes`,
      );
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead));
    } catch (error) {
      throw executionError("invalid-utf8", "Workspace text is not valid UTF-8", { cause: error });
    }
  } catch (error) {
    throwIfCancelled(signal);
    throw mapFileError(error, "Workspace text read failed");
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

async function ensureDirectory(
  parent: string,
  segment: string,
  signal: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  const candidate = path.join(parent, segment);
  try {
    await fs.mkdir(candidate, { mode: 0o700 });
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") {
      throw mapFileError(error, "Task output directory cannot be created");
    }
  }
  const stat = await fs.lstat(candidate).catch((error: unknown) => {
    throw mapFileError(error, "Task output directory cannot be inspected");
  });
  if (stat.isSymbolicLink()) {
    throw executionError("symlink-denied", "Task output directory cannot be a symbolic link");
  }
  if (!stat.isDirectory()) {
    throw executionError("path-type-denied", "Task output parent must be a directory");
  }
  throwIfCancelled(signal);
  return candidate;
}

async function taskOutputRoot(
  grantRoot: string,
  task: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    assertPortableRelativePath(task);
  } catch (error) {
    throw executionError(
      "task-identity-denied",
      "Task identity cannot be mapped to a task-output directory",
      { cause: error },
    );
  }
  if (task.includes("/")) {
    throw executionError(
      "task-identity-denied",
      "Task identity must map to one task-output directory segment",
    );
  }
  let current = grantRoot;
  for (const segment of [...OUTPUT_ROOT_SEGMENTS, task]) {
    current = await ensureDirectory(current, segment, signal);
  }
  const canonical = await fs.realpath(current).catch((error: unknown) => {
    throw mapFileError(error, "Task output root cannot be canonicalized");
  });
  if (!isInside(grantRoot, canonical) || canonical !== current) {
    throw executionError("path-scope-denied", "Task output root escapes the workspace grant");
  }
  return current;
}

async function requireMissingOutput(candidate: string): Promise<void> {
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) {
      throw executionError("symlink-denied", "Task output target cannot be a symbolic link");
    }
    throw executionError("output-conflict", "Task output already exists");
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      return;
    }
    if (error instanceof ProtectedToolExecutionError) {
      throw error;
    }
    throw mapFileError(error, "Task output target cannot be inspected");
  }
}

async function createTaskOutput(
  grantRoot: string,
  task: string,
  input: TaskOutputWriteTextInput,
  signal: AbortSignal,
): Promise<void> {
  const outputRoot = await taskOutputRoot(grantRoot, task, signal);
  const segments = input.relativePath.split("/");
  const fileName = segments.pop();
  if (fileName === undefined) {
    throw executionError("invalid-input", "Task output path is missing a file name");
  }

  let parent = outputRoot;
  for (const segment of segments) {
    parent = await ensureDirectory(parent, segment, signal);
  }
  const canonicalParent = await fs.realpath(parent).catch((error: unknown) => {
    throw mapFileError(error, "Task output parent cannot be canonicalized");
  });
  if (
    canonicalParent !== parent ||
    (canonicalParent !== outputRoot && !isInside(outputRoot, canonicalParent))
  ) {
    throw executionError("path-scope-denied", "Task output parent escapes the task output root");
  }

  const candidate = targetPath(outputRoot, input.relativePath);
  await requireMissingOutput(candidate);
  throwIfCancelled(signal);

  const temporary = path.join(parent, `.actestra-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let published = false;
  try {
    handle = await fs.open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(input.content, {
      encoding: "utf8",
      signal,
    });
    await handle.sync();
    await handle.close();
    handle = undefined;
    throwIfCancelled(signal);
    await fs.link(temporary, candidate);
    published = true;
  } catch (error) {
    if (!published) {
      throwIfCancelled(signal);
    }
    throw mapFileError(error, "Task output create failed", published);
  } finally {
    await handle?.close().catch((): undefined => undefined);
    await fs.unlink(temporary).catch((): undefined => undefined);
  }
}

function ownerFor(request: ToolExecutionRequest, grant: WorkspaceGrant): ContentReferenceOwner {
  const { operation } = request;
  return Object.freeze({
    workspaceId: operation.workspaceId,
    taskId: operation.taskId,
    sessionId: operation.sessionId,
    workerId: operation.workerId,
    requestId: operation.requestId,
    grantId: grant.grantId,
  });
}

export class ScopedNativeTextToolExecutor implements ProtectedToolExecutor {
  private readonly manifests: ReadonlyMap<ToolId, ToolCapabilityManifest>;

  constructor(private readonly config: ScopedNativeTextToolExecutorConfig) {
    const manifests = SCOPED_NATIVE_TOOL_IDS.map((registeredTool) => {
      const definition = scopedNativeToolDefinition(registeredTool);
      return [
        registeredTool,
        Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          toolId: registeredTool,
          actions: Object.freeze([definition.action]),
          resourceKinds: Object.freeze([definition.resourceKind]),
          credentialUse: "forbidden",
          timeoutMs: definition.timeoutMs,
        } satisfies ToolCapabilityManifest),
      ] as const;
    });
    this.manifests = new Map(manifests);
  }

  async manifest(tool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(tool);
    const manifest = this.manifests.get(tool);
    if (manifest === undefined) {
      throw executionError(
        "unsupported-tool",
        "Only the two GW-P4.4 scoped native tools are registered",
      );
    }
    return manifest;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    assertProtectedOperation(request.operation);
    assertAuthorizationGrant(request.authorization);
    let definition: ScopedNativeToolDefinition;
    try {
      definition = scopedNativeToolDefinition(request.operation.toolId);
    } catch (error) {
      throw executionError("unsupported-tool", "Scoped native tool is not registered", {
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
        "Scoped native tool request does not match its authorization",
      );
    }

    const cancellation = cancellationFor(request);
    try {
      throwIfCancelled(cancellation.signal);
      const grant = await this.config.persistence
        .getActiveWorkspaceGrant(request.operation.workspaceId)
        .catch((error: unknown) => {
          throw executionError(
            "workspace-grant-unavailable",
            "Active workspace grant is unavailable",
            { cause: error },
          );
        });
      if (grant === null) {
        throw executionError(
          "workspace-grant-unavailable",
          "No active workspace grant authorizes this operation",
        );
      }
      const root = await requireCanonicalGrantRoot(grant, cancellation.signal);
      const owner = ownerFor(request, grant);
      const resolved = await this.config.persistence
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
            error instanceof PersistenceError && error.code === "content-ownership"
              ? "input-ownership-denied"
              : "input-unavailable",
            "Scoped native tool input reference is unavailable",
            { cause: error },
          );
        });
      if (
        resolved.metadata.classification !== "task-content" ||
        resolved.metadata.mediaType !== "text/plain; charset=utf-8"
      ) {
        throw executionError(
          "invalid-input",
          "Scoped native tool input reference has an unsupported classification",
        );
      }

      let input: ReturnType<typeof parseScopedNativeToolInput>;
      try {
        input = parseScopedNativeToolInput(request.operation.toolId, resolved.content);
      } catch (error) {
        throw executionError("invalid-input", "Scoped native tool input is invalid", {
          cause: error,
        });
      }

      let outputContent: string;
      let outputMediaType: "text/plain; charset=utf-8" | "text/markdown; charset=utf-8";
      let outputClassification: "workspace-content" | "task-content";
      let mayHaveExecuted = false;
      if (request.operation.toolId === WORKSPACE_READ_TEXT_TOOL_ID) {
        outputContent = await readBoundedUtf8(
          root,
          input as WorkspaceReadTextInput,
          cancellation.signal,
        );
        outputMediaType = "text/plain; charset=utf-8";
        outputClassification = "workspace-content";
      } else if (request.operation.toolId === TASK_OUTPUT_WRITE_TEXT_TOOL_ID) {
        const writeInput = input as TaskOutputWriteTextInput;
        await createTaskOutput(root, request.operation.taskId, writeInput, cancellation.signal);
        mayHaveExecuted = true;
        outputContent = writeInput.content;
        outputMediaType = writeInput.mediaType;
        outputClassification = "task-content";
      } else {
        throw executionError("unsupported-tool", "Scoped native tool is not registered");
      }

      const outputRef = this.config.newOutputReference();
      try {
        await this.config.persistence.storeContentReference({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: outputRef,
          kind: "tool-output",
          owner,
          classification: outputClassification,
          mediaType: outputMediaType,
          content: outputContent,
          createdAt: this.now(),
        });
      } catch (error) {
        throw executionError(
          "output-reference-unavailable",
          "Scoped native tool output reference could not be persisted",
          {
            cause: error,
            mayHaveExecuted,
          },
        );
      }
      return Object.freeze({
        status: "succeeded",
        outputRef,
      });
    } finally {
      cancellation.close();
    }
  }

  private now() {
    const value = this.config.clock.now();
    instant(value);
    return value;
  }
}
