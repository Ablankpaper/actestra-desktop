import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  GooseAcpHandshakeError,
  connectGooseAcp,
  type GooseAcpConnection,
  type GooseAcpInfo,
  type GooseAcpTransport,
} from "./gooseAcpHandshake";
import type { AdmittedGooseRunnerArtifact } from "./gooseRunnerArtifact";

const MAX_STDOUT_LINE_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const CLOSE_GRACE_MS = 1_000;
const TERMINATE_GRACE_MS = 1_000;
const MACOS_NO_NETWORK_PROFILE = "(version 1)(allow default)(deny network*)";

export type GooseRunnerProcessErrorCode =
  | "invalid-options"
  | "artifact-mismatch"
  | "network-policy-unavailable"
  | "spawn-failed"
  | "cleanup-failed";

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
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly networkPolicy: "deny-all";
}

export type GooseAcpTransportFactory = (options: GooseAcpSpawnOptions) => GooseAcpTransport;

export interface OpenGooseRunnerHandshakeOptions {
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly handshakeTimeoutMs?: number;
  readonly transportFactory?: GooseAcpTransportFactory;
}

export interface OpenGooseRunnerHandshakeResult {
  readonly info: GooseAcpInfo;
  readonly privateRoot: string;
  close(): Promise<void>;
}

function isAbsoluteDirectory(value: string): boolean {
  return typeof value === "string" && path.isAbsolute(value);
}

function currentTargetTriple(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  return undefined;
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
): Readonly<Record<string, string>> {
  if (!isAbsoluteDirectory(privateRoot)) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose private root must be an absolute path",
    );
  }
  const temporaryDirectory = path.join(privateRoot, "tmp");
  return Object.freeze({
    GOOSE_PATH_ROOT: privateRoot,
    GOOSE_TELEMETRY_OFF: "1",
    GOOSE_DISABLE_KEYRING: "1",
    HOME: path.join(privateRoot, "home"),
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    TZ: "UTC",
    OTEL_SDK_DISABLED: "true",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
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

class NodeGooseAcpTransport implements GooseAcpTransport {
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>();
  private readonly exitPromise: Promise<void>;
  private stdoutBuffer = "";
  private stderrBytes = 0;
  private exited = false;
  private transportFailed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
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
      this.stderrBytes += chunk.byteLength;
      if (this.stderrBytes > MAX_STDERR_BYTES) {
        this.failTransport(new Error("Goose stderr exceeded the bounded diagnostic size"));
      }
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on("error", (error) => {
        this.failTransport(error);
      });
    }
    child.once("error", (error) => {
      this.failTransport(error);
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

  private async waitForExit(milliseconds: number): Promise<boolean> {
    if (this.exited) {
      return true;
    }
    await Promise.race([this.exitPromise, wait(milliseconds)]);
    return this.exited;
  }

  private async closeProcess(): Promise<void> {
    if (this.exited) {
      return;
    }
    this.child.stdin.end();
    if (await this.waitForExit(CLOSE_GRACE_MS)) {
      return;
    }
    signalProcessGroup(this.child, "SIGTERM");
    if (await this.waitForExit(TERMINATE_GRACE_MS)) {
      return;
    }
    signalProcessGroup(this.child, "SIGKILL");
    if (!(await this.waitForExit(TERMINATE_GRACE_MS))) {
      throw new GooseRunnerProcessError(
        "cleanup-failed",
        "Goose process group did not exit after forced termination",
      );
    }
  }
}

function createNodeGooseAcpTransport(options: GooseAcpSpawnOptions): GooseAcpTransport {
  if (
    options.networkPolicy !== "deny-all" ||
    !path.isAbsolute(options.executablePath) ||
    !path.isAbsolute(options.workingDirectory)
  ) {
    throw new GooseRunnerProcessError("invalid-options", "Goose spawn options are invalid");
  }
  const privateRoot = path.dirname(options.workingDirectory);
  if (path.dirname(path.dirname(options.executablePath)) !== privateRoot) {
    throw new GooseRunnerProcessError(
      "invalid-options",
      "Goose executable and working directory must share one private root",
    );
  }
  if (process.platform !== "darwin" || !process.arch.includes("64")) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "P5.1 admits the deny-all Goose handshake launcher only on macOS",
    );
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", MACOS_NO_NETWORK_PROFILE, options.executablePath],
      {
        cwd: options.workingDirectory,
        env: { ...options.environment },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new GooseRunnerProcessError("spawn-failed", "Failed to launch Goose ACP process", {
      cause: error,
    });
  }
  return new NodeGooseAcpTransport(child);
}

async function preparePrivateRoot(
  parent: string,
  artifact: AdmittedGooseRunnerArtifact,
): Promise<{
  readonly root: string;
  readonly executablePath: string;
  readonly workingDirectory: string;
}> {
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

  const root = await mkdtemp(path.join(parent, "goose-attempt-"));
  try {
    const binaryDirectory = path.join(root, "bin");
    const workingDirectory = path.join(root, "work");
    await Promise.all(
      ["config", "data", "state", "home", "tmp", "bin", "work"].map((name) =>
        mkdir(path.join(root, name), { mode: 0o700 }),
      ),
    );
    const executableName =
      process.platform === "win32" ? "actestra-goose-runner.exe" : "actestra-goose-runner";
    const executablePath = path.join(binaryDirectory, executableName);
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
    return { root, executablePath, workingDirectory };
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

async function closeAndRemove(connection: GooseAcpConnection, privateRoot: string): Promise<void> {
  const errors: unknown[] = [];
  try {
    await connection.close();
  } catch (error) {
    errors.push(error);
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
): Promise<OpenGooseRunnerHandshakeResult> {
  const hostTargetTriple = currentTargetTriple();
  if (hostTargetTriple === undefined || options.artifact.targetTriple !== hostTargetTriple) {
    throw new GooseRunnerProcessError(
      "network-policy-unavailable",
      "P5.1 requires a Goose runner built for the current supported macOS host",
    );
  }
  let prepared:
    | { readonly root: string; readonly executablePath: string; readonly workingDirectory: string }
    | undefined;
  let transport: GooseAcpTransport | undefined;
  try {
    prepared = await preparePrivateRoot(options.privateRootParent, options.artifact);
    const spawnOptions: GooseAcpSpawnOptions = Object.freeze({
      executablePath: prepared.executablePath,
      workingDirectory: prepared.workingDirectory,
      environment: createGooseRunnerEnvironment(prepared.root),
      networkPolicy: "deny-all",
    });
    transport = (options.transportFactory ?? createNodeGooseAcpTransport)(spawnOptions);
    const connection = await connectGooseAcp(transport, {
      timeoutMs: options.handshakeTimeoutMs,
    });
    let closePromise: Promise<void> | undefined;
    return Object.freeze({
      info: connection.info,
      privateRoot: prepared.root,
      close(): Promise<void> {
        closePromise ??= closeAndRemove(connection, prepared!.root);
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
    if (error instanceof GooseAcpHandshakeError || error instanceof GooseRunnerProcessError) {
      throw error;
    }
    throw new GooseRunnerProcessError("spawn-failed", "Goose handshake launch failed", {
      cause: error,
    });
  }
}
