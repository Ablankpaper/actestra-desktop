import { randomBytes } from "node:crypto";
import path from "node:path";
import { CODING_TOOL_IDS } from "../../core";
import type { AdmittedGooseRunnerArtifact } from "./gooseRunnerArtifact";
import {
  startGooseMcpCapabilityServer,
  type GooseMcpCapabilityServer,
  type GooseMcpToolInvoker,
  type StartGooseMcpCapabilityServerOptions,
} from "./gooseMcpCapabilityServer";
import {
  ACTESTRA_GOOSE_MCP_EXTENSION_NAME,
  GooseAcpSessionError,
  type GooseAcpHumanDecisionGate,
  type GooseAcpInfo,
  type GooseAcpPromptResult,
  type GooseAcpSession,
} from "./gooseAcpHandshake";
import { GooseAuthenticatedBridgeProtocolError } from "./gooseAuthenticatedBridgeProtocol";
import {
  startGooseLoopbackModelServer,
  type GooseLoopbackModelServer,
  type GooseLoopbackModelInvoker,
  type StartGooseLoopbackModelServerOptions,
} from "./gooseLoopbackModelServer";
import { reserveGooseLoopbackPort } from "./gooseBridgeSocket";
import {
  GooseRunnerProcessError,
  openGooseRunnerHandshake,
  type GooseRunnerPreparedRoot,
  type GooseRunnerPreparedBridge,
  type OpenGooseRunnerHandshakeOptions,
  type OpenGooseRunnerHandshakeResult,
} from "./gooseRunnerProcess";
import {
  GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES,
  GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  resolveGooseSessionTransportMode,
  type GooseWindowsCapabilityProgress,
  type GooseWindowsCapabilityProgressStage,
  type GooseCapabilityBoundary,
  type GooseModelBoundary,
} from "./gooseSessionTransport";
import {
  startGooseWindowsCapabilityBridgeHost,
  type GooseWindowsCapabilityBridgeHost,
  type StartGooseWindowsCapabilityBridgeHostOptions,
} from "./gooseWindowsCapabilityBridgeHost";
import {
  startGooseWindowsModelBridgeHost,
  type GooseWindowsModelBridgeHost,
  type StartGooseWindowsModelBridgeHostOptions,
} from "./gooseWindowsModelBridgeHost";
import type { Duplex } from "node:stream";

const DEFAULT_TOOLS_LIST_WAIT_MS = 30_000;
const WINDOWS_CAPABILITY_TOOLS_LIST_TIMEOUT_MESSAGE = "Windows capability tools/list timed out";
const EXPECTED_GOOSE_TOOL_NAMES = Object.freeze(
  CODING_TOOL_IDS.map((toolId) => `${ACTESTRA_GOOSE_MCP_EXTENSION_NAME}__${toolId}`),
);

export interface OpenGooseMcpSessionCompositionOptions {
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly workspaceDirectory: string;
  readonly modelId: string;
  readonly modelInvoker: GooseLoopbackModelInvoker;
  readonly toolInvoker: GooseMcpToolInvoker;
  readonly commandIds: readonly string[];
  readonly testIds: readonly string[];
  readonly handshakeTimeoutMs?: number;
  readonly sessionTimeoutMs?: number;
}

export interface GooseMcpSessionPromptOptions {
  readonly text: string;
  readonly timeoutMs?: number;
  readonly humanDecisionGate?: GooseAcpHumanDecisionGate;
}

export interface GooseMcpSessionComposition {
  readonly info: GooseAcpInfo;
  readonly privateRoot: string;
  readonly session: GooseAcpSession;
  readonly toolNames: readonly string[];
  prompt(options: GooseMcpSessionPromptOptions): Promise<GooseAcpPromptResult>;
  close(): Promise<void>;
}

export type GooseMcpSessionCompositionErrorCode =
  | "cleanup-failed"
  | "model-completion-refused"
  | "model-request-rejected"
  | "tool-discovery-mismatch"
  | GooseWindowsCapabilityProgressFailureCode
  | GooseWindowsCapabilityCallProgressFailureCode;

