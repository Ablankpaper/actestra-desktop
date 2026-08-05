import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import path from "node:path";
import {
  MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES,
  normalizeTeamPlannerSidecarReady,
  normalizeTeamPlannerSidecarRequest,
  normalizeTeamPlannerSidecarResponse,
  type TeamPlannerAggregatePayload,
  type TeamPlannerAggregateResult,
  type TeamPlannerSidecarEngine,
  type TeamPlannerSidecarRequest,
  type TeamPlannerSidecarResponse,
} from "../../shared/teamPlannerSidecarProtocol";
import {
  normalizeTeamPlannerRequest,
  type TeamPlanCandidate,
  type TeamPlannerRequest,
} from "../../core";

export type TeamPlannerSidecarProcessErrorCode =
  | "invalid-options"
  | "startup-failed"
  | "startup-timeout"
  | "request-timeout"
  | "cancelled"
  | "planner-failed"
  | "protocol-failed"
  | "cleanup-failed"
  | "unavailable"
  | "closed";

export class TeamPlannerSidecarProcessError extends Error {
  constructor(
    readonly code: TeamPlannerSidecarProcessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamPlannerSidecarProcessError";
  }
}

export interface TeamPlannerSidecarProcessOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly expectedEngine: TeamPlannerSidecarEngine;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly terminationGraceMs?: number;
}

interface PendingRequest {
  readonly request: TeamPlannerSidecarRequest;
  readonly signal: AbortSignal;
  readonly abortHandler: () => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (response: TeamPlannerSidecarResponse) => void;
  readonly reject: (error: TeamPlannerSidecarProcessError) => void;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ARGUMENTS = 32;
const MAX_ARGUMENT_BYTES = 4_096;
const MAX_STDERR_BYTES = 64 * 1024;

function processError(
  code: TeamPlannerSidecarProcessErrorCode,
  message: string,
): TeamPlannerSidecarProcessError {
  return new TeamPlannerSidecarProcessError(code, message);
}

function assertDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw processError(
      "invalid-options",
      `${label} must be a positive safe duration of at most ${MAX_TIMEOUT_MS}ms`,
    );
  }
}

function validateOptions(options: TeamPlannerSidecarProcessOptions): {
  readonly startupTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly terminationGraceMs: number;
  readonly expectedEngine: TeamPlannerSidecarEngine;
} {
  if (
    typeof options.executable !== "string" ||
    !path.isAbsolute(options.executable) ||
    typeof options.workingDirectory !== "string" ||
    !path.isAbsolute(options.workingDirectory) ||
    !Array.isArray(options.args) ||
    options.args.length > MAX_ARGUMENTS ||
    options.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.includes("\u0000") ||
        new TextEncoder().encode(argument).byteLength > MAX_ARGUMENT_BYTES,
    )
  ) {
    throw processError("invalid-options", "Team planner process launch options are invalid");
  }
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  assertDuration(startupTimeoutMs, "Team planner startup timeout");
  assertDuration(requestTimeoutMs, "Team planner request timeout");
  assertDuration(terminationGraceMs, "Team planner termination grace");
  const ready = normalizeTeamPlannerSidecarReady({
    protocolVersion: 1,
    type: "ready",
    role: "planner",
    engine: options.expectedEngine,
  });
  return {
    startupTimeoutMs,
    requestTimeoutMs,
    terminationGraceMs,
    expectedEngine: ready.engine,
  };
}

function closedEnvironment(): NodeJS.ProcessEnv {
  return {
    ACTESTRA_NETWORK_POLICY: "deny",
    ALL_PROXY: "http://127.0.0.1:9",
    CREWAI_DISABLE_TELEMETRY: "true",
    CREWAI_DISABLE_TRACKING: "true",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    LANG: "C.UTF-8",
    LC_ALL: "C",
    NO_PROXY: "",
    OTEL_SDK_DISABLED: "true",
    TZ: "UTC",
  };
}

function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): boolean {
  if (child.pid === undefined) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  }
  return child.kill(signal);
}

function processGroupIsAlive(child: ChildProcessWithoutNullStreams): boolean {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProcessGroupExit(
  child: ChildProcessWithoutNullStreams,
  milliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (processGroupIsAlive(child)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(remaining, 10));
  }
  return true;
}

