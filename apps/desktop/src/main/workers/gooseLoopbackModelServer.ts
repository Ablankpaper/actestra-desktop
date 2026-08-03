import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

const LOOPBACK_HOST = "127.0.0.1";
const MODEL_CATALOG_PATH = "/v1/models";
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const MAX_INFERENCE_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_TEXT_BYTES = 256 * 1024;

export type GooseLoopbackModelServerErrorCode = "invalid-config" | "listen-failed";

export class GooseLoopbackModelServerError extends Error {
  constructor(
    readonly code: GooseLoopbackModelServerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseLoopbackModelServerError";
  }
}

export interface StartGooseLoopbackModelServerOptions {
  readonly modelId: string;
  readonly attemptLease: string;
  readonly invokeModel: GooseLoopbackModelInvoker;
}

export interface GooseLoopbackModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export type GooseLoopbackModelCompletion =
  | Readonly<{
      type: "message";
      text: string;
      usage: GooseLoopbackModelUsage;
    }>
  | Readonly<{
      type: "tool-call";
      callId: string;
      name: string;
      arguments: Readonly<Record<string, unknown>>;
      usage: GooseLoopbackModelUsage;
    }>;

export interface GooseLoopbackModelInvocation {
  readonly sessionId: string;
  readonly modelId: string;
  readonly request: Readonly<Record<string, unknown>>;
}

export type GooseLoopbackModelInvoker = (
  invocation: GooseLoopbackModelInvocation,
  signal: AbortSignal,
) => Promise<GooseLoopbackModelCompletion>;

export interface GooseLoopbackModelServer {
  readonly baseUrl: string;
  bindSession(sessionId: string): void;
  close(): Promise<void>;
}

function invalidConfig(message: string): GooseLoopbackModelServerError {
  return new GooseLoopbackModelServerError("invalid-config", message);
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidConfig(`Goose loopback model server ${key} must be an own data property`);
  }
  return descriptor.value;
}

function validateOptions(options: StartGooseLoopbackModelServerOptions): {
  readonly modelId: string;
  readonly attemptLease: string;
  readonly invokeModel: GooseLoopbackModelInvoker;
} {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidConfig("Goose loopback model server options must be an object");
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) => typeof key !== "string" || !["modelId", "attemptLease", "invokeModel"].includes(key),
    )
  ) {
    throw invalidConfig("Goose loopback model server options contain unsupported fields");
  }
  const modelId = ownDataProperty(options, "modelId");
  if (
    typeof modelId !== "string" ||
    modelId.length < 1 ||
    modelId.length > 256 ||
    !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(modelId)
  ) {
    throw invalidConfig("Goose loopback model identifier is invalid");
  }
  const attemptLease = ownDataProperty(options, "attemptLease");
  if (
    typeof attemptLease !== "string" ||
    attemptLease.length < 32 ||
    attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(attemptLease)
  ) {
    throw invalidConfig("Goose loopback model attempt lease is invalid");
  }
  const invokeModel = ownDataProperty(options, "invokeModel");
  if (typeof invokeModel !== "function") {
    throw invalidConfig("Goose loopback model invoker is invalid");
  }
  return Object.freeze({
    modelId,
    attemptLease,
    invokeModel: invokeModel as GooseLoopbackModelInvoker,
  });
}

function rawHeaderValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function authorized(request: IncomingMessage, expectedLeaseDigest: Buffer): boolean {
  const values = rawHeaderValues(request, "authorization");
  if (values.length !== 1 || !values[0]!.startsWith("Bearer ")) {
    return false;
  }
  const candidate = values[0]!.slice("Bearer ".length);
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedLeaseDigest);
}

function emptyResponse(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    Connection: "close",
    "Content-Length": "0",
    "Cache-Control": "no-store",
  });
  response.end();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