export const GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_FAILURE_CODES = Object.freeze([
  "windows-capability-call-worker-request-write-failed",
  "windows-capability-call-supervisor-request-read-failed",
  "windows-capability-call-supervisor-request-forward-failed",
  "windows-capability-call-main-request-decode-failed",
  "windows-capability-call-main-tool-invocation-start-failed",
  "windows-capability-call-main-tool-invocation-complete-failed",
  "windows-capability-call-main-response-write-failed",
  "windows-capability-call-supervisor-response-read-failed",
  "windows-capability-call-supervisor-response-forward-failed",
  "windows-capability-call-worker-response-decode-failed",
  "windows-capability-call-main-tool-invocation-failed",
] as const);

export type GooseWindowsCapabilityCallProgressFailureCode =
  (typeof GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_FAILURE_CODES)[number];

export const GOOSE_WINDOWS_CAPABILITY_PROGRESS_FAILURE_CODES = Object.freeze([
  "windows-capability-worker-request-write-failed",
  "windows-capability-supervisor-request-read-failed",
  "windows-capability-supervisor-request-forward-failed",
  "windows-capability-main-request-decode-failed",
  "windows-capability-main-response-write-failed",
  "windows-capability-supervisor-response-read-failed",
  "windows-capability-supervisor-response-forward-failed",
  "windows-capability-worker-response-decode-failed",
] as const);

export type GooseWindowsCapabilityProgressFailureCode =
  (typeof GOOSE_WINDOWS_CAPABILITY_PROGRESS_FAILURE_CODES)[number];

export function classifyGooseWindowsCapabilityCallProgressFailure(
  observed: readonly GooseWindowsCapabilityProgressStage[],
): GooseWindowsCapabilityCallProgressFailureCode | undefined {
  const stages = new Set(observed);
  if (stages.has(GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES[0])) {
    return "windows-capability-call-main-tool-invocation-failed";
  }
  const firstMissing = GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES.findIndex(
    (stage) => !stages.has(stage),
  );
  return firstMissing < 0
    ? undefined
    : GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_FAILURE_CODES[firstMissing];
}

export function classifyGooseWindowsCapabilityProgressFailure(
  observed: readonly GooseWindowsCapabilityProgressStage[],
): GooseWindowsCapabilityProgressFailureCode | undefined {
  const stages = new Set(observed);
  const firstMissing = GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES.findIndex(
    (stage) => !stages.has(stage),
  );
  return firstMissing < 0
    ? undefined
    : GOOSE_WINDOWS_CAPABILITY_PROGRESS_FAILURE_CODES[firstMissing];
}

function isGooseWindowsCapabilityDiscoveryTimeout(error: unknown): boolean {
  return (
    (error instanceof GooseAcpSessionError && error.code === "tool-discovery-timeout") ||
    (error instanceof GooseAuthenticatedBridgeProtocolError &&
      error.message === WINDOWS_CAPABILITY_TOOLS_LIST_TIMEOUT_MESSAGE)
  );
}

export class GooseMcpSessionCompositionError extends Error {
  constructor(
    readonly code: GooseMcpSessionCompositionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseMcpSessionCompositionError";
  }
}

export interface GooseMcpSessionCompositionDependencies {
  startCapabilityServer(
    options: StartGooseMcpCapabilityServerOptions,
  ): Promise<GooseMcpCapabilityServer>;
  startModelServer(
    options: StartGooseLoopbackModelServerOptions,
  ): Promise<GooseLoopbackModelServer>;
  openRunnerHandshake(
    options: OpenGooseRunnerHandshakeOptions,
  ): Promise<OpenGooseRunnerHandshakeResult>;
  startWindowsCapabilityHost?(
    options: StartGooseWindowsCapabilityBridgeHostOptions,
  ): GooseWindowsCapabilityBridgeHost;
  startWindowsModelHost?(
    options: StartGooseWindowsModelBridgeHostOptions,
  ): GooseWindowsModelBridgeHost;
}

