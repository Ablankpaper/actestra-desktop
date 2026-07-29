import process from "node:process";
import {
  createGeneralWorkerFatalMessage,
  createGeneralWorkerReadyMessage,
} from "../../shared/generalWorkerProtocol";
import { GeneralWorkerService } from "./generalWorkerService";

const parentPort = process.parentPort;
if (parentPort === undefined) {
  throw new Error("Actestra General Worker requires an Electron parent port");
}

const service = new GeneralWorkerService();
let queue: Promise<void> = Promise.resolve();
let terminating = false;

function terminate(code: "invalid-message" | "fatal-error"): void {
  if (terminating) {
    return;
  }
  terminating = true;
  service.shutdown();
  try {
    parentPort.postMessage(createGeneralWorkerFatalMessage(code));
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
      const messages = await service.handle(event.data);
      for (const message of messages) {
        parentPort.postMessage(message);
      }
      if (
        messages.some(
          (message) => message.type === "response" && message.operation === "close" && message.ok,
        )
      ) {
        terminating = true;
        setImmediate(() => {
          process.exit(0);
        });
      }
    })
    .catch(() => {
      terminate("invalid-message");
    });
});

process.on("uncaughtException", () => {
  terminate("fatal-error");
});
process.on("unhandledRejection", () => {
  terminate("fatal-error");
});

parentPort.postMessage(createGeneralWorkerReadyMessage());
