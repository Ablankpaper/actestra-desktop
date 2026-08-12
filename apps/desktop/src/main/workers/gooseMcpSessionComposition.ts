import { randomBytes } from "node:crypto";
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
  type GooseAcpHumanDecisionGate,
  type GooseAcpInfo,
  type GooseAcpPromptResult,
  type GooseAcpSession,
} from "./gooseAcpHandshake";
import {
  startGooseLoopbackModelServer,
  type GooseLoopbackModelServer,
  type GooseLoopbackModelInvoker,
  type StartGooseLoopbackModelServerOptions,
} from "./gooseLoopbackModelServer";
import {
  openGooseRunnerHandshake,
  type OpenGooseRunnerHandshakeOptions,
  type OpenGooseRunnerHandshakeResult,
} from "./gooseRunnerProcess";

const DEFAULT_TOOLS_LIST_WAIT_MS = 30_000;
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
  | "tool-discovery-mismatch";

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
}

const DEFAULT_DEPENDENCIES: GooseMcpSessionCompositionDependencies = Object.freeze({
  startCapabilityServer: startGooseMcpCapabilityServer,
  startModelServer: startGooseLoopbackModelServer,
  openRunnerHandshake: openGooseRunnerHandshake,
});

function createAttemptLease(): string {
  return randomBytes(32).toString("base64url");
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
  capabilityServer: GooseMcpCapabilityServer,
  modelServer: GooseLoopbackModelServer | undefined,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  if (runner !== undefined) {
    try {
      await runner.close();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await capabilityServer.close();
  } catch (error) {
    failures.push(error);
  }
  if (modelServer !== undefined) {
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
  capabilityServer: GooseMcpCapabilityServer,
  modelServer: GooseLoopbackModelServer,
): Promise<void> {
  const failures = await collectCleanupFailures(runner, capabilityServer, modelServer);
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
  let modelAttemptLease = createAttemptLease();
  while (modelAttemptLease === attemptLease) {
    modelAttemptLease = createAttemptLease();
  }
  const capabilityServer = await dependencies.startCapabilityServer({
    attemptLease,
    commandIds: options.commandIds,
    testIds: options.testIds,
    workspaceDirectory: options.workspaceDirectory,
    invokeTool: options.toolInvoker,
  });
  let modelServer: GooseLoopbackModelServer | undefined;
  let runner: OpenGooseRunnerHandshakeResult | undefined;
  let session: GooseAcpSession;
  let toolNames: readonly string[];
  try {
    modelServer = await dependencies.startModelServer({
      modelId: options.modelId,
      attemptLease: modelAttemptLease,
      invokeModel: options.modelInvoker,
    });
    runner = await dependencies.openRunnerHandshake({
      artifact: options.artifact,
      privateRootParent: options.privateRootParent,
      capabilityProxyUrl: capabilityServer.url,
      modelBinding: {
        baseUrl: modelServer.baseUrl,
        modelId: options.modelId,
        attemptLease: modelAttemptLease,
      },
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    });
    session = await runner.openSession({
      workspaceDirectory: options.workspaceDirectory,
      capabilityProxyUrl: capabilityServer.url,
      attemptLease,
      ...(options.sessionTimeoutMs === undefined ? {} : { timeoutMs: options.sessionTimeoutMs }),
    });
    modelServer.bindSession(session.sessionId);
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
    const cleanupFailures = await collectCleanupFailures(runner, capabilityServer, modelServer);
    if (cleanupFailures.length > 0) {
      throw new GooseMcpSessionCompositionError(
        "cleanup-failed",
        "Goose session opening failed and cleanup did not complete",
        {
          cause: new AggregateError(
            [error, ...cleanupFailures],
            "Goose session opening and cleanup failed",
          ),
        },
      );
    }
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  const stableRunner = runner;
  const stableModelServer = modelServer;
  return Object.freeze({
    info: stableRunner.info,
    privateRoot: stableRunner.privateRoot,
    session,
    toolNames,
    async prompt(promptOptions: GooseMcpSessionPromptOptions): Promise<GooseAcpPromptResult> {
      const refusedBefore = stableModelServer.refusedInferenceCount;
      const rejectedBefore = stableModelServer.rejectedRequestCount;
      const servedBefore = stableModelServer.servedInferenceCount;
      const result = await stableRunner.prompt({
        sessionId: session.sessionId,
        text: promptOptions.text,
        ...(promptOptions.timeoutMs === undefined ? {} : { timeoutMs: promptOptions.timeoutMs }),
        ...(promptOptions.humanDecisionGate === undefined
          ? {}
          : { humanDecisionGate: promptOptions.humanDecisionGate }),
      });
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
      closePromise ??= closeComposition(stableRunner, capabilityServer, stableModelServer);
      return closePromise;
    },
  });
}
