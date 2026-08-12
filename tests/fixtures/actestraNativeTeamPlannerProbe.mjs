import readline from "node:readline";
import fs from "node:fs";
import { spawn } from "node:child_process";

const ENGINE = { name: "actestra-native-team-planner", version: "1.0.0" };
const mode = process.argv[2] ?? "normal";
if (mode === "parent-death") {
  const pidFile = process.argv[3];
  if (pidFile === undefined) process.exit(90);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  if (child.pid === undefined) process.exit(91);
  fs.writeFileSync(
    pidFile,
    JSON.stringify({
      processId: process.pid,
      childProcessId: child.pid,
      processGroupId: process.pid,
    }),
    { flag: "wx" },
  );
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdout.write(
  `${JSON.stringify({ protocolVersion: 1, type: "ready", role: "planner", engine: ENGINE })}\n`,
);

for await (const line of input) {
  if (mode === "timeout") continue;
  const request = JSON.parse(line);
  if (
    mode === "assert-environment" &&
    (process.env.ACTESTRA_TEST_SECRET !== undefined || process.env.ELECTRON_RUN_AS_NODE !== "1")
  ) {
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: 1, type: "response", requestId: request.requestId, status: "error", code: "planner-failed" })}\n`,
    );
    continue;
  }
  if (request.operation === "aggregate") {
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: 1, type: "response", requestId: request.requestId, status: "ok", result: { summary: "bounded aggregate", artifacts: request.payload.artifacts } })}\n`,
    );
    continue;
  }
  process.stdout.write(
    `${JSON.stringify({
      protocolVersion: 1,
      type: "response",
      requestId: request.requestId,
      status: "ok",
      result: {
        protocolVersion: 1,
        correlationId: request.payload.correlationId,
        planVersion: request.payload.planVersion,
        summary: "bounded native planner probe",
        nodes: [
          {
            candidateKey: "general-work",
            title: "General",
            kind: "worker",
            capability: "general",
            dependsOn: [],
            expectedArtifactKind: "document",
            completionCriteria: "General completes.",
            risk: "low",
            maxAttempts: 1,
          },
          {
            candidateKey: "isolated-coding",
            title: "Coding",
            kind: "worker",
            capability: "coding",
            dependsOn: [],
            expectedArtifactKind: "file",
            completionCriteria: "Coding completes.",
            risk: "medium",
            maxAttempts: 1,
          },
          {
            candidateKey: "human-feedback",
            title: "Feedback",
            kind: "human-feedback",
            dependsOn: ["general-work", "isolated-coding"],
            completionCriteria: "A person reviews.",
            risk: "low",
          },
        ],
      },
    })}\n`,
  );
}
