// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  ACTESTRA_SCHEDULE_EVENT_CHANNEL,
  ACTESTRA_SCHEDULE_REQUEST_CHANNEL,
  toNativeCronJob,
  type AionUiScheduleEvent,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  AionUiScheduleBridgeService,
  registerAionUiScheduleBridgeIpc,
  type AionUiScheduleBridgeIpcEvent,
  type AionUiScheduleBridgeIpcMain,
  type AionUiScheduleBridgeWebContents,
} from "../../apps/desktop/src/main/compatibility/aionuiScheduleBridgeService";
import { AionUiScheduleServiceError } from "../../apps/desktop/src/main/compatibility/aionuiScheduleService";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

type IpcHandler = (event: AionUiScheduleBridgeIpcEvent, ...args: unknown[]) => unknown;

class FakeIpcMain implements AionUiScheduleBridgeIpcMain {
  readonly handlers = new Map<string, IpcHandler>();

  handle(channel: string, listener: IpcHandler): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, event: AionUiScheduleBridgeIpcEvent, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`Missing handler ${channel}`);
    return handler(event, ...args);
  }
}

function schedulePort() {
  const handlers = new Set<(event: AionUiScheduleEvent) => void>();
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    runNow: vi.fn(),
    history: vi.fn(),
    subscribe: vi.fn((handler: (event: AionUiScheduleEvent) => void) => {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    }),
    emit(event: AionUiScheduleEvent): void {
      for (const handler of handlers) handler(event);
    },
  };
}

const registration = createAionUiScheduleRegistration("bridge-service");
const job = toNativeCronJob(registration.job);