type CapabilityServer = GooseMcpCapabilityServer | GooseCapabilityBoundary;
type ModelServer = GooseLoopbackModelServer | GooseModelBoundary;

const DEFAULT_DEPENDENCIES: GooseMcpSessionCompositionDependencies = Object.freeze({
  startCapabilityServer: startGooseMcpCapabilityServer,
  startModelServer: startGooseLoopbackModelServer,
  openRunnerHandshake: openGooseRunnerHandshake,
  startWindowsCapabilityHost: startGooseWindowsCapabilityBridgeHost,
  startWindowsModelHost: startGooseWindowsModelBridgeHost,
});

function createAttemptLease(): string {
  return randomBytes(32).toString("base64url");
}

async function closePreparedBridgeServers(
  capabilityServer: CapabilityServer | undefined,
  modelServer: ModelServer | undefined,
): Promise<void> {
  const failures: unknown[] = [];
  if (modelServer !== undefined) {
    try {
      await modelServer.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (capabilityServer !== undefined) {
    try {
      await capabilityServer.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Prepared Goose bridge cleanup failed");
  }
}

async function reserveDistinctBridgePorts(): Promise<readonly [number, number]> {
  const capabilityPort = await reserveGooseLoopbackPort();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const modelPort = await reserveGooseLoopbackPort();
    if (modelPort !== capabilityPort) {
      return [capabilityPort, modelPort];
    }
  }
  throw new Error("Goose bridge loopback ports could not be made distinct");
}

function normalizeDiscoveredToolNames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length !== EXPECTED_GOOSE_TOOL_NAMES.length) {
    throw new GooseMcpSessionCompositionError(
      "tool-discovery-mismatch",
      "Goose did not return the exact admitted Actestra coding tool set",
    );
  }
  const names = new Set<unknown>(value);
  if (
    names.size !== value.length ||
    !EXPECTED_GOOSE_TOOL_NAMES.every((toolName) => names.has(toolName))
  ) {
    throw new GooseMcpSessionCompositionError(
      "tool-discovery-mismatch",
      "Goose did not return the exact admitted Actestra coding tool set",
    );
  }
  return EXPECTED_GOOSE_TOOL_NAMES;
}

