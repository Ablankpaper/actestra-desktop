import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const [mode = "normal", pidFile] = process.argv.slice(2);
let child;
let latestRequest;
let inFlight = false;
let receivedRequests = 0;

function writePidFile() {
  if (pidFile === undefined) return;
  fs.writeFileSync(
    pidFile,
    JSON.stringify({
      processId: process.pid,
      childProcessId: child?.pid ?? null,
      receivedRequests,
    }),
    "utf8",
  );
}

if (["timeout", "abort", "ignore-term", "orphan-child"].includes(mode)) {
  const childReadyFile = pidFile === undefined ? undefined : `${pidFile}.child-ready`;
  const childSource =
    mode === "orphan-child"
      ? "const fs=require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(process.argv[1], 'ready', 'utf8'); setInterval(() => {}, 1000)"
      : "setInterval(() => {}, 1000)";
  const childArguments =
    childReadyFile === undefined || mode !== "orphan-child"
      ? ["-e", childSource]
      : ["-e", childSource, childReadyFile];
  child = spawn(process.execPath, childArguments, {
    stdio: "ignore",
  });
}
writePidFile();

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function candidateFor(request) {
  return {
    protocolVersion: 1,
    correlationId: request.payload.correlationId,
    planVersion: request.payload.planVersion,
    summary: "Run General and coding work in parallel, then request feedback.",
    nodes: [
      {
        candidateKey: "general",
        title: "Prepare the bounded brief",
        kind: "worker",
        capability: "general",
        dependsOn: [],
        expectedArtifactKind: "document",
        completionCriteria: "One bounded brief is available.",
        risk: "low",
        maxAttempts: 1,
      },
      {
        candidateKey: "coding",
        title: "Prepare the bounded patch",
        kind: "worker",
        capability: "coding",
        dependsOn: [],
        expectedArtifactKind: "file",
        completionCriteria: "One reviewed patch is available.",
        risk: "medium",
        maxAttempts: 1,
      },
      {
        candidateKey: "feedback",
        title: "Request user feedback",
        kind: "human-feedback",
        dependsOn: ["general", "coding"],
        completionCriteria: "The user accepts or rejects the bounded result.",
        risk: "medium",
      },
    ],
  };
}

function successFor(request) {
  return {
    protocolVersion: 1,
    type: "response",
    requestId: request.requestId,
    status: "ok",
    result:
      request.operation === "propose"
        ? candidateFor(request)
        : {
            summary: "The bounded Artifact references are ready.",
            artifacts: request.payload.artifacts,
          },
  };
}

const environmentIsClosed =
  process.env.ACTESTRA_TEST_PARENT_SECRET === undefined &&
  process.env.OTEL_SDK_DISABLED === "true" &&
  process.env.CREWAI_DISABLE_TELEMETRY === "true" &&
  process.env.CREWAI_DISABLE_TRACKING === "true" &&
  process.env.ACTESTRA_NETWORK_POLICY === "deny" &&
  process.env.HOME === undefined &&
  process.env.PATH === undefined;

if (mode === "assert-environment" && !environmentIsClosed) {
  process.stderr.write("fixture environment was not closed\n");
  process.exit(42);
}

const ready = {
  protocolVersion: mode === "incompatible-protocol" ? 2 : 1,
  type: "ready",
  role: "planner",
  engine: {
    name: mode === "incompatible-engine" ? "unexpected-engine" : "actestra-deterministic-fixture",
    version: "1.0.0",
  },
};

if (mode === "extra-stdout") {
  process.stdout.write(`${JSON.stringify(ready)}\n${JSON.stringify({ unexpected: true })}\n`);
} else {
  send(ready);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("close", () => {
  if (mode !== "ignore-term") process.exit(0);
});
input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.exit(43);
  }
  latestRequest = request;
  receivedRequests += 1;
  writePidFile();
  if (mode === "malformed") {
    process.stdout.write("{not-json\n");
    return;
  }
  if (mode === "stderr-crash") {
    process.stderr.write(`private-sidecar-trace /private/runtime pid=${process.pid}\n`);
    process.exit(9);
  }
  if (mode === "timeout" || mode === "abort" || mode === "ignore-term" || mode === "orphan-child") {
    return;
  }
  if (mode === "serial") {
    if (inFlight) {
      process.stderr.write("received concurrent request\n");
      process.exit(44);
    }
    inFlight = true;
    setTimeout(() => {
      send(successFor(request));
      inFlight = false;
    }, 25);
    return;
  }
  send(successFor(request));
});

if (mode === "abort") {
  process.on("SIGTERM", () => {
    if (latestRequest !== undefined) {
      send(successFor(latestRequest));
    }
    setTimeout(() => process.exit(0), 10);
  });
}

if (mode === "ignore-term") {
  process.on("SIGTERM", () => {});
}

if (mode === "orphan-child") {
  process.on("SIGTERM", () => process.exit(0));
}

process.on("exit", () => {
  if (mode !== "orphan-child") child?.kill("SIGKILL");
});
