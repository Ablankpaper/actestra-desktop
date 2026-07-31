import {
  ACTESTRA_SCHEDULE_EVENT_CHANNEL,
  ACTESTRA_SCHEDULE_REQUEST_CHANNEL,
  AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION,
  assertAionUiScheduleBridgeResponse,
  assertAionUiScheduleEvent,
  parseAionUiScheduleBridgeRequest,
  AionUiScheduledGeneralWorkError,
  type AionUiScheduleBridgeErrorCode,
  type AionUiScheduleBridgeResponse,
  type AionUiScheduleBridgeSuccessData,
  type AionUiScheduleEvent,
  type NativeAionUiCronJob,
  type NativeAionUiScheduleConversation,
} from "../../compatibility/aionui";
import { PersistenceError } from "../../core";
import { AionUiScheduleServiceError } from "./aionuiScheduleService";

export interface AionUiScheduleBridgePort {
  list(nativeConversationId?: string): Promise<readonly NativeAionUiCronJob[]>;
  get(jobId: string): Promise<NativeAionUiCronJob | null>;
  create(value: unknown): Promise<NativeAionUiCronJob>;
  update(jobId: string, value: unknown): Promise<NativeAionUiCronJob>;
  remove(jobId: string): Promise<void>;
  runNow(jobId: string): Promise<Readonly<{ conversation_id: string }>>;
  history(jobId: string): Promise<readonly NativeAionUiScheduleConversation[]>;
  subscribe(handler: (event: AionUiScheduleEvent) => void): () => void;
}

const ERROR_MESSAGES = Object.freeze({
  "schedule-invalid-request": "The schedule request is invalid",
  "schedule-untrusted-sender": "Schedule requests require the current main frame",
  "schedule-not-found": "The scheduled job does not exist",
  "schedule-active": "The scheduled job has an active run",
  "schedule-busy": "The scheduled job already has an active run",
  "schedule-conflict": "The scheduled job conflicts with durable authority",
  "schedule-expired": "The one-time scheduled job has expired",
  "schedule-execution-failed": "The scheduled operation failed",
  "schedule-skill-unsupported": "Scheduled Skills are unavailable in this Actestra slice",
  "schedule-unavailable": "Actestra scheduling is unavailable",
} satisfies Readonly<Record<AionUiScheduleBridgeErrorCode, string>>);

export function aionUiScheduleBridgeError(
  code: AionUiScheduleBridgeErrorCode,
): AionUiScheduleBridgeResponse {
  const status = {
    "schedule-invalid-request": 400,
    "schedule-untrusted-sender": 403,
    "schedule-not-found": 404,
    "schedule-active": 409,
    "schedule-busy": 409,
    "schedule-conflict": 409,
    "schedule-expired": 410,
    "schedule-execution-failed": 500,
    "schedule-skill-unsupported": 501,
    "schedule-unavailable": 503,
  }[code];
  const response = Object.freeze({
    contractVersion: AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION,
    status,
    code,
    message: ERROR_MESSAGES[code],
  }) as AionUiScheduleBridgeResponse;
  assertAionUiScheduleBridgeResponse(response);
  return response;
}

function success(data: AionUiScheduleBridgeSuccessData): AionUiScheduleBridgeResponse {
  const response = Object.freeze({
    contractVersion: AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION,
    status: 200 as const,
    data,
  });
  assertAionUiScheduleBridgeResponse(response);
  return response;
}

function mappedFailure(error: unknown): AionUiScheduleBridgeResponse {
  if (error instanceof AionUiScheduledGeneralWorkError) {
    return aionUiScheduleBridgeError("schedule-invalid-request");
  }
  if (error instanceof AionUiScheduleServiceError) {
    switch (error.code) {
      case "schedule-closed":
        return aionUiScheduleBridgeError("schedule-unavailable");
      case "schedule-not-found":
      case "schedule-active":
      case "schedule-busy":
      case "schedule-expired":
      case "schedule-execution-failed":
        return aionUiScheduleBridgeError(error.code);
      default:
        return aionUiScheduleBridgeError("schedule-execution-failed");
    }
  }
  if (error instanceof PersistenceError) {
    return aionUiScheduleBridgeError(
      error.code === "schedule-conflict" ? "schedule-conflict" : "schedule-unavailable",
    );
  }
  if (
    error instanceof Error &&
    (error.name === "PersistenceUtilityError" || error.name === "PersistenceError")
  ) {
    return aionUiScheduleBridgeError("schedule-unavailable");
  }
  return aionUiScheduleBridgeError("schedule-execution-failed");
}

