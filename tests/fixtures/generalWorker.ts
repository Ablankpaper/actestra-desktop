import type { AgentClock } from "../../apps/desktop/src/core";
import {
  GeneralWorkerProcessAdapter,
  type GeneralWorkerProcessAdapterOptions,
  type GeneralWorkerProcessTransport,
} from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import {
  createGeneralWorkerReadyMessage,
  type GeneralWorkerMessage,
} from "../../apps/desktop/src/shared/generalWorkerProtocol";
import { GeneralWorkerService } from "../../apps/desktop/src/utility/worker/generalWorkerService";

type MessageListener = (message: unknown) => void;
type ErrorListener = () => void;
type ExitListener = (code: number) => void;

export class LoopbackGeneralWorkerTransport implements GeneralWorkerProcessTransport {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly service = new GeneralWorkerService();
  private transform: ((message: GeneralWorkerMessage) => unknown) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private droppedResponses = 0;
  private separateMessageTurns = false;
  private exited = false;
  killCount = 0;

  postMessage(message: unknown): void {
    if (this.exited) {
      throw new Error("Loopback General Worker has exited");
    }
    this.queue = this.queue
      .then(async () => {
        const messages = await this.service.handle(message);
        for (const [index, response] of messages.entries()) {
          if (this.separateMessageTurns && index > 0) {
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
          }
          if (this.exited) {
            return;
          }
          if (response.type === "response" && this.droppedResponses > 0) {
            this.droppedResponses -= 1;
            continue;
          }
          try {
            const transformed = this.transform?.(response) ?? response;
            this.transform = null;
            this.emitMessage(transformed);
          } catch {
            this.fatalError();
            return;
          }
        }
      })
      .catch(() => {
        if (!this.exited) {
          this.crash(1);
        }
      });
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  kill(): boolean {
    this.killCount += 1;
    if (this.exited) {
      return false;
    }
    this.crash(0);
    return true;
  }

  start(message: unknown = createGeneralWorkerReadyMessage()): void {
    queueMicrotask(() => {
      this.emitMessage(message);
    });
  }

  emitMessage(message: unknown): void {
    if (this.exited) {
      return;
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  crash(code = 1): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.service.shutdown();
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }

  fatalError(): void {
    if (this.exited) {
      return;
    }
    for (const listener of this.errorListeners) {
      listener();
    }
    if (!this.exited) {
      this.crash(1);
    }
  }

  dropNextResponse(): void {
    this.droppedResponses += 1;
  }

  deliverMessagesOnSeparateTurns(): void {
    this.separateMessageTurns = true;
  }

  transformNextMessage(transform: (message: GeneralWorkerMessage) => unknown): void {
    this.transform = transform;
  }
}

export async function openTestGeneralWorker(
  clock: AgentClock,
  options?: GeneralWorkerProcessAdapterOptions,
): Promise<{
  readonly adapter: GeneralWorkerProcessAdapter;
  readonly transport: LoopbackGeneralWorkerTransport;
}> {
  const transport = new LoopbackGeneralWorkerTransport();
  const connecting = GeneralWorkerProcessAdapter.connect(transport, clock, options);
  transport.start();
  return {
    adapter: await connecting,
    transport,
  };
}
