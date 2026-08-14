// @vitest-environment node

import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CODING_FILE_READ_TOOL_ID } from "../../apps/desktop/src/core";
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
  createGooseRunnerEnvironment,
  openGooseRunnerHandshake,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { EXPECTED_GOOSE_INITIALIZE_RESULT, LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const ATTEMPT_LEASE = "attempt-lease-0123456789abcdef0123456789abcdef";
const MODEL_LEASE = "model-lease-0123456789abcdef0123456789abcdef";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const WORKSPACE_DIRECTORY = path.resolve(os.tmpdir(), "actestra-p7-mcp-workspace");

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
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
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
  it("P7-A-MCP-001 rejects unauthenticated loopback peers", async () => {
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
    const wrongModelLease = await postModel(
      model,
      {
        model: "actestra-p7-model",
        messages: [{ role: "user", content: "x" }],
        stream: true,
      },
      { authorization: "wrong-lease-0123456789abcdef0123456789abcdef" },
    );
    expect(wrongModelLease.status).toBe(401);
    expect(modelInvocations).toBe(0);

    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => Object.freeze({ isError: false, content: "never invoked" }),
    });
    mcpServers.add(mcp);
    const wrongMcpLease = await postMcp(mcp.url, initializeMessage(), {
      authorization: "wrong-lease-0123456789abcdef0123456789abcdef",
    });
    expect(wrongMcpLease.status).toBe(401);
    const validMcp = await postMcpWithoutProtocolHeader(mcp.url, initializeMessage());
    expect(validMcp.status).toBe(200);
  });

  it("P7-A-MCP-002 rejects malformed or oversized protocol frames", async () => {
    const mcp = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds: ["format-check"],
      testIds: ["focused-tests"],
      workspaceDirectory: WORKSPACE_DIRECTORY,
      invokeTool: async () => Object.freeze({ isError: false, content: "never invoked" }),
    });
    mcpServers.add(mcp);
    const malformed = await postMcpWithoutProtocolHeader(mcp.url, undefined, {
      rawBody: "{",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toContain("-32700");
    const oversized = await postMcpWithoutProtocolHeader(mcp.url, undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(65_536) }),
    });
    expect(oversized.status).toBe(413);

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
    const malformedModel = await postModel(model, undefined, { rawBody: "{" });
    expect(malformedModel.status).toBe(400);
    await postModel(model, undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
    }).catch(() => undefined);
    expect(modelInvocations).toBe(0);
    expect(model.rejectedRequestCount).toBeGreaterThanOrEqual(1);

    await expect(mcp.close()).resolves.toBeUndefined();
    await expect(postMcp(mcp.url, initializeMessage())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });

  it("P7-A-MCP-003 rejects undeclared and ambiguous model tools", async () => {
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
    expect(invocationCount).toBe(1);
    expect(model.servedInferenceCount).toBe(0);
  });

  it("P7-A-WORKER-001 rejects unadmitted Worker capabilities", async () => {
    const fixture = await createLifecycleFixture();
    const environment = createGooseRunnerEnvironment(path.join(fixture.privateRootParent, "root"));
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("HTTP_PROXY");
    expect(environment).not.toHaveProperty("HTTPS_PROXY");

    await expect(
      openGooseRunnerHandshake({
        artifact: { ...fixture.artifact, executableSha256: "f".repeat(64) },
        privateRootParent: fixture.privateRootParent,
      }),
    ).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);

    let spawnOptions: GooseAcpSpawnOptions | undefined;
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
    expect(spawnOptions?.environment.OPENAI_BASE_URL).toBe("http://127.0.0.1:43124/v1");
    expect(spawnOptions?.environment.OPENAI_API_KEY).toBe(MODEL_LEASE);
    expect(Object.keys(spawnOptions?.environment ?? {})).not.toContain("PATH");
    await opened.close();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-NETWORK-001 blocks undeclared network effects", async () => {
    const fixture = await createLifecycleFixture();
    let spawnOptions: GooseAcpSpawnOptions | undefined;
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
    expect(spawnOptions?.networkPolicy).toEqual({
      kind: "loopback-session",
      host: "127.0.0.1",
      capabilityProxyPort: 43_123,
      modelProxyPort: 43_124,
    });
    expect(spawnOptions?.environment.NO_PROXY).toBe("127.0.0.1,localhost");
    expect(spawnOptions?.environment.OPENAI_BASE_URL).toBe("http://127.0.0.1:43124/v1");
    await opened.close();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);

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

  it("P7-A-PROCESS-001 bounds Worker process outcomes", async () => {
    const fixture = await createLifecycleFixture();
    const unsupported = new LoopbackGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentInfo: { name: "goose", version: "1.44.0" },
      },
    });
    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => unsupported,
      }),
    ).rejects.toMatchObject({ code: "unsupported-version" });
    expect(unsupported.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);

    const healthy = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: () => new LoopbackGooseAcpTransport(),
    });
    await healthy.close();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("P7-A-PROCESS-002 cleans Worker process groups", async () => {
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
      await opened.close();
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
