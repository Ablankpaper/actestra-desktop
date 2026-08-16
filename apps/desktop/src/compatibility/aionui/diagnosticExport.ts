export const AIONUI_DIAGNOSTIC_EXPORT_STATUSES = ["saved", "cancelled", "rejected"] as const;
export const AIONUI_DIAGNOSTIC_EXPORT_CHANNEL = "actestra:diagnostic-export" as const;

export type AionUiDiagnosticExportStatus = (typeof AIONUI_DIAGNOSTIC_EXPORT_STATUSES)[number];

export interface AionUiDiagnosticExportResult {
  readonly status: AionUiDiagnosticExportStatus;
}

export interface AionUiDiagnosticExportPort {
  exportReport(): Promise<AionUiDiagnosticExportResult>;
}

export interface AionUiDiagnosticExportIpcEvent {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

export interface AionUiDiagnosticExportIpcMain {
  handle(
    channel: typeof AIONUI_DIAGNOSTIC_EXPORT_CHANNEL,
    handler: (event: AionUiDiagnosticExportIpcEvent, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: typeof AIONUI_DIAGNOSTIC_EXPORT_CHANNEL): void;
}

export interface AionUiDiagnosticExportWebContents {
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
}

export interface AionUiDiagnosticExportIpcOptions {
  readonly ipcMain: AionUiDiagnosticExportIpcMain;
  readonly trustedWebContents: () => AionUiDiagnosticExportWebContents | null;
  readonly exporter: AionUiDiagnosticExportPort;
}

export class AionUiDiagnosticExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AionUiDiagnosticExportError";
  }
}

export function assertAionUiDiagnosticExportResult(
  value: unknown,
): asserts value is AionUiDiagnosticExportResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AionUiDiagnosticExportError("AionUI diagnostic export result must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, "status") ||
    !AIONUI_DIAGNOSTIC_EXPORT_STATUSES.includes(record.status as AionUiDiagnosticExportStatus)
  ) {
    throw new AionUiDiagnosticExportError(
      "AionUI diagnostic export result must contain one closed status",
    );
  }
}

function rejectedResult(): AionUiDiagnosticExportResult {
  return Object.freeze({ status: "rejected" });
}

function ownsCurrentMainFrame(
  event: AionUiDiagnosticExportIpcEvent,
  options: AionUiDiagnosticExportIpcOptions,
): boolean {
  try {
    const webContents = options.trustedWebContents();
    return (
      webContents !== null &&
      !webContents.isDestroyed() &&
      event.sender === webContents &&
      event.senderFrame === webContents.mainFrame
    );
  } catch {
    return false;
  }
}

export function registerAionUiDiagnosticExportIpc(
  options: AionUiDiagnosticExportIpcOptions,
): () => void {
  let active = true;
  options.ipcMain.handle(AIONUI_DIAGNOSTIC_EXPORT_CHANNEL, async (event, ...args) => {
    if (!active || args.length !== 0 || !ownsCurrentMainFrame(event, options)) {
      return rejectedResult();
    }
    try {
      const result = await options.exporter.exportReport();
      assertAionUiDiagnosticExportResult(result);
      return Object.freeze({ status: result.status });
    } catch {
      return rejectedResult();
    }
  });

  return () => {
    if (!active) return;
    active = false;
    options.ipcMain.removeHandler(AIONUI_DIAGNOSTIC_EXPORT_CHANNEL);
  };
}

declare global {
  interface Window {
    actestraDiagnostics?: AionUiDiagnosticExportPort;
  }
}