export class TeamPlannerSidecarProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #expectedEngine: TeamPlannerSidecarEngine;
  readonly #requestTimeoutMs: number;
  readonly #terminationGraceMs: number;
  private readonly readyPromise: Promise<void>;
  readonly #exit: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: TeamPlannerSidecarProcessError) => void;
  #resolveExit!: () => void;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #stdoutBuffer = Buffer.alloc(0);
  #stderrBytes = 0;
  #pending: PendingRequest | null = null;
  #readyReceived = false;
  #readySettled = false;
  #exited = false;
  #failed = false;
  #closing = false;
  #closed = false;
  #requestSequence = 0;
  #requestTail: Promise<void> = Promise.resolve();
  #termination: Promise<void> | null = null;

  private constructor(options: TeamPlannerSidecarProcessOptions) {
    const validated = validateOptions(options);
    this.#expectedEngine = validated.expectedEngine;
    this.#requestTimeoutMs = validated.requestTimeoutMs;
    this.#terminationGraceMs = validated.terminationGraceMs;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#exit = new Promise<void>((resolve) => {
      this.#resolveExit = resolve;
    });

    const spawnOptions: SpawnOptionsWithoutStdio & {
      readonly stdio: readonly ["pipe", "pipe", "pipe"];
    } = {
      cwd: options.workingDirectory,
      detached: process.platform !== "win32",
      env: closedEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    };
    this.#child = spawn(options.executable, [...options.args], spawnOptions);
    this.#child.stdout.on("data", (chunk: Buffer) => this.#handleStdout(chunk));
    this.#child.stderr.on("data", (chunk: Buffer) => this.#handleStderr(chunk));
    this.#child.stdin.on("error", () => {
      this.#fail(processError("unavailable", "The supervised team planner became unavailable"));
    });
    this.#child.on("error", () => {
      this.#handleProcessFailure();
    });
    this.#child.on("exit", () => {
      this.#handleExit();
    });
    this.#startupTimer = setTimeout(() => {
      this.#fail(
        processError("startup-timeout", "The supervised team planner did not become ready"),
      );
    }, validated.startupTimeoutMs);
  }

  static async start(
    options: TeamPlannerSidecarProcessOptions,
  ): Promise<TeamPlannerSidecarProcess> {
    let sidecar: TeamPlannerSidecarProcess;
    try {
      sidecar = new TeamPlannerSidecarProcess(options);
    } catch (error) {
      if (error instanceof TeamPlannerSidecarProcessError) throw error;
      throw processError("startup-failed", "The supervised team planner could not start");
    }
    try {
      await sidecar.#waitUntilReady();
      return sidecar;
    } catch (error) {
      await sidecar.#terminate();
      throw error;
    }
  }

  async #waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }

  propose(requestValue: unknown, signal?: AbortSignal): Promise<TeamPlanCandidate> {
    const payload = normalizeTeamPlannerRequest(requestValue);
    return this.#enqueue(signal, async () => {
      const request = this.#createRequest("propose", payload);
      const response = await this.#invoke(request, signal);
      if (response.status !== "ok" || request.operation !== "propose") {
        throw processError("planner-failed", "The supervised team planner request failed");
      }
      return response.result as TeamPlanCandidate;
    });
  }

  aggregate(payloadValue: unknown, signal?: AbortSignal): Promise<TeamPlannerAggregateResult> {
    return this.#enqueue(signal, async () => {
      const request = this.#createRequest("aggregate", payloadValue);
      const response = await this.#invoke(request, signal);
      if (response.status !== "ok" || request.operation !== "aggregate") {
        throw processError("planner-failed", "The supervised team planner request failed");
      }
      return response.result as TeamPlannerAggregateResult;
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closing = true;
    this.#clearStartupTimer();
    if (!this.#readySettled) {
      this.#rejectStartup(processError("closed", "The supervised team planner was closed"));
    }
    this.#rejectPending(processError("closed", "The supervised team planner was closed"));
    await this.#terminate();
    this.#closed = true;
  }

  #enqueue<Result>(
    signal: AbortSignal | undefined,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const queued = this.#requestTail.then(async () => {
      if (signal?.aborted) {
        throw processError("cancelled", "The supervised team planner request was cancelled");
      }
      return operation();
    });
    this.#requestTail = queued.then(
      (): undefined => undefined,
      (): undefined => undefined,
    );
    return queued;
  }

  #createRequest(operation: "propose", payload: TeamPlannerRequest): TeamPlannerSidecarRequest;
  #createRequest(operation: "aggregate", payload: unknown): TeamPlannerSidecarRequest;
  #createRequest(
    operation: "propose" | "aggregate",
    payload: TeamPlannerRequest | unknown,
  ): TeamPlannerSidecarRequest {
    this.#requestSequence += 1;
    if (!Number.isSafeInteger(this.#requestSequence)) {
      throw processError("unavailable", "The supervised team planner request limit was reached");
    }
    return normalizeTeamPlannerSidecarRequest({
      protocolVersion: 1,
      type: "request",
      requestId: `planner-request-${String(this.#requestSequence)}`,
      operation,
      payload,
    });
  }

  async #invoke(
    request: TeamPlannerSidecarRequest,
    signal?: AbortSignal,
  ): Promise<TeamPlannerSidecarResponse> {
    this.#assertAvailable();
    if (signal?.aborted) {
      throw processError("cancelled", "The supervised team planner request was cancelled");
    }
    return new Promise<TeamPlannerSidecarResponse>((resolve, reject) => {
      const plannerSignal = signal ?? new AbortController().signal;
      const abortHandler = () => {
        if (this.#pending?.request.requestId !== request.requestId) return;
        this.#rejectPending(
          processError("cancelled", "The supervised team planner request was cancelled"),
        );
        this.#failed = true;
        void this.#terminate();
      };
      const timeout = setTimeout(() => {
        if (this.#pending?.request.requestId !== request.requestId) return;
        this.#rejectPending(
          processError("request-timeout", "The supervised team planner request timed out"),
        );
        this.#failed = true;
        void this.#terminate();
      }, this.#requestTimeoutMs);
      this.#pending = {
        request,
        signal: plannerSignal,
        abortHandler,
        timeout,
        resolve,
        reject,
      };
      plannerSignal.addEventListener("abort", abortHandler, { once: true });
      const line = `${JSON.stringify(request)}\n`;
      this.#child.stdin.write(line, "utf8", (error) => {
        if (error === null || error === undefined) return;
        if (this.#pending?.request.requestId !== request.requestId) return;
        this.#fail(processError("unavailable", "The supervised team planner became unavailable"));
      });
    });
  }

  #handleStdout(chunk: Buffer): void {
    if (this.#failed || this.#closed) return;
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);
    if (this.#stdoutBuffer.byteLength > MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES + 1) {
      this.#protocolFailure();
      return;
    }
    let newline = this.#stdoutBuffer.indexOf(0x0a);
    while (newline >= 0 && !this.#failed) {
      const line = this.#stdoutBuffer.subarray(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newline + 1);
      if (line.byteLength === 0 || line.byteLength > MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES) {
        this.#protocolFailure();
        return;
      }
      let text: string;
      let value: unknown;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(line);
        value = JSON.parse(text);
      } catch {
        this.#protocolFailure();
        return;
      }
      this.#handleMessage(value);
      newline = this.#stdoutBuffer.indexOf(0x0a);
    }
    if (this.#readyReceived && !this.#readySettled && !this.#failed) {
      this.#readySettled = true;
      this.#clearStartupTimer();
      this.#resolveReady();
    }
  }

  #handleMessage(value: unknown): void {
    if (!this.#readyReceived) {
      try {
        const ready = normalizeTeamPlannerSidecarReady(value);
        if (
          ready.engine.name !== this.#expectedEngine.name ||
          ready.engine.version !== this.#expectedEngine.version
        ) {
          throw new Error("incompatible engine");
        }
        this.#readyReceived = true;
      } catch {
        this.#fail(processError("startup-failed", "The supervised team planner handshake failed"));
      }
      return;
    }
    if (this.#pending === null) {
      if (!this.#closing) this.#protocolFailure();
      return;
    }
    let response: TeamPlannerSidecarResponse;
    try {
      response = normalizeTeamPlannerSidecarResponse(value, this.#pending.request);
    } catch {
      this.#protocolFailure();
      return;
    }
    const pending = this.#takePending();
    if (pending === null) return;
    if (response.status === "error") {
      pending.reject(
        response.code === "cancelled"
          ? processError("cancelled", "The supervised team planner request was cancelled")
          : processError("planner-failed", "The supervised team planner request failed"),
      );
      return;
    }
    pending.resolve(response);
  }

  #handleStderr(chunk: Buffer): void {
    if (this.#failed || this.#closed) return;
    this.#stderrBytes += chunk.byteLength;
    if (this.#stderrBytes > MAX_STDERR_BYTES) this.#protocolFailure();
  }

  #handleProcessFailure(): void {
    if (this.#closing || this.#closed) {
      this.#markExited();
      return;
    }
    this.#fail(
      this.#readyReceived
        ? processError("unavailable", "The supervised team planner became unavailable")
        : processError("startup-failed", "The supervised team planner could not start"),
      false,
    );
    this.#markExited();
  }

  #handleExit(): void {
    this.#markExited();
    if (this.#closing || this.#closed) return;
    this.#fail(
      this.#readyReceived
        ? processError("unavailable", "The supervised team planner became unavailable")
        : processError("startup-failed", "The supervised team planner could not start"),
      false,
    );
  }

  #markExited(): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#resolveExit();
  }

  #protocolFailure(): void {
    this.#fail(
      processError(
        this.#readySettled ? "protocol-failed" : "startup-failed",
        this.#readySettled
          ? "The supervised team planner protocol failed"
          : "The supervised team planner handshake failed",
      ),
    );
  }

  #fail(error: TeamPlannerSidecarProcessError, terminate = true): void {
    if (this.#failed || this.#closed) return;
    this.#failed = true;
    this.#clearStartupTimer();
    if (!this.#readySettled) this.#rejectStartup(error);
    this.#rejectPending(error);
    if (terminate) void this.#terminate();
  }

  #rejectStartup(error: TeamPlannerSidecarProcessError): void {
    if (this.#readySettled) return;
    this.#readySettled = true;
    this.#rejectReady(error);
  }

  #takePending(): PendingRequest | null {
    const pending = this.#pending;
    if (pending === null) return null;
    this.#pending = null;
    clearTimeout(pending.timeout);
    pending.signal.removeEventListener("abort", pending.abortHandler);
    return pending;
  }

  #rejectPending(error: TeamPlannerSidecarProcessError): void {
    const pending = this.#takePending();
    pending?.reject(error);
  }

  #clearStartupTimer(): void {
    if (this.#startupTimer === null) return;
    clearTimeout(this.#startupTimer);
    this.#startupTimer = null;
  }

  #assertAvailable(): void {
    if (
      !this.#readySettled ||
      !this.#readyReceived ||
      this.#failed ||
      this.#closing ||
      this.#closed
    ) {
      throw processError("unavailable", "The supervised team planner is unavailable");
    }
  }

  #terminate(): Promise<void> {
    if (this.#termination !== null) return this.#termination;
    this.#closing = true;
    this.#termination = (async () => {
      try {
        this.#child.stdin.destroy();
        if (await this.#waitForProcessTreeExit(this.#terminationGraceMs)) return;
        signalProcessGroup(this.#child, "SIGTERM");
        if (await this.#waitForProcessTreeExit(this.#terminationGraceMs)) return;
        signalProcessGroup(this.#child, "SIGKILL");
        if (await this.#waitForProcessTreeExit(this.#terminationGraceMs)) return;
      } catch {
        throw processError(
          "cleanup-failed",
          "The supervised team planner process group could not be terminated",
        );
      }
      throw processError(
        "cleanup-failed",
        "The supervised team planner process group survived forced termination",
      );
    })();
    void this.#termination.catch(() => {});
    return this.#termination;
  }

  async #waitForProcessTreeExit(milliseconds: number): Promise<boolean> {
    if (process.platform !== "win32") {
      return waitForProcessGroupExit(this.#child, milliseconds);
    }
    if (this.#exited) return true;
    await Promise.race([this.#exit, delay(milliseconds)]);
    return this.#exited;
  }
}

export type { TeamPlannerAggregatePayload };
