// @vitest-environment node

import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODING_FILE_READ_TOOL_ID } from "../../apps/desktop/src/core";
import { resolveAionCoreMainModelBinding } from "../../apps/desktop/src/main/model/aionCoreMainModelBinding";
import { installSessionSecurity } from "../../apps/desktop/src/main/security";
import { createIsolatedCodingWorktree } from "../../apps/desktop/src/main/workers/isolatedCodingWorktree";
import {
  startGooseLoopbackModelServer,
  type GooseLoopbackModelServer,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import {
  startGooseMcpCapabilityServer,
  type GooseMcpCapabilityServer,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  openGooseRunnerHandshake,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { EXPECTED_GOOSE_INITIALIZE_RESULT, LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const ATTEMPT_LEASE = "attempt-lease-0123456789abcdef0123456789abcdef";
const MODEL_LEASE = "model-lease-0123456789abcdef0123456789abcdef";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const WORKSPACE_DIRECTORY = path.resolve(os.tmpdir(), "actestra-p7-mcp-workspace");
const SUPERVISOR_FIXTURE = path.resolve("tests/fixtures/gooseRunnerSupervisorExit.ts");
const execFileAsync = promisify(execFile);

const mcpServers = new Set<GooseMcpCapabilityServer>();
const modelServers = new Set<GooseLoopbackModelServer>();
const fixtureDirectories: string[] = [];
const fixtureProcessGroups = new Set<number>();

interface McpResponse {
  readonly status: number;
  readonly body: string;
}

function initializeMessage(): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        extensions: {},
        roots: {},
        sampling: {},
        elicitation: {},
      },
      clientInfo: { name: "actestra-core", version: "0.1.0-alpha.0" },
    },
  };
}

async function postMcp(
  url: string,
  message: unknown,
  options: {
    readonly authorization?: string;
    readonly rawBody?: string;
    readonly contentType?: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<McpResponse> {
  const target = new URL(url);
  const body = options.rawBody ?? JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: options.method ?? "POST",
        agent: false,
        headers: {
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${options.authorization ?? ATTEMPT_LEASE}`,
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": options.contentType ?? "application/json",
          Host: target.host,
          "User-Agent": "goose/1.45.0",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function postModel(
  server: GooseLoopbackModelServer,
  body: Readonly<Record<string, unknown>> | undefined,
  options: { readonly authorization?: string; readonly rawBody?: string } = {},
): Promise<Response> {
  return fetch(`${server.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.authorization ?? MODEL_LEASE}`,
      "Content-Type": "application/json",
      "agent-session-id": "goose-session-1",
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

async function createLifecycleFixture(): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-worker-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const executable = Buffer.from("fixture-goose-runner", "utf8");
  await writeFile(executablePath, executable);
  await chmod(executablePath, 0o755);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
  };
}

async function createProcessGroupFixture(): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly processStatePath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-process-group-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  const processStatePath = path.join(directory, "process-state.json");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const sourcePath = path.join(directory, "process-group.c");
  // The compiled C fixture needs JSON escape sequences that TypeScript does not consume.
  // eslint-disable-next-line no-useless-escape
  const source = `#include <signal.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\nint main(void) {\n  pid_t descendant = fork();\n  if (descendant == 0) { signal(SIGTERM, SIG_IGN); while (1) pause(); }\n  const char *root = getenv("GOOSE_PATH_ROOT"); char statePath[4096]; snprintf(statePath, sizeof(statePath), "%s/work/process-state.json", root == NULL ? "." : root);\n  FILE *state = fopen(statePath, "w"); if (state == NULL) return 2; fprintf(state, "{\\\"leaderPid\\\":%d,\\\"descendantPid\\\":%d}", getpid(), descendant); fclose(state);\n  const char *response = "{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":\\\"actestra-goose-initialize-1\\\",\\\"result\\\":{\\\"protocolVersion\\\":1,\\\"agentCapabilities\\\":{\\\"loadSession\\\":true,\\\"promptCapabilities\\\":{\\\"image\\\":true,\\\"audio\\\":false,\\\"embeddedContext\\\":true},\\\"mcpCapabilities\\\":{\\\"http\\\":true,\\\"sse\\\":false},\\\"sessionCapabilities\\\":{\\\"list\\\":{},\\\"close\\\":{}},\\\"auth\\\":{}},\\\"authMethods\\\":[{\\\"id\\\":\\\"goose-provider\\\",\\\"name\\\":\\\"Configure Provider\\\",\\\"description\\\":\\\"Run \\\`goose configure\\\` to set up your AI provider and API key\\\"}],\\\"agentInfo\\\":{\\\"name\\\":\\\"goose\\\",\\\"version\\\":\\\"1.45.0\\\"}}}"; dprintf(STDOUT_FILENO, "%s\\n", response); char buffer[4096]; while (read(STDIN_FILENO, buffer, sizeof(buffer)) > 0) {} return 0; }\n`;
  await writeFile(sourcePath, source);
  const compile = spawnSync("clang", [sourcePath, "-o", executablePath], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`process fixture compile failed: ${compile.stderr}`);
  await chmod(executablePath, 0o755);
  const executable = await readFile(executablePath);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
    processStatePath,
  };
}

async function createProcessBehaviorFixture(
  behavior: "overflow" | "silent" | "crash" | "normal-exit" | "failing-exit",
): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `actestra-p7-${behavior}-`));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const sourcePath = path.join(directory, "process-behavior.c");
  const source = `#include <signal.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\nint main(void) {\n  const char *behavior = "${behavior}";\n  if (strcmp(behavior, "overflow") == 0) { for (int i = 0; i < 65537; i += 1) fputc('x', stdout); fflush(stdout); while (1) pause(); }\n  if (strcmp(behavior, "silent") == 0) { while (1) pause(); }\n  if (strcmp(behavior, "crash") == 0) { raise(SIGABRT); return 99; }\n  if (strcmp(behavior, "normal-exit") == 0) return 0;\n  return 7;\n}\n`;
  await writeFile(sourcePath, source);
  const compile = spawnSync("clang", [sourcePath, "-o", executablePath], { encoding: "utf8" });
  if (compile.status !== 0) {
    throw new Error(`process behavior fixture compile failed: ${compile.stderr}`);
  }
  await chmod(executablePath, 0o755);
  const executable = await readFile(executablePath);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
  };
}

