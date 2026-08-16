// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const installerPath = path.join(repositoryRoot, "scripts/install-goose-runner-tools.mjs");
const temporaryDirectories = [];

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-tools-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function testAsset(bytes, overrides = {}) {
  return {
    name: "cargo-audit",
    archive: "cargo-audit-test.tgz",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    repository: "rustsec/rustsec",
    assetId: 123,
    url: "https://example.invalid/cargo-audit-test.tgz",
    executableFile: "cargo-audit",
    expectedVersion: "cargo-audit 0.22.2",
    version: "0.22.2",
    commit: "281452c35cf0870969042374110f099a411bc185",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe("Goose runner build-tool installer", () => {
  it("derives exact install contracts from the shared target and asset source", async () => {
    const source = fs.readFileSync(installerPath, "utf8");
    expect(source).toContain("isDirectExecution");
    if (!source.includes("isDirectExecution")) return;

    const installer = await import(pathToFileURL(installerPath).href);
    const windows = installer.resolveGooseRunnerToolInstallContract("win32", "x64");
    const linux = installer.resolveGooseRunnerToolInstallContract("linux", "x64");

    expect(windows).toMatchObject({
      host: "win32-x64",
      targetTriple: "x86_64-pc-windows-msvc",
      extractor: "tar.exe",
    });
    expect(windows.assets.map(({ name, executableFile }) => [name, executableFile])).toEqual([
      ["cargo-auditable", "cargo-auditable.exe"],
      ["cargo-audit", "cargo-audit.exe"],
    ]);
    expect(linux).toMatchObject({
      host: "linux-x64",
      targetTriple: "x86_64-unknown-linux-gnu",
      extractor: "tar",
    });
    expect(linux.assets.map(({ name, executableFile }) => [name, executableFile])).toEqual([
      ["cargo-auditable", "cargo-auditable"],
      ["cargo-audit", "cargo-audit"],
    ]);
    expect(Object.isFrozen(windows)).toBe(true);
    expect(Object.isFrozen(windows.assets)).toBe(true);
    expect(windows.assets.every(Object.isFrozen)).toBe(true);
    expect(() => installer.resolveGooseRunnerToolInstallContract("win32", "arm64")).toThrow(
      "host win32-arm64 is outside the Goose native build matrix",
    );
  });

  it("uses a bounded 180-second fetch and verifies the downloaded archive", async () => {
    const installer = await import(pathToFileURL(installerPath).href);
    const bytes = Buffer.from("bounded archive");
    const asset = testAsset(bytes);
    const destination = path.join(await makeTemporaryDirectory(), asset.archive);
    let timeout;
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.redirect).toBe("follow");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return new Response(bytes, { status: 200 });
    });

    await installer.downloadGooseRunnerToolArchive(asset, destination, {
      fetchImpl,
      timeoutSignal: (milliseconds) => {
        timeout = milliseconds;
        return new AbortController().signal;
      },
      viaApi: false,
    });

    expect(installer.GOOSE_RUNNER_TOOL_DOWNLOAD_TIMEOUT_MS).toBe(180_000);
    expect(installer.GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES).toBe(20 * 1024 * 1024);
    expect(timeout).toBe(180_000);
    expect(fetchImpl).toHaveBeenCalledWith(asset.url, expect.any(Object));
    expect(await readFile(destination)).toEqual(bytes);
  });

  it("keeps the authorized GitHub API download bounded by the same contract", async () => {
    const installer = await import(pathToFileURL(installerPath).href);
    const bytes = Buffer.from("authorized api archive");
    const asset = testAsset(bytes);
    const destination = path.join(await makeTemporaryDirectory(), asset.archive);
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      signal: null,
      stdout: bytes,
      stderr: Buffer.alloc(0),
    }));

    await installer.downloadGooseRunnerToolArchive(asset, destination, {
      spawnSyncImpl,
      viaApi: true,
    });

    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        `repos/${asset.repository}/releases/assets/${asset.assetId}`,
        "-H",
        "Accept: application/octet-stream",
      ],
      expect.objectContaining({
        encoding: null,
        timeout: 180_000,
        maxBuffer: 20 * 1024 * 1024 + 1,
      }),
    );
    expect(await readFile(destination)).toEqual(bytes);
  });

  it("rejects non-success, oversized, size-drifted, and digest-drifted downloads", async () => {
    const installer = await import(pathToFileURL(installerPath).href);
    const directory = await makeTemporaryDirectory();
    const exactBytes = Buffer.from("exact archive");
    const asset = testAsset(exactBytes);
    const cases = [
      {
        label: "HTTP response",
        response: new Response("unavailable", { status: 503 }),
        expected: "cargo-audit download returned HTTP 503",
      },
      {
        label: "maximum size",
        response: new Response(null, {
          status: 200,
          headers: { "content-length": String(20 * 1024 * 1024 + 1) },
        }),
        expected: "cargo-audit archive size is out of bounds",
      },
      {
        label: "exact size",
        response: new Response(Buffer.from("short"), { status: 200 }),
        expected: "cargo-audit archive size is out of bounds",
      },
      {
        label: "exact digest",
        response: new Response(Buffer.from("other archive"), { status: 200 }),
        asset: testAsset(Buffer.from("other archive"), { sha256: asset.sha256 }),
        expected: "cargo-audit archive digest does not match the pinned release asset",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const destination = path.join(directory, `${index}-${asset.archive}`);
      await expect(
        installer.downloadGooseRunnerToolArchive(testCase.asset ?? asset, destination, {
          fetchImpl: async () => testCase.response,
          timeoutSignal: () => new AbortController().signal,
          viaApi: false,
        }),
        testCase.label,
      ).rejects.toThrow(testCase.expected);
      expect(fs.existsSync(destination)).toBe(false);
    }
  });

  it("stops a chunked response above 20 MiB and never chmods Windows tools", async () => {
    const installer = await import(pathToFileURL(installerPath).href);
    const destination = path.join(await makeTemporaryDirectory(), "oversized.tgz");
    const maximum = installer.GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(maximum));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const oversizedAsset = testAsset(Buffer.alloc(0), {
      archive: "oversized.tgz",
      size: maximum,
    });

    await expect(
      installer.downloadGooseRunnerToolArchive(oversizedAsset, destination, {
        fetchImpl: async () => new Response(stream, { status: 200 }),
        timeoutSignal: () => new AbortController().signal,
        viaApi: false,
      }),
    ).rejects.toThrow("cargo-audit archive size is out of bounds");
    expect(fs.existsSync(destination)).toBe(false);

    const chmodImpl = vi.fn();
    await installer.applyGooseRunnerToolExecutableMode("C:\\tools\\cargo-audit.exe", "win32", {
      chmodImpl,
    });
    expect(chmodImpl).not.toHaveBeenCalled();
    await installer.applyGooseRunnerToolExecutableMode("/tools/cargo-audit", "linux", {
      chmodImpl,
    });
    expect(chmodImpl).toHaveBeenCalledWith("/tools/cargo-audit", 0o500);
  });
});