async function readInferenceRequest(
  request: IncomingMessage,
  modelId: string,
): Promise<Readonly<Record<string, unknown>>> {
  const lengths = rawHeaderValues(request, "content-length");
  const length = lengths.length === 1 && /^[0-9]+$/.test(lengths[0]!) ? Number(lengths[0]) : 0;
  if (
    length < 2 ||
    length > MAX_INFERENCE_REQUEST_BYTES ||
    !Number.isSafeInteger(length) ||
    rawHeaderValues(request, "content-type").length !== 1 ||
    rawHeaderValues(request, "content-type")[0] !== "application/json" ||
    rawHeaderValues(request, "content-encoding").length !== 0
  ) {
    throw new Error("invalid-request-envelope");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    received += buffer.byteLength;
    if (received > length || received > MAX_INFERENCE_REQUEST_BYTES) {
      throw new Error("invalid-request-size");
    }
    chunks.push(buffer);
  }
  if (received !== length) {
    throw new Error("invalid-request-size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
  } catch {
    throw new Error("invalid-request-json");
  }
  if (
    !isRecord(parsed) ||
    parsed.model !== modelId ||
    parsed.stream !== true ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length < 1 ||
    parsed.messages.length > 512
  ) {
    throw new Error("invalid-request-body");
  }
  return Object.freeze(parsed);
}

function assertUsage(usage: GooseLoopbackModelUsage): void {
  if (
    !Number.isSafeInteger(usage.promptTokens) ||
    usage.promptTokens < 0 ||
    !Number.isSafeInteger(usage.completionTokens) ||
    usage.completionTokens < 0 ||
    !Number.isSafeInteger(usage.promptTokens + usage.completionTokens)
  ) {
    throw new Error("invalid-model-usage");
  }
}

function serializeMessageCompletion(
  completionId: string,
  modelId: string,
  completion: Extract<GooseLoopbackModelCompletion, { readonly type: "message" }>,
): Buffer {
  assertUsage(completion.usage);
  if (
    typeof completion.text !== "string" ||
    Buffer.byteLength(completion.text, "utf8") > MAX_MODEL_TEXT_BYTES
  ) {
    throw new Error("invalid-model-message");
  }
  const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
  const common = {
    id: completionId,
    object: "chat.completion.chunk",
    created: 0,
    model: modelId,
  };
  return Buffer.from(
    [
      frame({
        ...common,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: { content: completion.text }, finish_reason: null }],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      frame({
        ...common,
        choices: [],
        usage: {
          prompt_tokens: completion.usage.promptTokens,
          completion_tokens: completion.usage.completionTokens,
          total_tokens: completion.usage.promptTokens + completion.usage.completionTokens,
        },
      }),
      "data: [DONE]\n\n",
    ].join(""),
    "utf8",
  );
}

function serializeToolCallCompletion(
  completionId: string,
  modelId: string,
  completion: Extract<GooseLoopbackModelCompletion, { readonly type: "tool-call" }>,
): Buffer {
  assertUsage(completion.usage);
  if (
    !validSessionId(completion.callId) ||
    typeof completion.name !== "string" ||
    completion.name.length < 1 ||
    completion.name.length > 512 ||
    !/^[A-Za-z0-9._:-]+(?:__[A-Za-z0-9._:-]+)?$/.test(completion.name) ||
    !isRecord(completion.arguments)
  ) {
    throw new Error("invalid-model-tool-call");
  }
  const serializedArguments = JSON.stringify(completion.arguments);
  if (
    typeof serializedArguments !== "string" ||
    Buffer.byteLength(serializedArguments, "utf8") > MAX_MODEL_TEXT_BYTES
  ) {
    throw new Error("invalid-model-tool-arguments");
  }
  const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
  const common = {
    id: completionId,
    object: "chat.completion.chunk",
    created: 0,
    model: modelId,
  };
  return Buffer.from(
    [
      frame({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: completion.callId,
                  type: "function",
                  function: { name: completion.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      frame({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: serializedArguments } }],
            },
            finish_reason: null,
          },
        ],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      frame({
        ...common,
        choices: [],
        usage: {
          prompt_tokens: completion.usage.promptTokens,
          completion_tokens: completion.usage.completionTokens,
          total_tokens: completion.usage.promptTokens + completion.usage.completionTokens,
        },
      }),
      "data: [DONE]\n\n",
    ].join(""),
    "utf8",
  );
}