async function createParentDeathFixture(): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-parent-death-fixture-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const sourcePath = path.join(directory, "parent-death.c");
  const initializeResult = JSON.stringify({
    jsonrpc: "2.0",
    id: "actestra-goose-initialize-1",
    result: EXPECTED_GOOSE_INITIALIZE_RESULT,
  })
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  const source = `#include <signal.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(void) {\n  pid_t descendant = fork();\n  if (descendant < 0) return 2;\n  if (descendant == 0) { while (1) pause(); }\n  dprintf(STDOUT_FILENO, "%s\\n", "${initializeResult}");\n  char byte; while (read(3, &byte, 1) > 0) {}\n  kill(0, SIGKILL);\n  return 0;\n}\n`;
  await writeFile(sourcePath, source);
  const compile = spawnSync("clang", [sourcePath, "-o", executablePath], { encoding: "utf8" });
  if (compile.status !== 0) {
    throw new Error(`parent-death fixture compile failed: ${compile.stderr}`);
  }
  await chmod(executablePath, 0o755);
  const executable = await readFile(executablePath);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
  };
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function readChildLine(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (child.stdout === null) {
      reject(new Error("Supervisor fixture stdout is unavailable"));
      return;
    }
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      child.stdout?.off("data", onData);
      resolve(output.slice(0, newline));
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Supervisor exited before readiness (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  });
}

async function runFixtureGit(repositoryRoot: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    "/usr/bin/git",
    ["-C", repositoryRoot, "-c", "core.hooksPath=/dev/null", ...args],
    {
      encoding: "utf8",
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        HOME: repositoryRoot,
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
      },
    },
  );
  return result.stdout.trim();
}

async function createWorktreeFixture(): Promise<{
  readonly managedRoot: string;
  readonly repositoryRoot: string;
}> {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-process-worktree-"));
  const root = await realpath(rawRoot);
  fixtureDirectories.push(root);
  const managedRoot = path.join(root, "managed");
  const repositoryRoot = path.join(root, "repository");
  await Promise.all([mkdir(managedRoot), mkdir(repositoryRoot)]);
  await runFixtureGit(repositoryRoot, "init");
  await runFixtureGit(repositoryRoot, "config", "user.name", "Actestra P7");
  await runFixtureGit(repositoryRoot, "config", "user.email", "p7@example.invalid");
  await writeFile(path.join(repositoryRoot, "sentinel.txt"), "unchanged\n", "utf8");
  await runFixtureGit(repositoryRoot, "add", "sentinel.txt");
  await runFixtureGit(repositoryRoot, "commit", "-m", "fixture");
  return { managedRoot, repositoryRoot };
}

