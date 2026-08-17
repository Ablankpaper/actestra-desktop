import http from "node:http";
import { lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeGooseBridgeServer,
  listenGooseBridgeServer,
  reserveGooseLoopbackPort,
} from "../../apps/desktop/src/main/workers/gooseBridgeSocket";

const fixtureDirectories: string[] = [];

async function createFixture(): Promise<{ readonly root: string; readonly socketPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-bridge-"));
  fixtureDirectories.push(root);
  const bridgeDirectory = path.join(root, "bridge");
  await mkdir(bridgeDirectory, { mode: 0o700 });
  return Object.freeze({ root, socketPath: path.join(bridgeDirectory, "mcp.sock") });
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Goose Main-owned bridge sockets", () => {
  it.each([
    Object.freeze({ socketPath: "relative/mcp.sock", loopbackPort: 43_123 }),
    Object.freeze({ socketPath: path.resolve("/tmp/actestra-mcp.sock") }),
    Object.freeze({ loopbackPort: 43_123 }),
    Object.freeze({ socketPath: path.resolve("/tmp/actestra-mcp.sock"), loopbackPort: 0 }),
    Object.freeze({
      socketPath: path.resolve("/tmp/actestra-mcp.sock"),
      loopbackPort: 43_123,
      destination: "127.0.0.1:80",
    }),
  ])("rejects an unsupported listener contract %#", async (listenerOptions) => {
    const server = http.createServer((_request, response) => response.end());
    await expect(listenGooseBridgeServer(server, listenerOptions as never)).rejects.toMatchObject({
      name: "GooseBridgeSocketError",
      code: "invalid-config",
    });
    expect(server.listening).toBe(false);
  });

  it("refuses to replace a regular file at the selected socket path", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.socketPath, "not a socket", { mode: 0o600 });
    const server = http.createServer((_request, response) => response.end());

    await expect(
      listenGooseBridgeServer(
        server,
        Object.freeze({ socketPath: fixture.socketPath, loopbackPort: 43_123 }),
      ),
    ).rejects.toMatchObject({
      name: "GooseBridgeSocketError",
      code: "listen-failed",
    });
    expect(await lstat(fixture.socketPath)).toMatchObject({ size: 12 });
  });

  it("refuses to unlink a Unix socket it did not create", async () => {
    const fixture = await createFixture();
    const incumbent = net.createServer();
    await new Promise<void>((resolve, reject) => {
      incumbent.once("error", reject);
      incumbent.listen(fixture.socketPath, resolve);
    });
    const server = http.createServer((_request, response) => response.end());
    try {
      await expect(
        listenGooseBridgeServer(
          server,
          Object.freeze({ socketPath: fixture.socketPath, loopbackPort: 43_123 }),
        ),
      ).rejects.toMatchObject({
        name: "GooseBridgeSocketError",
        code: "listen-failed",
      });
      expect((await lstat(fixture.socketPath)).isSocket()).toBe(true);
    } finally {
      await new Promise<void>((resolve) => incumbent.close(() => resolve()));
    }
  });

  it("binds one restrictive Unix socket while preserving the synthetic loopback Host", async () => {
    const fixture = await createFixture();
    const server = http.createServer((request, response) => {
      expect(request.headers.host).toBe("127.0.0.1:43123");
      response.writeHead(204);
      response.end();
    });
    const binding = await listenGooseBridgeServer(
      server,
      Object.freeze({ socketPath: fixture.socketPath, loopbackPort: 43_123 }),
    );

    expect(binding).toEqual({
      host: "127.0.0.1:43123",
      port: 43_123,
      socketPath: fixture.socketPath,
    });
    expect(Object.isFrozen(binding)).toBe(true);
    const socketStat = await lstat(fixture.socketPath);
    expect(socketStat.isSocket()).toBe(true);
    expect(socketStat.mode & 0o777).toBe(0o600);

    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: fixture.socketPath,
          path: "/probe",
          method: "GET",
          headers: { Host: binding.host },
        },
        (response) => {
          expect(response.statusCode).toBe(204);
          response.resume();
          response.once("end", resolve);
        },
      );
      request.once("error", reject);
      request.end();
    });

    const firstClose = closeGooseBridgeServer(server, new Set(), binding);
    const secondClose = closeGooseBridgeServer(server, new Set(), binding);
    expect(secondClose).toBe(firstClose);
    await firstClose;
    await expect(lstat(fixture.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reserves a bounded IPv4 loopback port without leaving a listener behind", async () => {
    const port = await reserveGooseLoopbackPort();
    expect(Number.isSafeInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);

    const verifier = http.createServer((_request, response) => response.end());
    await new Promise<void>((resolve, reject) => {
      verifier.once("error", reject);
      verifier.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) =>
      verifier.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });
});
