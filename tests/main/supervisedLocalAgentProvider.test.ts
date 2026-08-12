import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  admitSupervisedLocalAgentProvider,
  type SupervisedLocalAgentProvider,
} from "../../apps/desktop/src/main/orchestration/supervisedLocalAgentProvider";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const fixtureSource = path.join(repositoryRoot, "tests/fixtures/localAgentCli.mjs");
const roots: string[] = [];
const providers: SupervisedLocalAgentProvider[] = [];

function fixture(engine: "claude-cli" | "codex-cli") {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "actestra-local-agent-provider-")));
  roots.push(root);
  const workingDirectory = path.join(root, "private");
  const home = path.join(root, "home");
  const temporaryDirectory = path.join(root, "tmp");
  mkdirSync(workingDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
  const executable = path.join(root, engine === "claude-cli" ? "claude" : "codex");
  copyFileSync(fixtureSource, executable);
  chmodSync(executable, 0o700);
  return {
    root,
    workingDirectory,
    executable,
    environment: {
      HOME: home,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TMPDIR: temporaryDirectory,
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      USER: "actestra-test-user",
      ACTESTRA_TEST_SECRET: "must-not-cross-provider-boundary",
      ANTHROPIC_API_KEY: "must-not-cross-provider-boundary",
      GEMINI_API_KEY: "must-not-cross-provider-boundary",
      GOOGLE_API_KEY: "must-not-cross-provider-boundary",
    } satisfies NodeJS.ProcessEnv,
  };
}

function nativeClaudeFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "actestra-native-agent-")));
  const outsideRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "actestra-native-outside-")));
  roots.push(root, outsideRoot);
  const workingDirectory = path.join(root, "private");
  mkdirSync(workingDirectory, { recursive: true, mode: 0o700 });
  const executable = path.join(root, "claude-native");
  const secretPath = path.join(outsideRoot, "secret.txt");
  const markerPath = path.join(outsideRoot, "child-marker.txt");
  writeFileSync(secretPath, "must-not-be-readable", "utf8");
  const source = `
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
  int secret = open(${JSON.stringify(secretPath)}, O_RDONLY);
  const char *shell_argv[] = { "/bin/sh", "-c", ${JSON.stringify(
    `/bin/echo child > ${markerPath}`,
  )}, NULL };
  pid_t child = 0;
  int spawned = posix_spawn(&child, "/bin/sh", NULL, NULL, (char *const *)shell_argv, environ);
  if (spawned == 0) waitpid(child, NULL, 0);
  FILE *effects = fopen("probe-effects.log", "a");
  if (effects == NULL) return 72;
  fprintf(effects, "%s %s\\n", secret >= 0 ? "read-allowed" : "read-denied", spawned == 0 ? "child-allowed" : "child-denied");
  fclose(effects);
  if (secret >= 0) close(secret);
  if (argc > 1 && strcmp(argv[1], "--version") == 0) {
    fputs("2.1.168 (Claude Code)\\n", stdout);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "--help") == 0) {
    fputs("--print\\n--bare\\n--input-format <format>\\n--output-format <format>\\n--json-schema <schema>\\n--tools <tools...>\\n--no-session-persistence\\n--setting-sources <sources>\\n--strict-mcp-config\\n--no-chrome\\n--permission-mode <mode>\\n--model <model>\\n", stdout);
    return 0;
  }
  char prompt[4097];
  size_t prompt_bytes = fread(prompt, 1, sizeof(prompt) - 1, stdin);
  prompt[prompt_bytes] = '\\0';
  FILE *invocation = fopen("invocation.txt", "w");
  if (invocation == NULL) return 73;
  fwrite(prompt, 1, prompt_bytes, invocation);
  fclose(invocation);
  return 76;
}
`;
  const compiled = spawnSync("/usr/bin/clang", ["-x", "c", "-o", executable, "-"], {
    input: source,
    encoding: "utf8",
  });
  if (compiled.status !== 0) {
    throw new Error(`Native provider fixture failed to compile: ${compiled.stderr}`);
  }
  return { root, outsideRoot, workingDirectory, executable, markerPath };
}