export class AionUiScheduleBridgeService {
  constructor(private readonly schedule: AionUiScheduleBridgePort | null) {}

  async handle(value: unknown): Promise<AionUiScheduleBridgeResponse> {
    let route: ReturnType<typeof parseAionUiScheduleBridgeRequest>;
    try {
      route = parseAionUiScheduleBridgeRequest(value);
    } catch {
      return aionUiScheduleBridgeError("schedule-invalid-request");
    }
    if (route.kind === "skill") {
      return aionUiScheduleBridgeError("schedule-skill-unsupported");
    }
    if (this.schedule === null) {
      return aionUiScheduleBridgeError("schedule-unavailable");
    }
    try {
      switch (route.kind) {
        case "list":
          return success(await this.schedule.list(route.nativeConversationId));
        case "get":
          return success(await this.schedule.get(route.jobId));
        case "create":
          return success(await this.schedule.create(route.body));
        case "update":
          return success(await this.schedule.update(route.jobId, route.body));
        case "remove":
          await this.schedule.remove(route.jobId);
          return success(null);
        case "run":
          return success(await this.schedule.runNow(route.jobId));
        case "history":
          return success(await this.schedule.history(route.jobId));
      }
    } catch (error) {
      return mappedFailure(error);
    }
  }

  subscribe(handler: (event: AionUiScheduleEvent) => void): () => void {
    if (this.schedule === null) return (): void => {};
    return this.schedule.subscribe((event) => {
      try {
        assertAionUiScheduleEvent(event);
      } catch {
        return;
      }
      handler(event);
    });
  }
}

export interface AionUiScheduleBridgeIpcEvent {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

type AionUiScheduleBridgeIpcHandler = (
  event: AionUiScheduleBridgeIpcEvent,
  ...args: unknown[]
) => unknown;

export interface AionUiScheduleBridgeIpcMain {
  handle(channel: string, listener: AionUiScheduleBridgeIpcHandler): void;
  removeHandler(channel: string): void;
}

export interface AionUiScheduleBridgeWebContents {
  readonly mainFrame: unknown;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

export interface AionUiScheduleBridgeIpcRegistration {
  readonly ipcMain: AionUiScheduleBridgeIpcMain;
  readonly trustedWebContents: () => AionUiScheduleBridgeWebContents | null;
  readonly bridge: AionUiScheduleBridgeService;
}

interface ResolvedAionUiScheduleBridgeWebContents {
  readonly webContents: AionUiScheduleBridgeWebContents;
  readonly mainFrame: object;
}

function resolveTrustedWebContents(
  registration: AionUiScheduleBridgeIpcRegistration,
): ResolvedAionUiScheduleBridgeWebContents | null {
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
  event: AionUiScheduleBridgeIpcEvent,
  trusted: ResolvedAionUiScheduleBridgeWebContents | null,
): boolean {
  if (trusted === null) return false;
  try {
    return event.sender === trusted.webContents && event.senderFrame === trusted.mainFrame;
  } catch {
    return false;
  }
}

export function registerAionUiScheduleBridgeIpc(
  registration: AionUiScheduleBridgeIpcRegistration,
): () => void {
  const requestHandler: AionUiScheduleBridgeIpcHandler = async (event, ...args) => {
    const trusted = resolveTrustedWebContents(registration);
    if (!isTrustedEvent(event, trusted)) {
      return aionUiScheduleBridgeError("schedule-untrusted-sender");
    }
    if (args.length !== 1) {
      return aionUiScheduleBridgeError("schedule-invalid-request");
    }
    return registration.bridge.handle(args[0]);
  };
  registration.ipcMain.handle(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, requestHandler);
  let unsubscribe: () => void;
  try {
    unsubscribe = registration.bridge.subscribe((event) => {
      const trusted = resolveTrustedWebContents(registration);
      if (trusted === null) return;
      try {
        assertAionUiScheduleEvent(event);
        trusted.webContents.send(ACTESTRA_SCHEDULE_EVENT_CHANNEL, event);
      } catch {
        // Renderer event delivery cannot change schedule authority.
      }
    });
  } catch (error) {
    registration.ipcMain.removeHandler(ACTESTRA_SCHEDULE_REQUEST_CHANNEL);
    throw error;
  }

  let registered = true;
  return (): void => {
    if (!registered) return;
    registered = false;
    try {
      unsubscribe();
    } finally {
      registration.ipcMain.removeHandler(ACTESTRA_SCHEDULE_REQUEST_CHANNEL);
    }
  };
}
