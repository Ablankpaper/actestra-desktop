import {
  ACTESTRA_TEAM_EVENT_CHANNEL,
  ACTESTRA_TEAM_REQUEST_CHANNEL,
  AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
  assertAionUiTeamBridgeResponse,
  assertAionUiTeamEvent,
  parseAionUiTeamBridgeRequest,
  type AionUiTeamBridgeErrorCode,
  type AionUiTeamBridgeResponse,
  type AionUiTeamBridgeRoute,
  type AionUiTeamBridgeSuccessData,
  type AionUiTeamEvent,
} from "../../compatibility/aionui";

export interface AionUiTeamBridgePort {
  dispatch(route: AionUiTeamBridgeRoute): Promise<AionUiTeamBridgeSuccessData>;
  subscribe(handler: (event: AionUiTeamEvent) => void): () => void;
}

export type AionUiTeamBridgePortErrorCode = Exclude<
  AionUiTeamBridgeErrorCode,
  "team-invalid-request" | "team-untrusted-sender"
>;

export class AionUiTeamBridgePortError extends Error {
  constructor(
    readonly code: AionUiTeamBridgePortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AionUiTeamBridgePortError";
  }
}

const ERROR_MESSAGES = Object.freeze({
  "team-invalid-request": "The Team request is invalid",
  "team-untrusted-sender": "Team requests require the current main frame",
  "team-not-found": "The Team does not exist",
  "team-conflict": "The Team conflicts with durable authority",
  "team-active": "The Team has an active run",
  "team-model-unavailable": "The selected Team model is unavailable",
  "team-planner-invalid": "The supervised Team planner returned an invalid plan",
  "team-execution-failed": "The Team operation failed",
  "team-planner-unavailable": "The supervised Team planner is unavailable",
  "team-planner-timeout": "The supervised Team planner timed out",
  "team-worker-runtime-unavailable": "The required General and Goose Worker runtime is unavailable",
  "team-unavailable": "Actestra Team work is unavailable",
} satisfies Readonly<Record<AionUiTeamBridgeErrorCode, string>>);

const ERROR_STATUS = Object.freeze({
  "team-invalid-request": 400,
  "team-untrusted-sender": 403,
  "team-not-found": 404,
  "team-conflict": 409,
  "team-active": 409,
  "team-model-unavailable": 409,
  "team-planner-invalid": 422,
  "team-execution-failed": 500,
  "team-planner-unavailable": 503,
  "team-planner-timeout": 504,
  "team-worker-runtime-unavailable": 503,
  "team-unavailable": 503,
} satisfies Readonly<Record<AionUiTeamBridgeErrorCode, number>>);

export function aionUiTeamBridgeError(code: AionUiTeamBridgeErrorCode): AionUiTeamBridgeResponse {
  const response = Object.freeze({
    contractVersion: AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
    status: ERROR_STATUS[code],
    code,
    message: ERROR_MESSAGES[code],
  }) as AionUiTeamBridgeResponse;
  assertAionUiTeamBridgeResponse(response);
  return response;
}

function success(data: AionUiTeamBridgeSuccessData): AionUiTeamBridgeResponse {
  const response = Object.freeze({
    contractVersion: AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
    status: 200 as const,
    data,
  });
  assertAionUiTeamBridgeResponse(response);
  return response;
}

function mappedFailure(error: unknown): AionUiTeamBridgeResponse {
  if (error instanceof AionUiTeamBridgePortError) {
    switch (error.code) {
      case "team-not-found":
      case "team-conflict":
      case "team-active":
      case "team-model-unavailable":
      case "team-planner-invalid":
      case "team-execution-failed":
      case "team-planner-unavailable":
      case "team-planner-timeout":
      case "team-worker-runtime-unavailable":
      case "team-unavailable":
        return aionUiTeamBridgeError(error.code);
    }
  }
  return aionUiTeamBridgeError("team-execution-failed");
}

export class AionUiTeamBridgeService {
  constructor(private readonly team: AionUiTeamBridgePort | null) {}