async function admit(engine: "claude-cli" | "codex-cli") {
  const configured = fixture(engine);
  const provider = await admitSupervisedLocalAgentProvider({
    engine,
    executable: configured.executable,
    workingDirectory: configured.workingDirectory,
    environment: configured.environment,
    terminationGraceMs: 100,
  });
  providers.push(provider);
  return { ...configured, provider };
}

afterEach(async () => {
  await Promise.allSettled(providers.splice(0).map((provider) => provider.close()));
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SupervisedLocalAgentProvider", () => {
  it.skipIf(process.platform !== "darwin")(
    "runs native capability probes inside the pre-execution sandbox",
    async () => {
      const configured = nativeClaudeFixture();
      const provider = await admitSupervisedLocalAgentProvider({
        engine: "claude-cli",
        executable: configured.executable,
        workingDirectory: configured.workingDirectory,
        environment: { PATH: "/usr/bin:/bin" },
        terminationGraceMs: 100,
      });
      providers.push(provider);

      expect(
        readFileSync(path.join(configured.workingDirectory, "probe-effects.log"), "utf8")
          .trim()
          .split("\n"),
      ).toEqual(["read-denied child-denied", "read-denied child-denied"]);
      expect(() => readFileSync(configured.markerPath, "utf8")).toThrow();
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "keeps native Claude disabled when a caller tries to inject a model binding",
    async () => {
      const configured = nativeClaudeFixture();
      const provider = await admitSupervisedLocalAgentProvider({
        engine: "claude-cli",
        executable: configured.executable,
        workingDirectory: configured.workingDirectory,
        environment: { PATH: "/usr/bin:/bin" },
        terminationGraceMs: 100,
        modelBinding: {
          baseUrl: "http://127.0.0.1:43123",
          attemptLease: "actestra-loopback-lease-1234567890abcdef",
        },
      } as Parameters<typeof admitSupervisedLocalAgentProvider>[0] & {
        modelBinding: { baseUrl: string; attemptLease: string };
      });
      providers.push(provider);

      expect(provider.catalogEntry.capabilities).toEqual([]);
      await expect(
        provider.invokeStructured({
          capability: "goose-model",
          model: "sonnet",
          prompt: '{"fixture":"message"}',
          schema: { type: "object" },
        }),
      ).rejects.toMatchObject({ code: "capability-unavailable" });
      expect(() =>
        readFileSync(path.join(configured.workingDirectory, "invocation.txt"), "utf8"),
      ).toThrow();
      expect(() => readFileSync(configured.markerPath, "utf8")).toThrow();
    },
  );

  it("builds a macOS pre-execution boundary that blocks user reads, writes, and child exec", async () => {
    const module =
      (await import("../../apps/desktop/src/main/orchestration/supervisedLocalAgentProvider")) as unknown as {
        createMacosLocalAgentSandboxLaunch?: (options: {
          executablePath: string;
          privateRoot: string;
          networkPorts: readonly number[];
        }) => { executable: string; args: readonly string[]; profile: string };
      };
    expect(typeof module.createMacosLocalAgentSandboxLaunch).toBe("function");
    const privateRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "actestra-agent-sandbox-")),
    );
    const outsideRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "actestra-agent-outside-")),
    );
    roots.push(privateRoot, outsideRoot);
    const secretPath = path.join(outsideRoot, "secret.txt");
    const markerPath = path.join(outsideRoot, "marker.txt");
    const resultPath = path.join(privateRoot, "result.txt");
    writeFileSync(secretPath, "must-not-be-readable", "utf8");
    const launch = module.createMacosLocalAgentSandboxLaunch!({
      executablePath: "/bin/zsh",
      privateRoot,
      networkPorts: [43123],
    });
    const result = spawnSync(
      launch.executable,
      [
        ...launch.args,
        "-c",
        [
          `print -r -- started > ${JSON.stringify(resultPath)}`,
          `if read -r line < ${JSON.stringify(secretPath)}; then print -r -- read-allowed; else print -r -- read-denied; fi`,
          `if print -r -- changed > ${JSON.stringify(markerPath)}; then print -r -- write-allowed; else print -r -- write-denied; fi`,
          `if /bin/echo child > /dev/null; then print -r -- child-allowed; else print -r -- child-denied; fi`,
        ].join("; "),
      ],
      { encoding: "utf8" },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("read-denied");
    expect(result.stdout).toContain("write-denied");
    expect(result.stdout).toContain("child-denied");
    expect(readFileSync(resultPath, "utf8")).toContain("started");
    expect(() => readFileSync(markerPath, "utf8")).toThrow();
    expect(launch.profile).toContain("(deny network*)");
    expect(launch.profile).toContain('(allow network-outbound (remote ip "localhost:43123"))');
  });

  it("isolates non-inference probes from user configuration, identity, and credentials", async () => {
    const { provider: _provider, workingDirectory } = await admit("claude-cli");
    const probes = readFileSync(path.join(workingDirectory, "probe-environments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { cwd: string; environment: Record<string, string> });

    expect(probes).toHaveLength(2);
    for (const probe of probes) {
      expect(probe.cwd).toBe(workingDirectory);
      expect(probe.environment.HOME).toBe(path.join(workingDirectory, "home"));
      expect(probe.environment.TMPDIR).toBe(path.join(workingDirectory, "tmp"));
      expect(probe.environment.TMP).toBe(path.join(workingDirectory, "tmp"));
      expect(probe.environment.TEMP).toBe(path.join(workingDirectory, "tmp"));
      expect(probe.environment).not.toHaveProperty("USER");
      expect(probe.environment).not.toHaveProperty("ACTESTRA_TEST_SECRET");
      expect(probe.environment).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(probe.environment).not.toHaveProperty("GEMINI_API_KEY");
      expect(probe.environment).not.toHaveProperty("GOOGLE_API_KEY");
    }
  });

  it("keeps Claude admission disabled when bare mode cannot reuse OAuth without credential injection", async () => {
    const { provider, workingDirectory } = await admit("claude-cli");

    expect(provider.catalogEntry).toEqual({
      contractVersion: 1,
      providerId: "local-agent.claude-cli",
      engine: "claude-cli",
      version: "2.1.168",
      capabilities: [],
    });

    await expect(
      provider.invokeStructured({
        capability: "goose-model",
        model: "sonnet",
        prompt: JSON.stringify({ fixture: "message" }),
        schema: { type: "object" },
      }),
    ).rejects.toMatchObject({
      name: "SupervisedLocalAgentProviderError",
      code: "capability-unavailable",
    });
    expect(() => readFileSync(path.join(workingDirectory, "invocation.json"), "utf8")).toThrow();
  });

  it("keeps Codex admission disabled before invocation because read-only is not a pre-execution tool block", async () => {
    const { provider, workingDirectory } = await admit("codex-cli");

    expect(provider.catalogEntry).toEqual({
      contractVersion: 1,
      providerId: "local-agent.codex-cli",
      engine: "codex-cli",
      version: "0.144.3",
      capabilities: [],
    });
    await expect(
      provider.invokeStructured({
        capability: "planner",
        model: "gpt-5.4",
        prompt: JSON.stringify({ fixture: "message" }),
        schema: { type: "object" },
      }),
    ).rejects.toMatchObject({
      name: "SupervisedLocalAgentProviderError",
      code: "capability-unavailable",
    });
    expect(() => readFileSync(path.join(workingDirectory, "invocation.json"), "utf8")).toThrow();
  });
});