async function collectCleanupFailures(
  runner: OpenGooseRunnerHandshakeResult | undefined,
  capabilityServer: CapabilityServer | undefined,
  modelServer: ModelServer | undefined,
  runnerOwnsBridgeServers = false,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  if (runner !== undefined) {
    try {
      await runner.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (capabilityServer !== undefined && (!runnerOwnsBridgeServers || runner === undefined)) {
    try {
      await capabilityServer.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (modelServer !== undefined && (!runnerOwnsBridgeServers || runner === undefined)) {
    try {
      await modelServer.close();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

async function closeComposition(
  runner: OpenGooseRunnerHandshakeResult,
  capabilityServer: CapabilityServer,
  modelServer: ModelServer,
  runnerOwnsBridgeServers: boolean,
): Promise<void> {
  const failures = await collectCleanupFailures(
    runner,
    capabilityServer,
    modelServer,
    runnerOwnsBridgeServers,
  );
  if (failures.length > 0) {
    throw new GooseMcpSessionCompositionError(
      "cleanup-failed",
      "Goose Worker, MCP capability server, or model server cleanup failed",
      { cause: new AggregateError(failures, "One or more Goose session cleanups failed") },
    );
  }
}

export async function openGooseMcpSessionComposition(
  options: OpenGooseMcpSessionCompositionOptions,
  dependencies: GooseMcpSessionCompositionDependencies = DEFAULT_DEPENDENCIES,
): Promise<GooseMcpSessionComposition> {
  const attemptLease = createAttemptLease();
  const runtimeTargetTriple =
    process.platform === "win32"
      ? "x86_64-pc-windows-msvc"
      : process.platform === "linux"
        ? "x86_64-unknown-linux-gnu"
        : options.artifact.targetTriple;
  const transportMode = resolveGooseSessionTransportMode(runtimeTargetTriple);
  const windowsAuthenticated = transportMode === "windows-authenticated";
  let modelAttemptLease = createAttemptLease();
  while (modelAttemptLease === attemptLease) {
    modelAttemptLease = createAttemptLease();
  }
  let capabilityServer: CapabilityServer | undefined;
  let modelServer: ModelServer | undefined;
  let runner: OpenGooseRunnerHandshakeResult | undefined;
  let windowsCapabilityProgress: GooseWindowsCapabilityProgress | undefined;
  let capabilityDiscoveryStarted = false;
  const runnerOwnsBridgeServers = transportMode === "linux-relay" || windowsAuthenticated;
  let session: GooseAcpSession;
  let toolNames: readonly string[];
  try {
    if (runnerOwnsBridgeServers) {
      let bridgeClosePromise: Promise<void> | undefined;
      const prepareBridge = async (
        root: GooseRunnerPreparedRoot,
      ): Promise<GooseRunnerPreparedBridge> => {
        if (windowsAuthenticated) {
          const attemptId = randomBytes(16).toString("hex");
          let bridgeClosePromise: Promise<void> | undefined;
          let attached = false;
          const attachWindowsChannels = (channels: {
            capability: Duplex;
            model: Duplex;
            capabilityProgress: GooseWindowsCapabilityProgress;
          }): void => {
            if (attached)
              throw new GooseRunnerProcessError(
                "invalid-options",
                "Windows Goose bridge channels were attached twice",
              );
            attached = true;
            windowsCapabilityProgress = channels.capabilityProgress;
            capabilityServer = (
              dependencies.startWindowsCapabilityHost ?? startGooseWindowsCapabilityBridgeHost
            )({
              stream: channels.capability,
              attemptLease,
              commandIds: options.commandIds,
              testIds: options.testIds,
              invokeTool: options.toolInvoker,
              capabilityProgress: channels.capabilityProgress,
            });
            modelServer = (dependencies.startWindowsModelHost ?? startGooseWindowsModelBridgeHost)({
              stream: channels.model,
              attemptLease: modelAttemptLease,
              invokeModel: options.modelInvoker,
            });
          };
          const close = (): Promise<void> => {
            bridgeClosePromise ??= closePreparedBridgeServers(capabilityServer, modelServer);
            return bridgeClosePromise;
          };
          return Object.freeze({
            windows: Object.freeze({
              attemptId,
              attemptLease,
              modelAttemptLease,
            }),
            modelId: options.modelId,
            attachWindowsChannels,
            close,
          });
        }
        const [capabilityPort, modelPort] = await reserveDistinctBridgePorts();
        const capabilitySocketPath = path.join(root.bridgeDirectory, "capability.sock");
        const modelSocketPath = path.join(root.bridgeDirectory, "model.sock");
        try {
          capabilityServer = await dependencies.startCapabilityServer({
            attemptLease,
            commandIds: options.commandIds,
            testIds: options.testIds,
            workspaceDirectory: options.workspaceDirectory,
            invokeTool: options.toolInvoker,
            socketPath: capabilitySocketPath,
            loopbackPort: capabilityPort,
          });
          modelServer = await dependencies.startModelServer({
            modelId: options.modelId,
            attemptLease: modelAttemptLease,
            invokeModel: options.modelInvoker,
            socketPath: modelSocketPath,
            loopbackPort: modelPort,
          });
          const loopbackCapabilityServer = capabilityServer as GooseMcpCapabilityServer;
          const loopbackModelServer = modelServer as GooseLoopbackModelServer;
          if (
            loopbackCapabilityServer.url !== `http://127.0.0.1:${String(capabilityPort)}/mcp` ||
            loopbackModelServer.baseUrl !== `http://127.0.0.1:${String(modelPort)}/v1`
          ) {
            throw new GooseRunnerProcessError(
              "invalid-options",
              "Goose bridge servers returned endpoints that do not match their reserved ports",
            );
          }
        } catch (error) {
          try {
            await closePreparedBridgeServers(capabilityServer, modelServer);
          } catch (cleanupError) {
            throw new GooseMcpSessionCompositionError(
              "cleanup-failed",
              "Goose bridge startup failed and bridge cleanup did not complete",
              { cause: new AggregateError([error, cleanupError]) },
            );
          } finally {
            capabilityServer = undefined;
            modelServer = undefined;
          }
          throw error;
        }
        const close = (): Promise<void> => {
          bridgeClosePromise ??= closePreparedBridgeServers(capabilityServer, modelServer);
          return bridgeClosePromise;
        };
        return Object.freeze({
          capabilityProxyUrl: (capabilityServer as GooseMcpCapabilityServer).url,
          modelBinding: Object.freeze({
            baseUrl: (modelServer as GooseLoopbackModelServer).baseUrl,
            modelId: options.modelId,
            attemptLease: modelAttemptLease,
          }),
          capabilitySocketPath,
          modelSocketPath,
          close,
        });
      };
      runner = await dependencies.openRunnerHandshake({
        artifact: options.artifact,
        privateRootParent: options.privateRootParent,
        workspaceDirectory: options.workspaceDirectory,
        prepareBridge,
        ...(options.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
      });
    } else {
      capabilityServer = await dependencies.startCapabilityServer({
        attemptLease,
        commandIds: options.commandIds,
        testIds: options.testIds,
        workspaceDirectory: options.workspaceDirectory,
        invokeTool: options.toolInvoker,
      });
      modelServer = await dependencies.startModelServer({
        modelId: options.modelId,
        attemptLease: modelAttemptLease,
        invokeModel: options.modelInvoker,
      });
      runner = await dependencies.openRunnerHandshake({
        artifact: options.artifact,
        privateRootParent: options.privateRootParent,
        workspaceDirectory: options.workspaceDirectory,
        capabilityProxyUrl: (capabilityServer as GooseMcpCapabilityServer).url,
        modelBinding: {
          baseUrl: (modelServer as GooseLoopbackModelServer).baseUrl,
          modelId: options.modelId,
          attemptLease: modelAttemptLease,
        },
        ...(options.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
      });
    }
    if (capabilityServer === undefined || modelServer === undefined || runner === undefined) {
      throw new GooseMcpSessionCompositionError(
        "cleanup-failed",
        "Goose bridge composition did not produce all required runtime resources",
      );
    }
    session = await runner.openSession(
      windowsAuthenticated
        ? {
            transport: "injected",
            workspaceDirectory: options.workspaceDirectory,
            ...(options.sessionTimeoutMs === undefined
              ? {}
              : { timeoutMs: options.sessionTimeoutMs }),
          }
        : {
            transport: "mcp-http",
            workspaceDirectory: options.workspaceDirectory,
            capabilityProxyUrl: (capabilityServer as GooseMcpCapabilityServer).url,
            attemptLease,
            ...(options.sessionTimeoutMs === undefined
              ? {}
              : { timeoutMs: options.sessionTimeoutMs }),
          },
    );
    modelServer.bindSession(session.sessionId);
    if (windowsAuthenticated) {
      (capabilityServer as GooseCapabilityBoundary).bindSession(session.sessionId);
    }
    capabilityDiscoveryStarted = true;
    const toolsListed = capabilityServer.waitForToolsList(
      options.sessionTimeoutMs ?? DEFAULT_TOOLS_LIST_WAIT_MS,
    );
    const [discovery] = await Promise.all([
      runner.discoverTools({
        sessionId: session.sessionId,
        extensionName: ACTESTRA_GOOSE_MCP_EXTENSION_NAME,
        ...(options.sessionTimeoutMs === undefined ? {} : { timeoutMs: options.sessionTimeoutMs }),
      }),
      toolsListed,
    ]);
    toolNames = normalizeDiscoveredToolNames(discovery.toolNames);
  } catch (error) {
    const progressFailure =
      windowsAuthenticated &&
      capabilityDiscoveryStarted &&
      windowsCapabilityProgress !== undefined &&
      isGooseWindowsCapabilityDiscoveryTimeout(error)
        ? classifyGooseWindowsCapabilityProgressFailure(windowsCapabilityProgress.snapshot())
        : undefined;
    const openingError =
      progressFailure === undefined
        ? error
        : new GooseMcpSessionCompositionError(
            progressFailure,
            "Windows capability round trip stopped before a bounded stage",
            { cause: error },
          );
    const cleanupFailures = await collectCleanupFailures(
      runner,
      capabilityServer,
      modelServer,
      runnerOwnsBridgeServers,
    );
    if (cleanupFailures.length > 0) {
      throw new GooseMcpSessionCompositionError(
        "cleanup-failed",
        "Goose session opening failed and cleanup did not complete",
        {
          cause: new AggregateError(
            [openingError, ...cleanupFailures],
            "Goose session opening and cleanup failed",
          ),
        },
      );
    }
    throw openingError;
  }

  let closePromise: Promise<void> | undefined;
  const stableRunner = runner!;
  const stableModelServer = modelServer!;
  const stableCapabilityServer = capabilityServer!;
  return Object.freeze({
    info: stableRunner.info,
    privateRoot: stableRunner.privateRoot,
    session,
    toolNames,
    async prompt(promptOptions: GooseMcpSessionPromptOptions): Promise<GooseAcpPromptResult> {
      const refusedBefore = stableModelServer.refusedInferenceCount;
      const rejectedBefore = stableModelServer.rejectedRequestCount;
      const servedBefore = stableModelServer.servedInferenceCount;
      let result: GooseAcpPromptResult;
      try {
        result = await stableRunner.prompt({
          sessionId: session.sessionId,
          text: promptOptions.text,
          ...(promptOptions.timeoutMs === undefined ? {} : { timeoutMs: promptOptions.timeoutMs }),
          ...(promptOptions.humanDecisionGate === undefined
            ? {}
            : { humanDecisionGate: promptOptions.humanDecisionGate }),
        });
      } catch (error) {
        if (windowsAuthenticated && windowsCapabilityProgress !== undefined) {
          const observed = windowsCapabilityProgress.snapshot();
          const callActivity = observed.some(
            (stage) =>
              (GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES as readonly string[]).includes(
                stage,
              ) ||
              (GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES as readonly string[]).includes(stage),
          );
          const callFailure = callActivity
            ? classifyGooseWindowsCapabilityCallProgressFailure(observed)
            : undefined;
          if (callFailure !== undefined) {
            throw new GooseMcpSessionCompositionError(
              callFailure,
              "Windows capability tool-call round trip stopped before a bounded stage",
              { cause: error },
            );
          }
        }
        throw error;
      }
      // Goose reports a content-free 400 as an ordinary assistant turn, which
      // would otherwise publish as an unchanged read-only attempt. Only a turn
      // that failed without ever serving a completion is a failure; a 400 the
      // model recovered from stays a reviewable result.
      //
      // The two causes carry distinct codes: the model contract was violated,
      // or Goose sent a request Main could not read. Both fail the turn, but a
      // durable record that names the wrong one misdirects the next repair.
      if (
        stableModelServer.servedInferenceCount === servedBefore &&
        result.stopReason !== "cancelled"
      ) {
        if (stableModelServer.refusedInferenceCount > refusedBefore) {
          throw new GooseMcpSessionCompositionError(
            "model-completion-refused",
            "Actestra refused every model completion in this Goose prompt turn",
          );
        }
        if (stableModelServer.rejectedRequestCount > rejectedBefore) {
          throw new GooseMcpSessionCompositionError(
            "model-request-rejected",
            "Actestra could not read any inference request in this Goose prompt turn",
          );
        }
      }
      return result;
    },
    close(): Promise<void> {
      closePromise ??= closeComposition(
        stableRunner,
        stableCapabilityServer,
        stableModelServer,
        runnerOwnsBridgeServers,
      );
      return closePromise;
    },
  });
}