describe("AionUiScheduleBridgeService", () => {
  it("dispatches the exact native cron routes into the main-owned schedule service", async () => {
    const schedule = schedulePort();
    schedule.list.mockResolvedValue([job]);
    schedule.get.mockResolvedValue(job);
    schedule.create.mockResolvedValue(job);
    schedule.update.mockResolvedValue({ ...job, enabled: false });
    schedule.remove.mockResolvedValue(undefined);
    schedule.runNow.mockResolvedValue({ conversation_id: job.metadata.conversation_id });
    schedule.history.mockResolvedValue([]);
    const bridge = new AionUiScheduleBridgeService(schedule);
    const createBody = {
      name: job.name,
      schedule: job.schedule,
      prompt: job.target.payload.text,
      conversation_id: job.metadata.conversation_id,
      created_by: "user",
      execution_mode: "existing",
    };

    await expect(
      bridge.handle({ contractVersion: 1, method: "GET", path: "/api/cron/jobs", body: undefined }),
    ).resolves.toEqual({ contractVersion: 1, status: 200, data: [job] });
    expect(schedule.list).toHaveBeenLastCalledWith(undefined);
    await bridge.handle({
      contractVersion: 1,
      method: "GET",
      path: `/api/cron/jobs?conversation_id=${encodeURIComponent(job.metadata.conversation_id)}`,
      body: undefined,
    });
    expect(schedule.list).toHaveBeenLastCalledWith(job.metadata.conversation_id);
    await bridge.handle({
      contractVersion: 1,
      method: "GET",
      path: `/api/cron/jobs/${job.id}`,
      body: undefined,
    });
    expect(schedule.get).toHaveBeenCalledWith(job.id);
    await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: "/api/cron/jobs",
      body: createBody,
    });
    expect(schedule.create).toHaveBeenCalledWith(createBody);
    await bridge.handle({
      contractVersion: 1,
      method: "PUT",
      path: `/api/cron/jobs/${job.id}`,
      body: { enabled: false },
    });
    expect(schedule.update).toHaveBeenCalledWith(job.id, { enabled: false });
    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "DELETE",
        path: `/api/cron/jobs/${job.id}`,
        body: undefined,
      }),
    ).resolves.toEqual({ contractVersion: 1, status: 200, data: null });
    expect(schedule.remove).toHaveBeenCalledWith(job.id);
    await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: `/api/cron/jobs/${job.id}/run`,
      body: { job_id: job.id },
    });
    expect(schedule.runNow).toHaveBeenCalledWith(job.id);
    await bridge.handle({
      contractVersion: 1,
      method: "GET",
      path: `/api/cron/jobs/${job.id}/conversations`,
      body: undefined,
    });
    expect(schedule.history).toHaveBeenCalledWith(job.id);

    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "POST",
        path: `/api/cron/jobs/${job.id}/skill`,
        body: { content: "unsupported skill" },
      }),
    ).resolves.toMatchObject({ status: 501, code: "schedule-skill-unsupported" });
  });

  it("maps unavailable, invalid, and service failures to bounded error envelopes", async () => {
    const unavailable = new AionUiScheduleBridgeService(null);
    await expect(
      unavailable.handle({
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs",
        body: undefined,
      }),
    ).resolves.toEqual({
      contractVersion: 1,
      status: 503,
      code: "schedule-unavailable",
      message: "Actestra scheduling is unavailable",
    });

    const schedule = schedulePort();
    schedule.create.mockResolvedValue(job);
    schedule.runNow.mockRejectedValue(
      new AionUiScheduleServiceError(
        "schedule-busy",
        `private root ${registration.workspaceGrant.rootPath}`,
      ),
    );
    const bridge = new AionUiScheduleBridgeService(schedule);
    const busy = await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: `/api/cron/jobs/${job.id}/run`,
      body: { job_id: job.id },
    });
    expect(busy).toEqual({
      contractVersion: 1,
      status: 409,
      code: "schedule-busy",
      message: "The scheduled job already has an active run",
    });
    expect(JSON.stringify(busy)).not.toContain(registration.workspaceGrant.rootPath);
    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs",
        body: { workspaceRoot: registration.workspaceGrant.rootPath },
      }),
    ).resolves.toMatchObject({ status: 400, code: "schedule-invalid-request" });
    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "POST",
        path: "/api/cron/jobs",
        body: {
          name: job.name,
          schedule: job.schedule,
          prompt: job.target.payload.text,
          conversation_id: job.metadata.conversation_id,
          created_by: "user",
          execution_mode: "existing",
          workspaceRoot: registration.workspaceGrant.rootPath,
        },
      }),
    ).resolves.toMatchObject({ status: 400, code: "schedule-invalid-request" });
    expect(schedule.create).not.toHaveBeenCalled();
  });

  it("contains unsupported runtime service error codes in the fixed error contract", async () => {
    const schedule = schedulePort();
    const unsupported = new AionUiScheduleServiceError(
      "schedule-execution-failed",
      "private service failure",
    );
    Object.defineProperty(unsupported, "code", { value: "schedule-private-error" });
    schedule.runNow.mockRejectedValue(unsupported);
    const bridge = new AionUiScheduleBridgeService(schedule);

    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "POST",
        path: `/api/cron/jobs/${job.id}/run`,
        body: { job_id: job.id },
      }),
    ).resolves.toEqual({
      contractVersion: 1,
      status: 500,
      code: "schedule-execution-failed",
      message: "The scheduled operation failed",
    });
  });

  it("blocks provider DTOs and events that violate the authoritative text contract", async () => {
    const schedule = schedulePort();
    const invalidJob = { ...job, name: ` ${job.name}` };
    schedule.list.mockResolvedValue([invalidJob]);
    const bridge = new AionUiScheduleBridgeService(schedule);

    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs",
        body: undefined,
      }),
    ).resolves.toEqual({
      contractVersion: 1,
      status: 500,
      code: "schedule-execution-failed",
      message: "The scheduled operation failed",
    });

    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const sent: unknown[][] = [];
    const trusted = {
      mainFrame,
      send: (...args: unknown[]) => sent.push(args),
      isDestroyed: () => false,
    } satisfies AionUiScheduleBridgeWebContents;
    const dispose = registerAionUiScheduleBridgeIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      bridge,
    });
    schedule.emit({ type: "cron.job-created", payload: invalidJob });
    expect(sent).toEqual([]);
    dispose();
  });

  it("registers one main-frame request handler and sends only fixed validated events", async () => {
    const schedule = schedulePort();
    schedule.list.mockResolvedValue([job]);
    const bridge = new AionUiScheduleBridgeService(schedule);
    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const sent: unknown[][] = [];
    const trusted = {
      mainFrame,
      send: (...args: unknown[]) => sent.push(args),
      isDestroyed: () => false,
    } satisfies AionUiScheduleBridgeWebContents;
    const event = { sender: trusted, senderFrame: mainFrame };
    const dispose = registerAionUiScheduleBridgeIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      bridge,
    });
    const request = {
      contractVersion: 1,
      method: "GET",
      path: "/api/cron/jobs",
      body: undefined,
    };

    await expect(
      ipcMain.invoke(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, event, request),
    ).resolves.toEqual({ contractVersion: 1, status: 200, data: [job] });
    await expect(
      ipcMain.invoke(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, event, request, "extra"),
    ).resolves.toMatchObject({ status: 400, code: "schedule-invalid-request" });
    await expect(
      ipcMain.invoke(
        ACTESTRA_SCHEDULE_REQUEST_CHANNEL,
        { sender: { mainFrame: {} }, senderFrame: {} },
        request,
      ),
    ).resolves.toMatchObject({ status: 403, code: "schedule-untrusted-sender" });

    schedule.emit({ type: "cron.job-created", payload: job });
    expect(sent).toEqual([
      [ACTESTRA_SCHEDULE_EVENT_CHANNEL, { type: "cron.job-created", payload: job }],
    ]);

    dispose();
    dispose();
    expect(ipcMain.handlers.size).toBe(0);
    schedule.emit({ type: "cron.job-removed", payload: { job_id: job.id } });
    expect(sent).toHaveLength(1);
  });

  it("fails closed when trusted web contents are destroyed or throw during request checks", async () => {
    const schedule = schedulePort();
    schedule.list.mockResolvedValue([job]);
    const bridge = new AionUiScheduleBridgeService(schedule);
    const request = {
      contractVersion: 1,
      method: "GET",
      path: "/api/cron/jobs",
      body: undefined,
    };
    const mainFrame = {};
    const live = {
      mainFrame,
      send: vi.fn(),
      isDestroyed: () => false,
    } satisfies AionUiScheduleBridgeWebContents;
    const destroyed = {
      mainFrame,
      send: vi.fn(),
      isDestroyed: () => true,
    } satisfies AionUiScheduleBridgeWebContents;
    const throwingDestroyedCheck = {
      mainFrame,
      send: vi.fn(),
      isDestroyed: () => {
        throw new Error("destroyed check failed");
      },
    } satisfies AionUiScheduleBridgeWebContents;
    const throwingMainFrame = {
      get mainFrame(): unknown {
        throw new Error("main frame lookup failed");
      },
      send: vi.fn(),
      isDestroyed: () => false,
    } satisfies AionUiScheduleBridgeWebContents;
    const cases = [
      {
        trustedWebContents: (): AionUiScheduleBridgeWebContents | null => {
          throw new Error("trusted web contents lookup failed");
        },
        event: { sender: {}, senderFrame: {} },
      },
      {
        trustedWebContents: () => destroyed,
        event: { sender: destroyed, senderFrame: mainFrame },
      },
      {
        trustedWebContents: () => throwingDestroyedCheck,
        event: { sender: throwingDestroyedCheck, senderFrame: mainFrame },
      },
      {
        trustedWebContents: () => throwingMainFrame,
        event: { sender: throwingMainFrame, senderFrame: {} },
      },
      {
        trustedWebContents: () => live,
        event: {
          get sender(): unknown {
            throw new Error("event sender lookup failed");
          },
          senderFrame: mainFrame,
        },
      },
      {
        trustedWebContents: () => live,
        event: {
          sender: live,
          get senderFrame(): unknown {
            throw new Error("event sender frame lookup failed");
          },
        },
      },
    ];

    for (const current of cases) {
      const ipcMain = new FakeIpcMain();
      const dispose = registerAionUiScheduleBridgeIpc({
        ipcMain,
        trustedWebContents: current.trustedWebContents,
        bridge,
      });
      await expect(
        ipcMain.invoke(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, current.event, request),
      ).resolves.toMatchObject({ status: 403, code: "schedule-untrusted-sender" });
      dispose();
    }
    expect(schedule.list).not.toHaveBeenCalled();
  });

  it("contains trusted web contents and send failures during event delivery", () => {
    const schedule = schedulePort();
    const bridge = new AionUiScheduleBridgeService(schedule);
    const mainFrame = {};
    const throwingDestroyedCheck = {
      mainFrame,
      send: vi.fn(),
      isDestroyed: () => {
        throw new Error("destroyed check failed");
      },
    } satisfies AionUiScheduleBridgeWebContents;
    const throwingSend = {
      mainFrame,
      send: () => {
        throw new Error("send failed");
      },
      isDestroyed: () => false,
    } satisfies AionUiScheduleBridgeWebContents;
    const trustedResolvers = [
      (): AionUiScheduleBridgeWebContents | null => {
        throw new Error("trusted web contents lookup failed");
      },
      () => throwingDestroyedCheck,
      () => throwingSend,
    ];

    for (const trustedWebContents of trustedResolvers) {
      const ipcMain = new FakeIpcMain();
      const dispose = registerAionUiScheduleBridgeIpc({ ipcMain, trustedWebContents, bridge });
      expect(() => schedule.emit({ type: "cron.job-created", payload: job })).not.toThrow();
      dispose();
    }
  });

  it("removes its request handler when event subscription registration fails", () => {
    const schedule = schedulePort();
    schedule.subscribe.mockImplementationOnce(() => {
      throw new Error("event subscription failed");
    });
    const ipcMain = new FakeIpcMain();

    expect(() =>
      registerAionUiScheduleBridgeIpc({
        ipcMain,
        trustedWebContents: () => null,
        bridge: new AionUiScheduleBridgeService(schedule),
      }),
    ).toThrow("event subscription failed");
    expect(ipcMain.handlers.size).toBe(0);
  });

  it("removes its request handler even when event unsubscription fails", () => {
    const schedule = schedulePort();
    schedule.subscribe.mockImplementationOnce(() => () => {
      throw new Error("event unsubscription failed");
    });
    const ipcMain = new FakeIpcMain();
    const dispose = registerAionUiScheduleBridgeIpc({
      ipcMain,
      trustedWebContents: () => null,
      bridge: new AionUiScheduleBridgeService(schedule),
    });

    expect(dispose).toThrow("event unsubscription failed");
    expect(ipcMain.handlers.size).toBe(0);
  });
});