async function createSandboxProbeFixture(options: {
  readonly hostileUrl: string;
  readonly hostReadPath: string;
}): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly probeStatePath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-sandbox-probe-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  const probeStatePath = path.join(directory, "probe-state.json");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const escapeCString = (value: string): string =>
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const port = Number(new URL(options.hostileUrl).port);
  const initJson = escapeCString(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "actestra-goose-initialize-1",
      result: EXPECTED_GOOSE_INITIALIZE_RESULT,
    }),
  );
  const sourcePath = path.join(directory, "probe.c");
  // The compiled C fixture needs JSON escape sequences that TypeScript does not consume.
  // eslint-disable-next-line no-useless-escape
  const source = `#include <arpa/inet.h>\n#include <fcntl.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/socket.h>\n#include <unistd.h>\nint main(void) {\n  int hostRead = open("${escapeCString(options.hostReadPath)}", O_RDONLY) >= 0;\n  int fd = socket(AF_INET, SOCK_STREAM, 0);\n  struct sockaddr_in addr; memset(&addr, 0, sizeof(addr)); addr.sin_family = AF_INET; addr.sin_port = htons(${String(port)}); inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);\n  int network = connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0;\n  if (fd >= 0) close(fd);\n  const char *root = getenv("GOOSE_PATH_ROOT"); char statePath[4096]; snprintf(statePath, sizeof(statePath), "%s/probe-state.json", root == NULL ? "." : root);\n  FILE *state = fopen(statePath, "w"); if (state == NULL) return 2; fprintf(state, "{\\\"network\\\":\\\"%s\\\",\\\"hostRead\\\":\\\"%s\\\"}", network ? "allowed" : "denied", hostRead ? "allowed" : "denied"); fclose(state);\n  dprintf(STDOUT_FILENO, "%s\\n", "${initJson}");\n  char buffer[4096]; while (read(STDIN_FILENO, buffer, sizeof(buffer)) > 0) {}\n  return 0;\n}\n`;
  await writeFile(sourcePath, source);
  const compile = spawnSync("clang", [sourcePath, "-o", executablePath], { encoding: "utf8" });
  if (compile.status !== 0) {
    throw new Error(`sandbox probe compile failed: ${compile.stderr}`);
  }
  await chmod(executablePath, 0o755);
  const executable = await readFile(executablePath);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
    probeStatePath,
  };
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function expectProcessGone(processId: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processIsAlive(processId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(processIsAlive(processId)).toBe(false);
}

function cleanupProcessGroup(leaderPid: number): void {
  try {
    process.kill(-leaderPid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function readyMcpServer(server: GooseMcpCapabilityServer): Promise<void> {
  await expect(
    postMcpWithoutProtocolHeader(server.url, initializeMessage()),
  ).resolves.toMatchObject({
    status: 200,
  });
  await expect(
    postMcp(server.url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  ).resolves.toMatchObject({ status: 202 });
  await expect(
    postMcp(server.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: { _meta: { "agent-session-id": "goose-session-1" } },
    }),
  ).resolves.toMatchObject({ status: 200 });
}

function readToolCallMessage(
  requestId: number,
  toolCallRequestId: string,
): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name: CODING_FILE_READ_TOOL_ID,
      arguments: { contractVersion: 1, relativePath: "README.md" },
      _meta: {
        "agent-session-id": "goose-session-1",
        "agent-working-dir": WORKSPACE_DIRECTORY,
        "agent-tool-call-request-id": toolCallRequestId,
      },
    },
  };
}

afterEach(async () => {
  for (const processGroupId of fixtureProcessGroups) {
    cleanupProcessGroup(processGroupId);
  }
  fixtureProcessGroups.clear();
  await Promise.all([
    ...[...mcpServers].map((server) => server.close()),
    ...[...modelServers].map((server) => server.close()),
    ...fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  ]);
  mcpServers.clear();
  modelServers.clear();
});

describe("P7 MCP, Worker, network, and process abuse baseline", () => {
  for (const { variant, expectedStatus, options } of [
    {
      variant: "WRONG-LEASE",
      expectedStatus: 401,
      options: {
        authorization: "wrong-lease-0123456789abcdef0123456789abcdef",
      },
    },
    {
      variant: "WRONG-TOKEN",
      expectedStatus: 401,
      options: { headers: { Authorization: ATTEMPT_LEASE } },
    },
    {
      variant: "WRONG-HOST",
      expectedStatus: 400,
      options: { headers: { Host: "localhost" } },
    },
    {
      variant: "WRONG-ORIGIN",
      expectedStatus: 403,
      options: { headers: { Origin: "https://example.invalid" } },
    },
    {
      variant: "WRONG-USER-AGENT",
      expectedStatus: 403,
      options: { headers: { "User-Agent": "curl/9" } },
    },
    {
      variant: "WRONG-METHOD",
      expectedStatus: 405,
      options: { method: "GET" },
    },
    {
      variant: "WRONG-CONTENT-TYPE",
      expectedStatus: 415,
      options: { contentType: "text/plain" },
    },
  ] as const) {
    it(`P7-A-MCP-001 P7-V-MCP-001-${variant}`, async () => {
      let toolInvocations = 0;
      const mcp = await startGooseMcpCapabilityServer({
        attemptLease: ATTEMPT_LEASE,
        commandIds: ["format-check"],
        testIds: ["focused-tests"],
        workspaceDirectory: WORKSPACE_DIRECTORY,
        invokeTool: async () => {
          toolInvocations += 1;
          return Object.freeze({ isError: false, content: "never invoked" });
        },
      });
      mcpServers.add(mcp);

      const rejected = await postMcp(mcp.url, initializeMessage(), options);

      expect(rejected.status).toBe(expectedStatus);
      expect(toolInvocations).toBe(0);
      await expect(
        postMcpWithoutProtocolHeader(mcp.url, initializeMessage()),
      ).resolves.toMatchObject({ status: 200 });
    });
  }

  it("P7-A-MCP-001 P7-V-MCP-001-WRONG-MODEL", async () => {
    let modelInvocations = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        modelInvocations += 1;
        return Object.freeze({
          type: "message" as const,
          text: "never served",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");

    const rejected = await postModel(model, {
      model: "unadmitted-p7-model",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });

    expect(rejected.status).toBe(400);
    expect(modelInvocations).toBe(0);
  });

  it("P7-A-MCP-001 P7-V-MCP-001-INVALID-INITIALIZATION-ORDER", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "never invoked" });
      },
    });
    mcpServers.add(mcp);

    const rejected = await postMcpWithoutProtocolHeader(mcp.url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(rejected.status).toBe(400);
    expect(toolInvocations).toBe(0);
    await expect(postMcpWithoutProtocolHeader(mcp.url, initializeMessage())).resolves.toMatchObject(
      {
        status: 200,
      },
    );
  });

  it("P7-A-MCP-002 P7-V-MCP-002-MALFORMED-JSON", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "never invoked" });
      },
    });
    mcpServers.add(mcp);

    const rejected = await postMcpWithoutProtocolHeader(mcp.url, undefined, {
      rawBody: "{",
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toContain("-32700");
    expect(toolInvocations).toBe(0);
    await expect(postMcpWithoutProtocolHeader(mcp.url, initializeMessage())).resolves.toMatchObject(
      {
        status: 200,
      },
    );
  });

  it("P7-A-MCP-002 P7-V-MCP-002-MALFORMED-SSE", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "never invoked" });
      },
    });
    mcpServers.add(mcp);

    const rejected = await postMcpWithoutProtocolHeader(mcp.url, undefined, {
      rawBody: `data: ${JSON.stringify(initializeMessage())}\n\n`,
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toContain("-32700");
    expect(toolInvocations).toBe(0);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-OVERSIZED-BODY", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "never invoked" });
      },
    });
    mcpServers.add(mcp);

    const rejected = await postMcpWithoutProtocolHeader(mcp.url, undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(65_536) }),
    });

    expect(rejected.status).toBe(413);
    expect(toolInvocations).toBe(0);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-OVERSIZED-FRAME", async () => {
    let modelInvocations = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        modelInvocations += 1;
        return Object.freeze({
          type: "message" as const,
          text: "never served",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");

    const outcome = await postModel(model, undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024 + 1) }),
    }).then(
      (response) => response.status,
      (error: unknown) => (error as { readonly cause?: { readonly code?: string } }).cause?.code,
    );

    expect([400, "ECONNRESET"]).toContain(outcome);
    expect(modelInvocations).toBe(0);
    expect(model.servedInferenceCount).toBe(0);
    expect(model.refusedInferenceCount).toBe(0);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-OVERSIZED-TREE", async () => {
    let modelInvocations = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        modelInvocations += 1;
        return Object.freeze({
          type: "message" as const,
          text: "never served",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");

    const rejected = await postModel(model, {
      model: "actestra-p7-model",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: {
            name: CODING_FILE_READ_TOOL_ID,
            parameters: {
              values: Array.from({ length: 16_384 }, () => null),
            },
          },
        },
      ],
      stream: true,
    });

    expect(rejected.status).toBe(400);
    expect(modelInvocations).toBe(0);
    expect(model.rejectedRequestCount).toBe(1);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-DUPLICATE-IDENTITY", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "bounded result" });
      },
    });
    mcpServers.add(mcp);
    await readyMcpServer(mcp);

    const first = await postMcp(mcp.url, readToolCallMessage(3, "duplicate-call-id"));
    const replay = await postMcp(mcp.url, readToolCallMessage(4, "duplicate-call-id"));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(400);
    expect(toolInvocations).toBe(1);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-REQUEST-AFTER-CLOSE", async () => {
    let toolInvocations = 0;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => {
        toolInvocations += 1;
        return Object.freeze({ isError: false, content: "never invoked" });
      },
    });
    mcpServers.add(mcp);

    await mcp.close();

    await expect(postMcpWithoutProtocolHeader(mcp.url, initializeMessage())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    expect(toolInvocations).toBe(0);
  });

  it("P7-A-MCP-002 P7-V-MCP-002-IN-FLIGHT-CLOSE", async () => {
    let toolInvocations = 0;
    let entered!: () => void;
    const invocationEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let observedAbortReason: unknown;
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async (call) => {
        toolInvocations += 1;
        entered();
        await new Promise<void>((resolve) => {
          call.signal.addEventListener(
            "abort",
            () => {
              observedAbortReason = call.signal.reason;
              resolve();
            },
            { once: true },
          );
        });
        return Object.freeze({ isError: true, content: "cancelled" });
      },
    });
    mcpServers.add(mcp);
    await readyMcpServer(mcp);

    const request = postMcp(mcp.url, readToolCallMessage(3, "in-flight-call")).catch(
      (): undefined => undefined,
    );
    await invocationEntered;

    await expect(mcp.close()).resolves.toBeUndefined();
    await request;

    expect(toolInvocations).toBe(1);
    expect(observedAbortReason).toBe("goose-mcp-capability-server-closing");
  });

  it("P7-A-MCP-003 P7-V-MCP-003-UNDECLARED-TOOL", async () => {
    let invocationCount = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-p7-undeclared",
          name: "actestra-capability-proxy__coding.file.write",
          arguments: Object.freeze({ contractVersion: 1 }),
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");
    const undeclared = await postModel(model, {
      model: "actestra-p7-model",
      messages: [{ role: "user", content: "Use the declared read tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: CODING_FILE_READ_TOOL_ID,
            parameters: { type: "object" },
          },
        },
      ],
      stream: true,
    });
    expect(undeclared.status).toBe(400);
    expect(model.refusedInferenceCount).toBe(1);
    expect(invocationCount).toBe(1);
    expect(model.servedInferenceCount).toBe(0);
  });

  it("P7-A-MCP-003 P7-V-MCP-003-AMBIGUOUS-ALIAS", async () => {
    let invocationCount = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return Object.freeze({
          type: "message" as const,
          text: "never served",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");

    const ambiguous = await postModel(model, {
      model: "actestra-p7-model",
      messages: [{ role: "user", content: "Do not invoke an ambiguous tool." }],
      tools: [
        {
          type: "function",
          function: { name: "a.b", parameters: { type: "object" } },
        },
        {
          type: "function",
          function: { name: "a_b", parameters: { type: "object" } },
        },
      ],
      stream: true,
    });
    expect(ambiguous.status).toBe(400);
    expect(invocationCount).toBe(0);
    expect(model.servedInferenceCount).toBe(0);
  });

  it("P7-A-MCP-003 P7-V-MCP-003-INVALID-TOOL-COUNT", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const binding = await resolveAionCoreMainModelBinding({
        selection: { providerId: "provider-p7", modelId: "actestra-p7-model" },
        listProviders: async () => [
          {
            id: "provider-p7",
            platform: "openai",
            name: "P7 fixture",
            base_url: "https://gateway.invalid/v1",
            api_key: "provider-secret-placeholder",
            models: ["actestra-p7-model"],
            enabled: true,
            capabilities: [{ type: "text" }, { type: "function_calling" }],
            model_health: { "actestra-p7-model": { status: "healthy" } },
          },
        ],
        createClient: async () => ({
          createChatCompletion: async () =>
            (async function* () {
              yield {
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: "call-first",
                          function: { name: "read_file", arguments: '{"path":"a.txt"}' },
                        },
                        {
                          index: 1,
                          id: "call-second",
                          function: { name: "read_file", arguments: '{"path":"b.txt"}' },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };
            })(),
        }),
      });
      if (binding === null) throw new Error("Expected an admitted P7 model binding");

      await expect(
        binding.invokeModel(
          {
            sessionId: "goose-session-1",
            purpose: "coding",
            messages: [{ role: "user", content: "Read one file." }],
            tools: [
              {
                name: "read_file",
                inputSchema: { type: "object" },
              },
            ],
            responseMode: "text-or-tool-call",
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow("AionCore model completion is unavailable");
      const diagnostic = warn.mock.calls
        .map(([entry]) => String(entry))
        .find((entry) => entry.startsWith("ACTESTRA_AIONUI_MODEL_COMPLETION_REJECTED "));
      expect(diagnostic).toContain('"reason":"tool-call-count-unsupported"');
      expect(diagnostic).not.toContain("provider-secret-placeholder");
    } finally {
      warn.mockRestore();
    }
  });

  it("P7-A-MCP-003 P7-V-MCP-003-UNMODELED-PROVIDER-FIELD", async () => {
    let invocationCount = 0;
    const model = await startGooseLoopbackModelServer({
      modelId: "actestra-p7-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return Object.freeze({
          type: "message" as const,
          text: "never served",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        });
      },
    });
    modelServers.add(model);
    model.bindSession("goose-session-1");

    const rejected = await postModel(model, {
      model: "actestra-p7-model",
      messages: [{ role: "user", content: "x" }],
      stream: true,
      headers: { Authorization: "must-not-cross-main" },
    });

    expect(rejected.status).toBe(400);
    expect(invocationCount).toBe(0);
    expect(model.rejectedRequestCount).toBe(1);
  });

  it("P7-A-WORKER-001 P7-V-WORKER-001-UNADMITTED-EXECUTABLE", async () => {
    const fixture = await createLifecycleFixture();
    const unadmittedExecutable = path.join(
      path.dirname(fixture.artifact.directory),
      "unadmitted-goose-runner",
    );
    await writeFile(unadmittedExecutable, "unadmitted bytes", "utf8");
    await chmod(unadmittedExecutable, 0o755);
    let transportCreations = 0;

    await expect(
      openGooseRunnerHandshake({
        artifact: { ...fixture.artifact, executablePath: unadmittedExecutable },
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => {
          transportCreations += 1;
          return new LoopbackGooseAcpTransport();
        },
      }),
    ).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(transportCreations).toBe(0);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-WORKER-001 P7-V-WORKER-001-UNADMITTED-DIGEST", async () => {
    const fixture = await createLifecycleFixture();
    let transportCreations = 0;

    await expect(
      openGooseRunnerHandshake({
        artifact: { ...fixture.artifact, executableSha256: "f".repeat(64) },
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => {
          transportCreations += 1;
          return new LoopbackGooseAcpTransport();
        },
      }),
    ).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(transportCreations).toBe(0);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-WORKER-001 P7-V-WORKER-001-WIDENED-CAPABILITIES", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new LoopbackGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentCapabilities: {
          ...EXPECTED_GOOSE_INITIALIZE_RESULT.agentCapabilities,
          mcpCapabilities: {
            ...EXPECTED_GOOSE_INITIALIZE_RESULT.agentCapabilities.mcpCapabilities,
            sse: true,
          },
        },
      },
    });

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => transport,
      }),
    ).rejects.toMatchObject({ code: "unexpected-capabilities" });
    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-WORKER-001 P7-V-WORKER-001-INHERITED-ENVIRONMENT-SECRET", async () => {
    const fixture = await createLifecycleFixture();
    const inheritedName = "ACTESTRA_P7_INHERITED_SECRET";
    const inheritedSecret = "p7-secret-canary-must-not-enter-worker";
    const previous = process.env[inheritedName];
    process.env[inheritedName] = inheritedSecret;
    let spawnOptions: GooseAcpSpawnOptions | undefined;
    try {
      const opened = await openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        modelBinding: {
          baseUrl: "http://127.0.0.1:43124/v1",
          modelId: "actestra-p7-model",
          attemptLease: MODEL_LEASE,
        },
        transportFactory: (options) => {
          spawnOptions = options;
          return new LoopbackGooseAcpTransport();
        },
      });

      const serializedEnvironment = JSON.stringify(spawnOptions?.environment ?? {});
      expect(spawnOptions?.environment.OPENAI_BASE_URL).toBe("http://127.0.0.1:43124/v1");
      expect(spawnOptions?.environment.OPENAI_API_KEY).toBe(MODEL_LEASE);
      expect(Object.keys(spawnOptions?.environment ?? {})).not.toContain("PATH");
      expect(spawnOptions?.environment).not.toHaveProperty(inheritedName);
      expect(serializedEnvironment).not.toContain(inheritedSecret);
      await opened.close();
    } finally {
      if (previous === undefined) {
        delete process.env[inheritedName];
      } else {
        process.env[inheritedName] = previous;
      }
    }
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-NETWORK-001 P7-V-NETWORK-001-RENDERER-EXTERNAL-NETWORK", () => {
    let requestListener:
      | ((
          details: Readonly<{ url: string }>,
          callback: (result: { cancel: boolean }) => void,
        ) => void)
      | undefined;
    installSessionSecurity(
      {
        setPermissionRequestHandler: () => {},
        webRequest: {
          onBeforeRequest: (_filter: unknown, listener: typeof requestListener) => {
            requestListener = listener;
          },
        },
      } as never,
      true,
    );
    const externalResult = vi.fn();
    const undeclaredLoopbackResult = vi.fn();

    requestListener?.({ url: "https://example.invalid/p7" }, externalResult);
    requestListener?.({ url: "http://127.0.0.1:49152/p7" }, undeclaredLoopbackResult);

    expect(externalResult).toHaveBeenCalledWith({ cancel: true });
    expect(undeclaredLoopbackResult).toHaveBeenCalledWith({ cancel: true });
  });

  it("P7-A-NETWORK-001 P7-V-NETWORK-001-WORKER-EXTERNAL-NETWORK", async () => {
    let hostileHits = 0;
    const hostile = http.createServer((_request, response) => {
      hostileHits += 1;
      response.end("unexpected");
    });
    await new Promise<void>((resolve) => hostile.listen(0, "127.0.0.1", () => resolve()));
    const address = hostile.address();
    if (address === null || typeof address === "string") {
      throw new Error("Hostile listener did not expose a TCP port");
    }
    const probe = await createSandboxProbeFixture({
      hostileUrl: `http://127.0.0.1:${String(address.port)}/hostile`,
      hostReadPath: os.homedir(),
    });
    const probeOpened = await openGooseRunnerHandshake({
      artifact: probe.artifact,
      privateRootParent: probe.privateRootParent,
    });
    try {
      const probeState = JSON.parse(
        await readFile(path.join(probeOpened.privateRoot, "probe-state.json"), "utf8"),
      ) as {
        readonly network: string;
        readonly hostRead: string;
      };
      expect(probeState.network).toBe("denied");
      expect(probeState.hostRead).toBe("denied");
      expect(hostileHits).toBe(0);
    } finally {
      await probeOpened.close();
      await new Promise<void>((resolve, reject) =>
        hostile.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(await readdir(probe.privateRootParent)).toEqual([]);
  }, 15_000);

  it("P7-A-NETWORK-001 P7-V-NETWORK-001-UNDECLARED-LOOPBACK-DESTINATION", async () => {
    let hostileHits = 0;
    const hostile = http.createServer((_request, response) => {
      hostileHits += 1;
      response.end("unexpected");
    });
    await new Promise<void>((resolve) => hostile.listen(0, "127.0.0.1", () => resolve()));
    const address = hostile.address();
    if (address === null || typeof address === "string") {
      throw new Error("Hostile listener did not expose a TCP port");
    }
    const capabilityPort = address.port === 43_123 ? 43_125 : 43_123;
    const modelPort = address.port === 43_124 ? 43_126 : 43_124;
    const probe = await createSandboxProbeFixture({
      hostileUrl: `http://127.0.0.1:${String(address.port)}/hostile`,
      hostReadPath: os.homedir(),
    });
    const opened = await openGooseRunnerHandshake({
      artifact: probe.artifact,
      privateRootParent: probe.privateRootParent,
      capabilityProxyUrl: `http://127.0.0.1:${String(capabilityPort)}/mcp`,
      modelBinding: {
        baseUrl: `http://127.0.0.1:${String(modelPort)}/v1`,
        modelId: "actestra-p7-model",
        attemptLease: MODEL_LEASE,
      },
    });
    try {
      const probeState = JSON.parse(
        await readFile(path.join(opened.privateRoot, "probe-state.json"), "utf8"),
      ) as { readonly network: string };
      expect(probeState.network).toBe("denied");
      expect(hostileHits).toBe(0);
    } finally {
      await opened.close();
      await new Promise<void>((resolve, reject) =>
        hostile.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(await readdir(probe.privateRootParent)).toEqual([]);
  }, 15_000);

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-UNEXPECTED-CHILD", async () => {
    const fixture = await createProcessGroupFixture();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
    });
    const processState = JSON.parse(
      await readFile(path.join(opened.privateRoot, "work", "process-state.json"), "utf8"),
    ) as { readonly leaderPid: number; readonly descendantPid: number };
    fixtureProcessGroups.add(processState.leaderPid);
    try {
      expect(processIsAlive(processState.descendantPid)).toBe(true);
      await opened.close();
      await expectProcessGone(processState.leaderPid);
      await expectProcessGone(processState.descendantPid);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
      fixtureProcessGroups.delete(processState.leaderPid);
    } finally {
      cleanupProcessGroup(processState.leaderPid);
      fixtureProcessGroups.delete(processState.leaderPid);
    }
  });

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-OUTPUT-OVERFLOW", async () => {
    const fixture = await createProcessBehaviorFixture("overflow");

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        handshakeTimeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "transport-error" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  }, 10_000);

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-TIMEOUT", async () => {
    const fixture = await createProcessBehaviorFixture("silent");

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        handshakeTimeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "startup-timeout" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  }, 10_000);

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-CRASH", async () => {
    const fixture = await createProcessBehaviorFixture("crash");

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
      }),
    ).rejects.toMatchObject({ code: "process-exit" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-CANCELLATION", async () => {
    const fixture = await createProcessGroupFixture();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
    });
    const processState = JSON.parse(
      await readFile(path.join(opened.privateRoot, "work", "process-state.json"), "utf8"),
    ) as { readonly leaderPid: number; readonly descendantPid: number };
    fixtureProcessGroups.add(processState.leaderPid);
    try {
      await opened.close();
      await expectProcessGone(processState.leaderPid);
      await expectProcessGone(processState.descendantPid);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
      fixtureProcessGroups.delete(processState.leaderPid);
    } finally {
      cleanupProcessGroup(processState.leaderPid);
      fixtureProcessGroups.delete(processState.leaderPid);
    }
  });

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-NORMAL-LEADER-EXIT", async () => {
    const fixture = await createProcessBehaviorFixture("normal-exit");

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
      }),
    ).rejects.toMatchObject({ code: "process-exit" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-PROCESS-001 P7-V-PROCESS-001-FAILING-LEADER-EXIT", async () => {
    const fixture = await createProcessBehaviorFixture("failing-exit");

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
      }),
    ).rejects.toMatchObject({ code: "process-exit" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-PARENT-DEATH", async () => {
    const fixture = await createParentDeathFixture();
    const fixtureRoot = path.dirname(fixture.artifact.directory);
    const metadataPath = path.join(fixtureRoot, "supervisor-options.json");
    const statePath = path.join(fixtureRoot, "supervisor-state.json");
    await writeFile(
      metadataPath,
      JSON.stringify({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        handshakeTimeoutMs: 5_000,
      }),
    );
    const supervisor = spawn("bun", [SUPERVISOR_FIXTURE, metadataPath, statePath], {
      cwd: path.resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let processIds: number[] = [];
    try {
      await expect(readChildLine(supervisor)).resolves.toBe("READY");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        readonly privateRoot: string;
      };
      const matched = spawnSync(
        "pgrep",
        ["-f", path.join(state.privateRoot, "bin", "actestra-goose-runner")],
        { encoding: "utf8" },
      );
      processIds = matched.stdout.trim().split("\n").map(Number).filter(Number.isSafeInteger);
      expect(processIds.length).toBeGreaterThanOrEqual(1);
      fixtureProcessGroups.add(processIds[0]!);

      process.kill(supervisor.pid!, "SIGKILL");
      await expect(waitForChildExit(supervisor)).resolves.toBeNull();
      for (const processId of processIds) {
        await expectProcessGone(processId);
      }
      fixtureProcessGroups.delete(processIds[0]!);
    } finally {
      if (supervisor.pid !== undefined && processIsAlive(supervisor.pid)) {
        process.kill(supervisor.pid, "SIGKILL");
      }
      if (processIds[0] !== undefined) {
        cleanupProcessGroup(processIds[0]);
        fixtureProcessGroups.delete(processIds[0]);
      }
    }
  }, 15_000);

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-CLOSE-RACE", async () => {
    const fixture = await createProcessGroupFixture();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
    });
    const processState = JSON.parse(
      await readFile(path.join(opened.privateRoot, "work", "process-state.json"), "utf8"),
    ) as {
      readonly leaderPid: number;
      readonly descendantPid: number;
    };
    fixtureProcessGroups.add(processState.leaderPid);
    try {
      expect(processIsAlive(processState.leaderPid)).toBe(true);
      expect(processIsAlive(processState.descendantPid)).toBe(true);
      await Promise.all([opened.close(), opened.close(), opened.close()]);
      await expectProcessGone(processState.leaderPid);
      await expectProcessGone(processState.descendantPid);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
      fixtureProcessGroups.delete(processState.leaderPid);
    } finally {
      cleanupProcessGroup(processState.leaderPid);
      fixtureProcessGroups.delete(processState.leaderPid);
    }
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-CLEANUP-RETRY", async () => {
    const fixture = await createWorktreeFixture();
    const opened = await createIsolatedCodingWorktree(fixture);
    let locked = false;
    try {
      await runFixtureGit(fixture.repositoryRoot, "worktree", "lock", opened.worktreeRoot);
      locked = true;
      await expect(opened.close()).rejects.toMatchObject({ code: "cleanup-failed" });
      await expect(stat(opened.worktreeRoot)).resolves.toMatchObject({});

      await runFixtureGit(fixture.repositoryRoot, "worktree", "unlock", opened.worktreeRoot);
      locked = false;
      await expect(opened.close()).resolves.toBeUndefined();
      await expect(stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (locked) {
        await runFixtureGit(
          fixture.repositoryRoot,
          "worktree",
          "unlock",
          opened.worktreeRoot,
        ).catch((): undefined => undefined);
      }
      await opened.close().catch((): undefined => undefined);
    }
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-RESIDUAL-PROCESS-SCAN", async () => {
    const fixture = await createProcessGroupFixture();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
    });
    const processState = JSON.parse(
      await readFile(path.join(opened.privateRoot, "work", "process-state.json"), "utf8"),
    ) as { readonly leaderPid: number; readonly descendantPid: number };
    fixtureProcessGroups.add(processState.leaderPid);
    try {
      await opened.close();
      await expectProcessGone(processState.leaderPid);
      await expectProcessGone(processState.descendantPid);
      expect(() => process.kill(-processState.leaderPid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
      fixtureProcessGroups.delete(processState.leaderPid);
    } finally {
      cleanupProcessGroup(processState.leaderPid);
      fixtureProcessGroups.delete(processState.leaderPid);
    }
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-RESIDUAL-PRIVATE-ROOT-SCAN", async () => {
    const fixture = await createProcessGroupFixture();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
    });
    const processState = JSON.parse(
      await readFile(path.join(opened.privateRoot, "work", "process-state.json"), "utf8"),
    ) as { readonly leaderPid: number };
    fixtureProcessGroups.add(processState.leaderPid);
    try {
      const privateRoot = opened.privateRoot;
      await opened.close();
      await expectProcessGone(processState.leaderPid);
      await expect(stat(privateRoot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
      fixtureProcessGroups.delete(processState.leaderPid);
    } finally {
      cleanupProcessGroup(processState.leaderPid);
      fixtureProcessGroups.delete(processState.leaderPid);
    }
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-RESIDUAL-WORKTREE-SCAN", async () => {
    const fixture = await createWorktreeFixture();
    const opened = await createIsolatedCodingWorktree(fixture);
    const worktreeRoot = opened.worktreeRoot;

    await opened.close();

    await expect(stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await runFixtureGit(fixture.repositoryRoot, "worktree", "list", "--porcelain"),
    ).not.toContain(`worktree ${worktreeRoot}`);
  });

  it("P7-A-PROCESS-002 P7-V-PROCESS-002-RESIDUAL-REPOSITORY-LOCK-SCAN", async () => {
    const fixture = await createWorktreeFixture();
    const opened = await createIsolatedCodingWorktree(fixture);
    const lockPaths = [
      path.join(opened.gitCommonDirectory, "config.lock"),
      path.join(opened.gitDirectory, "config.worktree.lock"),
    ];

    await opened.close();

    for (const lockPath of lockPaths) {
      await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

async function postMcpWithoutProtocolHeader(
  url: string,
  message: unknown,
  options: { readonly rawBody?: string } = {},
): Promise<McpResponse> {
  const target = new URL(url);
  const body = options.rawBody ?? JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: "POST",
        agent: false,
        headers: {
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${ATTEMPT_LEASE}`,
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "application/json",
          Host: target.host,
          "User-Agent": "goose/1.45.0",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}
