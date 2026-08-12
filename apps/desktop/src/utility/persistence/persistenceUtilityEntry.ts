import process from "node:process";
import { instant, type PrivilegedClock } from "../../core";
import {
  createPersistenceUtilityFatalMessage,
  createPersistenceUtilityReadyMessage,
} from "../../shared/persistenceUtilityProtocol";
import { PersistenceUtilityService } from "./persistenceUtilityService";

const parentPort = process.parentPort;
if (parentPort === undefined) {
  throw new Error("Actestra persistence utility requires an Electron parent port");
}

const clock: PrivilegedClock = Object.freeze({
  now: () => instant(new Date().toISOString()),
});

const service = new PersistenceUtilityService(clock);
let queue: Promise<void> = Promise.resolve();
let terminating = false;

function terminate(code: "invalid-request" | "fatal-error"): void {
  if (terminating) {
    return;
  }
  terminating = true;
  try {
    parentPort.postMessage(createPersistenceUtilityFatalMessage(code));
  } finally {
    setImmediate(() => {
      process.exit(1);
    });
  }
}

parentPort.on("message", (event) => {
  if (terminating) {
    return;
  }
  queue = queue
    .then(async () => {
      const response = await service.handle(event.data);
      parentPort.postMessage(response);
    })
    .catch(() => {
      terminate("invalid-request");
    });
});

process.on("uncaughtException", () => {
  terminate("fatal-error");
});
process.on("unhandledRejection", () => {
  terminate("fatal-error");
});

parentPort.postMessage(createPersistenceUtilityReadyMessage());
