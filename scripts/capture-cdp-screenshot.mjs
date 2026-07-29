import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9231";
const OPERATION_TIMEOUT_MS = 10_000;
const arguments_ = process.argv.slice(2);

function isLoopbackHostname(hostname) {
  const normalized =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return ["127.0.0.1", "::1", "localhost"].includes(normalized.toLowerCase());
}

let endpoint;
let outputPath;
if (arguments_.length === 1) {
  endpoint = DEFAULT_ENDPOINT;
  [outputPath] = arguments_;
} else if (arguments_.length === 2) {
  [endpoint, outputPath] = arguments_;
} else {
  throw new Error("Usage: node scripts/capture-cdp-screenshot.mjs [endpoint] <output.png>");
}

const endpointUrl = new URL(endpoint);
if (
  endpointUrl.protocol !== "http:" ||
  !isLoopbackHostname(endpointUrl.hostname) ||
  endpointUrl.username !== "" ||
  endpointUrl.password !== ""
) {
  throw new Error("CDP screenshot endpoint must be an unauthenticated loopback HTTP URL");
}

const targetsUrl = new URL("/json/list", endpointUrl);
const targetsResponse = await fetch(targetsUrl, {
  signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
});
if (!targetsResponse.ok) {
  throw new Error(`CDP target discovery failed: ${targetsResponse.status}`);
}
const targets = await targetsResponse.json();
if (!Array.isArray(targets)) {
  throw new Error("CDP target discovery returned an invalid response");
}
const target = targets.find(
  (candidate) =>
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.type === "page" &&
    typeof candidate.webSocketDebuggerUrl === "string",
);
if (!target) {
  throw new Error("No CDP page target is available");
}

const webSocketUrl = new URL(target.webSocketDebuggerUrl);
if (webSocketUrl.protocol !== "ws:" || !isLoopbackHostname(webSocketUrl.hostname)) {
  throw new Error("CDP target WebSocket must remain on loopback");
}
const socket = new WebSocket(webSocketUrl);
const pending = new Map();
let nextId = 1;

function rejectPending(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pending.clear();
}

socket.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    rejectPending(new Error("CDP returned a malformed WebSocket message"));
    return;
  }
  if (!Number.isSafeInteger(message.id)) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) {
    request.reject(new Error(message.error.message ?? "CDP command failed"));
  } else {
    request.resolve(message.result);
  }
});
socket.addEventListener("close", () => {
  rejectPending(new Error("CDP WebSocket closed before the command completed"));
});
socket.addEventListener("error", () => {
  rejectPending(new Error("CDP WebSocket failed"));
});

function command(method, params = {}) {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("CDP WebSocket is not open"));
  }
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, OPERATION_TIMEOUT_MS);
    pending.set(id, { reject, resolve, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("CDP WebSocket connection timed out"));
    }, OPERATION_TIMEOUT_MS);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket connection failed"));
      },
      { once: true },
    );
  });
  await command("Page.enable");
  await command("Runtime.enable");
  const evaluation = await command("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 1200),
      viewport: { width: innerWidth, height: innerHeight },
      hasActestraWordmark: document.body.innerText.includes('Actestra')
    })`,
    returnByValue: true,
  });
  if (
    typeof evaluation !== "object" ||
    evaluation === null ||
    evaluation.exceptionDetails !== undefined ||
    typeof evaluation.result !== "object" ||
    evaluation.result === null ||
    typeof evaluation.result.value !== "string"
  ) {
    throw new Error("CDP page metadata evaluation failed");
  }

  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  if (
    typeof screenshot !== "object" ||
    screenshot === null ||
    typeof screenshot.data !== "string"
  ) {
    throw new Error("CDP screenshot response did not include PNG data");
  }

  const absoluteOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, Buffer.from(screenshot.data, "base64"));
  console.log(evaluation.result.value);
} finally {
  rejectPending(new Error("CDP screenshot capture finished"));
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    try {
      socket.close();
    } catch {
      // Preserve the capture or connection error.
    }
  }
}
