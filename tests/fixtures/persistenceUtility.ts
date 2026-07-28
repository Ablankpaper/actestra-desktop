import type { PersistenceUtilityMessage } from "../../apps/desktop/src/shared/persistenceUtilityProtocol";
import {
  PersistenceUtilityClient,
  type PersistenceUtilityTransport,
  type PersistenceUtilityClientOptions,
} from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";
import { PersistenceUtilityService } from "../../apps/desktop/src/utility/persistence/persistenceUtilityService";

type MessageListener = (message: unknown) => void;
type ExitListener = (code: number) => void;

export class LoopbackPersistenceUtilityTransport implements PersistenceUtilityTransport {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly service = new PersistenceUtilityService();
  private responseTransform: ((message: PersistenceUtilityMessage) => unknown) | null = null;
  private holdResponse = false;
  private droppedResponse = false;
  private exited = false;

  postMessage(message: unknown): void {
    if (this.exited) {
      throw new Error("Loopback persistence utility has exited");
    }

    queueMicrotask(() => {
      void this.service.handle(message).then(
        (response) => {
          if (this.exited || this.droppedResponse) {
            this.droppedResponse = false;
            return;
          }
          if (this.holdResponse) {
            this.holdResponse = false;
            return;
          }
          const transformed = this.responseTransform?.(response) ?? response;
          this.responseTransform = null;
          this.emitMessage(transformed);
        },
        () => {
          this.crash(1);
        },
      );
    });
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  kill(): boolean {
    if (this.exited) {
      return false;
    }
    this.crash(0);
    return true;
  }

  start(): void {
    queueMicrotask(() => {
      this.emitMessage({
        protocolVersion: 1,
        type: "ready",
        role: "persistence",
      });
    });
  }

  crash(code = 1): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    void this.service.shutdown().finally(() => {
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });
  }

  holdNextResponse(): void {
    this.holdResponse = true;
  }

  dropNextResponse(): void {
    this.droppedResponse = true;
  }

  transformNextResponse(transform: (message: PersistenceUtilityMessage) => unknown): void {
    this.responseTransform = transform;
  }

  private emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

export async function openTestPersistenceUtility(
  userDataPath: string,
  options?: PersistenceUtilityClientOptions,
): Promise<{
  readonly client: PersistenceUtilityClient;
  readonly transport: LoopbackPersistenceUtilityTransport;
}> {
  const transport = new LoopbackPersistenceUtilityTransport();
  const connecting = PersistenceUtilityClient.connect(transport, userDataPath, options);
  transport.start();
  return {
    client: await connecting,
    transport,
  };
}
