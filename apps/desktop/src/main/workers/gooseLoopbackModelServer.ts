import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

const LOOPBACK_HOST = "127.0.0.1";
const MODEL_CATALOG_PATH = "/v1/models";

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
}

export interface GooseLoopbackModelServer {
  readonly baseUrl: string;
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
} {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidConfig("Goose loopback model server options must be an object");
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string" || !["modelId", "attemptLease"].includes(key))
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
  return Object.freeze({ modelId, attemptLease });
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
  let expectedHost = "";

  const server = http.createServer((request, response) => {
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
    close(): Promise<void> {
      closePromise ??= closeHttpServer(server, sockets);
      return closePromise;
    },
  });
}
