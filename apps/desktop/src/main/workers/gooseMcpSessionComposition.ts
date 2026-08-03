import { randomBytes } from "node:crypto";
import type { AdmittedGooseRunnerArtifact } from "./gooseRunnerArtifact";
import {
  startGooseMcpCapabilityServer,
  type GooseMcpCapabilityServer,
  type StartGooseMcpCapabilityServerOptions,
} from "./gooseMcpCapabilityServer";
import type { GooseAcpInfo, GooseAcpSession } from "./gooseAcpHandshake";
import {
  openGooseRunnerHandshake,
  type OpenGooseRunnerHandshakeOptions,
  type OpenGooseRunnerHandshakeResult,
} from "./gooseRunnerProcess";

const DEFAULT_TOOLS_LIST_WAIT_MS = 30_000;

export interface OpenGooseMcpSessionCompositionOptions {
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly workspaceDirectory: string;
  readonly commandIds: readonly string[];
  readonly testIds: readonly string[];
  readonly handshakeTimeoutMs?: number;
  readonly sessionTimeoutMs?: number;
}

export interface GooseMcpSessionComposition {
  readonly info: GooseAcpInfo;
  readonly privateRoot: string;
  readonly session: GooseAcpSession;
  close(): Promise<void>;
}

export type GooseMcpSessionCompositionErrorCode = "cleanup-failed";

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
  openRunnerHandshake(
    options: OpenGooseRunnerHandshakeOptions,
  ): Promise<OpenGooseRunnerHandshakeResult>;
}

const DEFAULT_DEPENDENCIES: GooseMcpSessionCompositionDependencies = Object.freeze({
  startCapabilityServer: startGooseMcpCapabilityServer,
  openRunnerHandshake: openGooseRunnerHandshake,
});

function createAttemptLease(): string {
  return randomBytes(32).toString("base64url");
}

async function collectCleanupFailures(
  runner: OpenGooseRunnerHandshakeResult | undefined,
  capabilityServer: GooseMcpCapabilityServer,
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
  return failures;
}

async function closeRunnerThenCapabilityServer(
  runner: OpenGooseRunnerHandshakeResult,
  capabilityServer: GooseMcpCapabilityServer,
): Promise<void> {
  const failures = await collectCleanupFailures(runner, capabilityServer);
  if (failures.length > 0) {
    throw new GooseMcpSessionCompositionError(
      "cleanup-failed",
      "Goose Worker or MCP capability server cleanup failed",
      { cause: new AggregateError(failures, "One or more Goose session cleanups failed") },
    );
  }
}

export async function openGooseMcpSessionComposition(
  options: OpenGooseMcpSessionCompositionOptions,
  dependencies: GooseMcpSessionCompositionDependencies = DEFAULT_DEPENDENCIES,
): Promise<GooseMcpSessionComposition> {
  const attemptLease = createAttemptLease();
  const capabilityServer = await dependencies.startCapabilityServer({
    attemptLease,
    commandIds: options.commandIds,
    testIds: options.testIds,
  });
  let runner: OpenGooseRunnerHandshakeResult | undefined;
  let session: GooseAcpSession;
  try {
    runner = await dependencies.openRunnerHandshake({
      artifact: options.artifact,
      privateRootParent: options.privateRootParent,
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    });
    const toolsListed = capabilityServer.waitForToolsList(
      options.sessionTimeoutMs ?? DEFAULT_TOOLS_LIST_WAIT_MS,
    );
    [session] = await Promise.all([
      runner.openSession({
        workspaceDirectory: options.workspaceDirectory,
        capabilityProxyUrl: capabilityServer.url,
        attemptLease,
        ...(options.sessionTimeoutMs === undefined ? {} : { timeoutMs: options.sessionTimeoutMs }),
      }),
      toolsListed,
    ]);
  } catch (error) {
    const cleanupFailures = await collectCleanupFailures(runner, capabilityServer);
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
  return Object.freeze({
    info: stableRunner.info,
    privateRoot: stableRunner.privateRoot,
    session,
    close(): Promise<void> {
      closePromise ??= closeRunnerThenCapabilityServer(stableRunner, capabilityServer);
      return closePromise;
    },
  });
}
