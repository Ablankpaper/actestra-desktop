import type { GooseAcpTransport } from "../../apps/desktop/src/main/workers/gooseAcpHandshake";

export const EXPECTED_GOOSE_INITIALIZE_RESULT = Object.freeze({
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: {
      image: true,
      audio: false,
      embeddedContext: true,
    },
    mcpCapabilities: {
      http: true,
      sse: false,
    },
    sessionCapabilities: {
      list: {},
      close: {},
    },
    auth: {},
  },
  authMethods: [
    {
      id: "goose-provider",
      name: "Configure Provider",
      description: "Run `goose configure` to set up your AI provider and API key",
    },
  ],
  agentInfo: {
    name: "goose",
    version: "1.45.0",
  },
});

export interface LoopbackGooseAcpOptions {
  readonly initializeResult?: unknown;
  readonly silent?: boolean;
}

export class LoopbackGooseAcpTransport implements GooseAcpTransport {
  readonly sentLines: string[] = [];
  closeCount = 0;

  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>();

  constructor(private readonly options: LoopbackGooseAcpOptions = {}) {}

  sendLine(line: string): void {
    this.sentLines.push(line);
    if (this.options.silent === true) {
      return;
    }

    const request = JSON.parse(line) as { readonly id?: unknown; readonly method?: unknown };
    if (request.method !== "initialize") {
      return;
    }
    queueMicrotask(() => {
      this.emitLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: this.options.initializeResult ?? EXPECTED_GOOSE_INITIALIZE_RESULT,
        }),
      );
    });
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => {
      this.lineListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onExit(listener: (code: number | null, signal: string | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closeCount > 0) {
      return;
    }
    this.closeCount += 1;
    for (const listener of this.exitListeners) {
      listener(0, null);
    }
  }

  emitLine(line: string): void {
    for (const listener of this.lineListeners) {
      listener(line);
    }
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}
