import fs from "node:fs";
import path from "node:path";

const [endpoint = "http://127.0.0.1:9231", outputPath] = process.argv.slice(2);

if (!outputPath) {
  throw new Error("Usage: node scripts/capture-cdp-screenshot.mjs <endpoint> <output.png>");
}

const targetsResponse = await fetch(`${endpoint.replace(/\/$/u, "")}/json/list`);
if (!targetsResponse.ok) {
  throw new Error(`CDP target discovery failed: ${targetsResponse.status}`);
}
const targets = await targetsResponse.json();
const target = targets.find(
  (candidate) => candidate.type === "page" && typeof candidate.webSocketDebuggerUrl === "string",
);
if (!target) {
  throw new Error("No CDP page target is available");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message));
  } else {
    request.resolve(message.result);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed")), {
    once: true,
  });
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

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
const screenshot = await command("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
});

const absoluteOutputPath = path.resolve(outputPath);
fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
fs.writeFileSync(absoluteOutputPath, Buffer.from(screenshot.data, "base64"));
socket.close();

console.log(evaluation.result.value);
