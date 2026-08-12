#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const engine = path
  .basename(process.argv[1] ?? "")
  .toLowerCase()
  .includes("codex")
  ? "codex-cli"
  : "claude-cli";
const args = process.argv.slice(2);

if (
  args.includes("--version") ||
  args.includes("-V") ||
  args.includes("--help") ||
  args.includes("-h")
) {
  appendFileSync(
    path.join(process.cwd(), "probe-environments.jsonl"),
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      environment: Object.fromEntries(
        Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)),
      ),
    })}\n`,
    "utf8",
  );
}

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write(engine === "claude-cli" ? "2.1.168 (Claude Code)\n" : "codex-cli 0.144.3\n");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    engine === "claude-cli"
      ? [
          "--print",
          "--bare",
          "--input-format <format>",
          "--output-format <format>",
          "--json-schema <schema>",
          "--tools <tools...>",
          "--no-session-persistence",
          "--setting-sources <sources>",
          "--strict-mcp-config",
          "--no-chrome",
          "--permission-mode <mode>",
          "--model <model>",
        ].join("\n") + "\n"
      : [
          "--json",
          "--output-schema <FILE>",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--sandbox <SANDBOX_MODE>",
          "--skip-git-repo-check",
          "--model <MODEL>",
        ].join("\n") + "\n",
  );
  process.exit(0);
}

let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk.toString("utf8");
}

const outputSchemaIndex = args.indexOf("--output-schema");
const outputSchemaPath = outputSchemaIndex < 0 ? null : (args[outputSchemaIndex + 1] ?? null);
writeFileSync(
  path.join(process.cwd(), "invocation.json"),
  `${JSON.stringify(
    {
      engine,
      args,
      prompt,
      cwd: process.cwd(),
      outputSchemaPath,
      outputSchema:
        outputSchemaPath === null ? null : JSON.parse(readFileSync(outputSchemaPath, "utf8")),
      environment: Object.fromEntries(
        Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const request = JSON.parse(prompt);
if (request.fixture === "hold") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1_000)"], {
    stdio: "ignore",
  });
  writeFileSync(
    path.join(process.cwd(), "pids.json"),
    `${JSON.stringify({ parent: process.pid, child: child.pid })}\n`,
    "utf8",
  );
  setInterval(() => undefined, 1_000);
} else if (request.fixture === "malformed") {
  process.stdout.write("not-json\n");
} else {
  const structuredOutput =
    request.fixture === "tool"
      ? {
          type: "tool-call",
          callId: "call-fixture-1",
          name: "coding_file_read",
          arguments: { path: "README.md" },
        }
      : { type: "message", text: "LOCAL_AGENT_OK" };
  if (engine === "codex-cli") {
    process.stdout.write(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-fixture" }),
        JSON.stringify({ type: "turn.started" }),
        ...(request.fixture === "codex-tool-event"
          ? [
              JSON.stringify({
                type: "item.completed",
                item: { id: "item-tool", type: "command_execution", command: "pwd" },
              }),
            ]
          : []),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item-message",
            type: "agent_message",
            text: JSON.stringify(structuredOutput),
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 11, cached_input_tokens: 0, output_tokens: 7 },
        }),
      ].join("\n") + "\n",
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: JSON.stringify(structuredOutput),
        structured_output: structuredOutput,
        usage: { input_tokens: 11, output_tokens: 7 },
      })}\n`,
    );
  }
}