function closeHttpServer(server: http.Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function startGooseLoopbackModelServer(
  options: StartGooseLoopbackModelServerOptions,
): Promise<GooseLoopbackModelServer> {
  const config = validateOptions(options);
  const expectedLeaseDigest = createHash("sha256").update(config.attemptLease, "utf8").digest();
  const catalogBody = Buffer.from(
    JSON.stringify({
      object: "list",
      data: [{ id: config.modelId, object: "model", created: 0, owned_by: "actestra" }],
    }),
    "utf8",
  );
  const sockets = new Set<Socket>();
  const activeInvocationControllers = new Set<AbortController>();
  const activeInvocations = new Set<Promise<void>>();
  let expectedHost = "";
  let boundSessionId: string | undefined;
  let completionSequence = 0;
  let closed = false;

  const server = http.createServer((request, response) => {
    if (closed) {
      emptyResponse(response, 503);
      return;
    }
    if (request.url === CHAT_COMPLETIONS_PATH) {
      if (request.method !== "POST") {
        emptyResponse(response, 405);
        return;
      }
      const hosts = rawHeaderValues(request, "host");
      if (
        hosts.length !== 1 ||
        hosts[0] !== expectedHost ||
        rawHeaderValues(request, "origin").length !== 0 ||
        rawHeaderValues(request, "transfer-encoding").length !== 0 ||
        !authorized(request, expectedLeaseDigest)
      ) {
        emptyResponse(response, 401);
        return;
      }
      if (boundSessionId === undefined) {
        emptyResponse(response, 409);
        return;
      }
      const sessionIds = rawHeaderValues(request, "agent-session-id");
      if (sessionIds.length !== 1 || sessionIds[0] !== boundSessionId) {
        emptyResponse(response, 401);
        return;
      }
      const controller = new AbortController();
      activeInvocationControllers.add(controller);
      const invocation = (async () => {
        try {
          const inferenceRequest = await readInferenceRequest(request, config.modelId);
          if (closed || controller.signal.aborted) {
            return;
          }
          const completion = await config.invokeModel(
            Object.freeze({
              sessionId: boundSessionId,
              modelId: config.modelId,
              request: inferenceRequest,
            }),
            controller.signal,
          );
          if (controller.signal.aborted || response.destroyed) {
            return;
          }
          completionSequence += 1;
          const completionId = `chatcmpl-actestra-${String(completionSequence)}`;
          const body =
            completion.type === "message"
              ? serializeMessageCompletion(completionId, config.modelId, completion)
              : serializeToolCallCompletion(completionId, config.modelId, completion);
          response.writeHead(200, {
            Connection: "close",
            "Content-Type": "text/event-stream; charset=utf-8",
            "Content-Length": String(body.byteLength),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(body);
        } catch {
          if (!controller.signal.aborted && !response.headersSent && !response.destroyed) {
            emptyResponse(response, 400);
          }
        } finally {
          activeInvocationControllers.delete(controller);
        }
      })();
      activeInvocations.add(invocation);
      void invocation.then(
        () => activeInvocations.delete(invocation),
        () => activeInvocations.delete(invocation),
      );
      return;
    }
    if (request.url !== MODEL_CATALOG_PATH) {
      emptyResponse(response, 404);
      return;
    }
    if (request.method !== "GET") {
      emptyResponse(response, 405);
      return;
    }
    const hosts = rawHeaderValues(request, "host");
    if (
      hosts.length !== 1 ||
      hosts[0] !== expectedHost ||
      rawHeaderValues(request, "origin").length !== 0 ||
      rawHeaderValues(request, "transfer-encoding").length !== 0 ||
      !authorized(request, expectedLeaseDigest)
    ) {
      emptyResponse(response, 401);
      return;
    }
    response.writeHead(200, {
      Connection: "close",
      "Content-Type": "application/json",
      "Content-Length": String(catalogBody.byteLength),
      "Cache-Control": "no-store",
    });
    response.end(catalogBody);
  });
  server.maxHeadersCount = 24;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK_HOST, resolve);
    });
  } catch (error) {
    for (const socket of sockets) {
      socket.destroy();
    }
    throw new GooseLoopbackModelServerError(
      "listen-failed",
      "Goose loopback model server could not listen on the admitted host",
      { cause: error },
    );
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeHttpServer(server, sockets);
    throw new GooseLoopbackModelServerError(
      "listen-failed",
      "Goose loopback model server returned an incompatible listener address",
    );
  }
  expectedHost = `${LOOPBACK_HOST}:${String(address.port)}`;
  const baseUrl = `http://${expectedHost}/v1`;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseUrl,
    bindSession(sessionId: string): void {
      if (closed || !validSessionId(sessionId) || boundSessionId !== undefined) {
        throw invalidConfig("Goose loopback model server session binding is invalid");
      }
      boundSessionId = sessionId;
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        closed = true;
        for (const controller of activeInvocationControllers) {
          controller.abort();
        }
        const serverClosed = closeHttpServer(server, sockets);
        await Promise.allSettled(activeInvocations);
        await serverClosed;
      })();
      return closePromise;
    },
  });
}
