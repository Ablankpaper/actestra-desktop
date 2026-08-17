import { chmod, lstat, unlink } from "node:fs/promises";
import net, { type AddressInfo, type Server, type Socket } from "node:net";
import path from "node:path";

const LOOPBACK_HOST = "127.0.0.1" as const;
const MAX_UNIX_SOCKET_PATH_BYTES = 103;

export type GooseBridgeSocketErrorCode = "invalid-config" | "listen-failed" | "cleanup-failed";

export class GooseBridgeSocketError extends Error {
  constructor(
    readonly code: GooseBridgeSocketErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseBridgeSocketError";
  }
}

export interface GooseBridgeListenerOptions {
  readonly socketPath?: string;
  readonly loopbackPort?: number;
}

export interface GooseBridgeServerBinding {
  readonly host: string;
  readonly port: number;
  readonly socketPath?: string;
}

interface SocketIdentity {
  readonly device: number;
  readonly inode: number;
}

interface ServerState {
  readonly binding: GooseBridgeServerBinding;
  readonly socketIdentity?: SocketIdentity;
  closePromise?: Promise<void>;
}

const serverStates = new WeakMap<Server, ServerState>();

function invalidConfig(message: string): GooseBridgeSocketError {
  return new GooseBridgeSocketError("invalid-config", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotOptions(
  value: GooseBridgeListenerOptions | undefined,
):
  | Readonly<{ readonly kind: "tcp" }>
  | Readonly<{ readonly kind: "unix"; readonly socketPath: string; readonly port: number }> {
  if (value === undefined) {
    return Object.freeze({ kind: "tcp" });
  }
  if (!isRecord(value)) {
    throw invalidConfig("Goose bridge listener options must be an object");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !["socketPath", "loopbackPort"].includes(key))
  ) {
    throw invalidConfig("Goose bridge listener options contain unsupported fields");
  }
  const socketPath = Object.getOwnPropertyDescriptor(value, "socketPath")?.value as unknown;
  const loopbackPort = Object.getOwnPropertyDescriptor(value, "loopbackPort")?.value as unknown;
  if (socketPath === undefined && loopbackPort === undefined && keys.length === 0) {
    return Object.freeze({ kind: "tcp" });
  }
  if (
    typeof socketPath !== "string" ||
    !path.isAbsolute(socketPath) ||
    path.resolve(socketPath) !== socketPath ||
    path.parse(socketPath).root === socketPath ||
    socketPath.includes("\0") ||
    Buffer.byteLength(socketPath, "utf8") > MAX_UNIX_SOCKET_PATH_BYTES ||
    !Number.isSafeInteger(loopbackPort) ||
    (loopbackPort as number) < 1 ||
    (loopbackPort as number) > 65_535
  ) {
    throw invalidConfig(
      "Goose bridge Unix listener requires one bounded absolute socket path and loopback port",
    );
  }
  return Object.freeze({ kind: "unix", socketPath, port: loopbackPort as number });
}

async function assertSocketPathUnused(socketPath: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new GooseBridgeSocketError(
      "listen-failed",
      "Goose bridge socket path could not be inspected",
      { cause: error },
    );
  }
  if (!stat.isSocket() || stat.isSymbolicLink()) {
    throw new GooseBridgeSocketError(
      "listen-failed",
      "Goose bridge socket path is occupied by a non-socket entry",
    );
  }
  throw new GooseBridgeSocketError(
    "listen-failed",
    "Goose bridge socket path is already owned by another listener",
  );
}

function waitForListening(server: Server, listen: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    listen();
  });
}

async function listenTcp(server: Server): Promise<GooseBridgeServerBinding> {
  await waitForListening(server, () => server.listen(0, LOOPBACK_HOST));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new GooseBridgeSocketError(
      "listen-failed",
      "Goose bridge TCP listener returned an incompatible address",
    );
  }
  return Object.freeze({
    host: `${LOOPBACK_HOST}:${String(address.port)}`,
    port: address.port,
  });
}

async function listenUnix(
  server: Server,
  socketPath: string,
  port: number,
): Promise<{ readonly binding: GooseBridgeServerBinding; readonly identity: SocketIdentity }> {
  await assertSocketPathUnused(socketPath);
  await waitForListening(server, () => server.listen(socketPath));
  try {
    await chmod(socketPath, 0o600);
    const stat = await lstat(socketPath);
    if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
      throw new Error("incompatible-socket");
    }
    return Object.freeze({
      binding: Object.freeze({
        host: `${LOOPBACK_HOST}:${String(port)}`,
        port,
        socketPath,
      }),
      identity: Object.freeze({ device: stat.dev, inode: stat.ino }),
    });
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(socketPath).catch((): undefined => undefined);
    throw new GooseBridgeSocketError(
      "listen-failed",
      "Goose bridge Unix socket permissions could not be established",
      { cause: error },
    );
  }
}

export async function reserveGooseLoopbackPort(): Promise<number> {
  const reservation = net.createServer();
  try {
    await waitForListening(reservation, () => reservation.listen(0, LOOPBACK_HOST));
    const address = reservation.address() as AddressInfo | null;
    if (address === null || typeof address === "string") {
      throw new Error("incompatible-address");
    }
    return address.port;
  } catch (error) {
    throw new GooseBridgeSocketError(
      "listen-failed",
      "Goose bridge loopback port could not be reserved",
      { cause: error },
    );
  } finally {
    await new Promise<void>((resolve) => {
      if (!reservation.listening) {
        resolve();
        return;
      }
      reservation.close(() => resolve());
    });
  }
}

export async function listenGooseBridgeServer(
  server: Server,
  options?: GooseBridgeListenerOptions,
): Promise<GooseBridgeServerBinding> {
  if (serverStates.has(server) || server.listening) {
    throw invalidConfig("Goose bridge server is already listening");
  }
  const config = snapshotOptions(options);
  try {
    if (config.kind === "tcp") {
      const binding = await listenTcp(server);
      serverStates.set(server, { binding });
      return binding;
    }
    const { binding, identity } = await listenUnix(server, config.socketPath, config.port);
    serverStates.set(server, { binding, socketIdentity: identity });
    return binding;
  } catch (error) {
    if (error instanceof GooseBridgeSocketError) {
      throw error;
    }
    throw new GooseBridgeSocketError("listen-failed", "Goose bridge server could not start", {
      cause: error,
    });
  }
}

async function removeOwnedSocket(state: ServerState): Promise<void> {
  const socketPath = state.binding.socketPath;
  const identity = state.socketIdentity;
  if (socketPath === undefined || identity === undefined) {
    return;
  }
  let stat;
  try {
    stat = await lstat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (
    !stat.isSocket() ||
    stat.isSymbolicLink() ||
    stat.dev !== identity.device ||
    stat.ino !== identity.inode
  ) {
    throw new Error("socket-identity-changed");
  }
  await unlink(socketPath);
}

export function closeGooseBridgeServer(
  server: Server,
  sockets: ReadonlySet<Socket>,
  binding: GooseBridgeServerBinding,
): Promise<void> {
  const state = serverStates.get(server);
  if (state === undefined || state.binding !== binding) {
    return Promise.reject(invalidConfig("Goose bridge close does not match the active listener"));
  }
  state.closePromise ??= (async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    const failures: unknown[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    } catch (error) {
      failures.push(error);
    }
    try {
      await removeOwnedSocket(state);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new GooseBridgeSocketError("cleanup-failed", "Goose bridge listener cleanup failed", {
        cause: failures.length === 1 ? failures[0] : new AggregateError(failures),
      });
    }
  })();
  return state.closePromise;
}