  async handle(value: unknown): Promise<AionUiTeamBridgeResponse> {
    let route: AionUiTeamBridgeRoute;
    try {
      route = parseAionUiTeamBridgeRequest(value);
    } catch (error) {
      // Log parse failure stage without logging user input
      if (error instanceof Error && error.message) {
        const stage = error.message.includes("body")
          ? "body"
          : error.message.includes("path")
            ? "path"
            : error.message.includes("method")
              ? "method"
              : "unknown";
        console.warn(`[AionUiTeamBridge] Request parse failed at stage: ${stage}`);
      }
      return aionUiTeamBridgeError("team-invalid-request");
    }
    if (this.team === null) return aionUiTeamBridgeError("team-unavailable");
    try {
      return success(await this.team.dispatch(route));
    } catch (error) {
      return mappedFailure(error);
    }
  }

  subscribe(handler: (event: AionUiTeamEvent) => void): () => void {
    if (this.team === null) return (): void => {};
    return this.team.subscribe((event) => {
      try {
        assertAionUiTeamEvent(event);
      } catch {
        return;
      }
      handler(event);
    });
  }
}

export interface AionUiTeamBridgeIpcEvent {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

type AionUiTeamBridgeIpcHandler = (event: AionUiTeamBridgeIpcEvent, ...args: unknown[]) => unknown;

export interface AionUiTeamBridgeIpcMain {
  handle(channel: string, listener: AionUiTeamBridgeIpcHandler): void;
  removeHandler(channel: string): void;
}

export interface AionUiTeamBridgeWebContents {
  readonly mainFrame: unknown;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

export interface AionUiTeamBridgeIpcRegistration {
  readonly ipcMain: AionUiTeamBridgeIpcMain;
  readonly trustedWebContents: () => AionUiTeamBridgeWebContents | null;
  readonly bridge: AionUiTeamBridgeService;
}

interface ResolvedAionUiTeamBridgeWebContents {
  readonly webContents: AionUiTeamBridgeWebContents;
  readonly mainFrame: object;
}

function resolveTrustedWebContents(
  registration: AionUiTeamBridgeIpcRegistration,
): ResolvedAionUiTeamBridgeWebContents | null {
  try {
    const webContents = registration.trustedWebContents();
    if (webContents === null || webContents.isDestroyed() !== false) return null;
    const mainFrame = webContents.mainFrame;
    if (typeof mainFrame !== "object" || mainFrame === null) return null;
    return { webContents, mainFrame };
  } catch {
    return null;
  }
}

function isTrustedEvent(
  event: AionUiTeamBridgeIpcEvent,
  trusted: ResolvedAionUiTeamBridgeWebContents | null,
): boolean {
  if (trusted === null) return false;
  try {
    return event.sender === trusted.webContents && event.senderFrame === trusted.mainFrame;
  } catch {
    return false;
  }
}

export function registerAionUiTeamBridgeIpc(
  registration: AionUiTeamBridgeIpcRegistration,
): () => void {
  const requestHandler: AionUiTeamBridgeIpcHandler = async (event, ...args) => {
    const trusted = resolveTrustedWebContents(registration);
    if (!isTrustedEvent(event, trusted)) {
      return aionUiTeamBridgeError("team-untrusted-sender");
    }
    if (args.length !== 1) return aionUiTeamBridgeError("team-invalid-request");
    return registration.bridge.handle(args[0]);
  };
  registration.ipcMain.handle(ACTESTRA_TEAM_REQUEST_CHANNEL, requestHandler);

  let unsubscribe: () => void;
  try {
    unsubscribe = registration.bridge.subscribe((event) => {
      const trusted = resolveTrustedWebContents(registration);
      if (trusted === null) return;
      try {
        assertAionUiTeamEvent(event);
        trusted.webContents.send(ACTESTRA_TEAM_EVENT_CHANNEL, event);
      } catch {
        // Renderer event delivery cannot change Team authority.
      }
    });
  } catch (error) {
    registration.ipcMain.removeHandler(ACTESTRA_TEAM_REQUEST_CHANNEL);
    throw error;
  }

  let registered = true;
  return (): void => {
    if (!registered) return;
    registered = false;
    try {
      unsubscribe();
    } finally {
      registration.ipcMain.removeHandler(ACTESTRA_TEAM_REQUEST_CHANNEL);
    }
  };
}
