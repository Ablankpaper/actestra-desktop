import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  type AppInfo,
  type PlatformSnapshot,
} from "../../apps/desktop/src/shared/contracts";
import { App } from "../../apps/desktop/src/renderer/App";

const APP_INFO: AppInfo = {
  name: "Actestra",
  version: "0.1.0-alpha.0",
  dataLayoutVersion: 1,
  platform: "darwin",
  arch: "arm64",
  environment: "development",
  networkPolicy: "offline-shell",
};

const PLATFORM_SNAPSHOT: PlatformSnapshot = {
  contractVersion: PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  authority: "main-only",
  privilegedServices: "registered-inert",
  policy: "deny-by-default",
  credentials: "opaque-references-only",
  tools: "disabled",
  audit: {
    durability: "sqlite-metadata-only",
    recordCount: 0,
    lastSequence: 0,
  },
  attempts: [],
};

describe("Actestra product shell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "actestra", {
      configurable: true,
      value: {
        getAppInfo: vi.fn().mockResolvedValue(APP_INFO),
        getPlatformSnapshot: vi.fn().mockResolvedValue(PLATFORM_SNAPSHOT),
        notifyRendererReady: vi.fn(),
      },
    });
  });

  it("renders the independent, offline-first identity and app metadata", async () => {
    render(<App />);

    expect(screen.getAllByText("Actestra")).toHaveLength(2);
    expect(screen.getAllByText("Work, orchestrated.")).toHaveLength(2);
    expect(
      screen.getByText("No account required. External access is blocked."),
    ).toBeInTheDocument();
    expect(screen.getByText("No upstream runtime loaded")).toBeInTheDocument();
    expect(await screen.findByText("0.1.0-alpha.0")).toBeInTheDocument();
    expect(screen.getByText("darwin · arm64")).toBeInTheDocument();
    expect(screen.getByText("External blocked")).toBeInTheDocument();
    expect(await screen.findByText("Main-only")).toBeInTheDocument();
    expect(screen.getByText("0 terminal attempts")).toBeInTheDocument();
    expect(window.actestra.notifyRendererReady).toHaveBeenCalled();
  });

  it("keeps the first task affordance as reversible local UI state", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create a draft task/i }));
    expect(screen.getByText("Draft surface ready.")).toBeInTheDocument();
    expect(screen.getByText(/task persistence and workers arrive behind p3/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss draft notice/i }));
    expect(screen.queryByText("Draft surface ready.")).not.toBeInTheDocument();
  });

  it("reports metadata failure without unlocking another integration path", async () => {
    vi.mocked(window.actestra.getAppInfo).mockRejectedValueOnce(new Error("bridge unavailable"));

    render(<App />);

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("No workers running")).toBeInTheDocument();
  });

  it("reports platform evidence failure instead of leaving a loading claim", async () => {
    vi.mocked(window.actestra.getPlatformSnapshot).mockRejectedValueOnce(
      new Error("platform evidence unavailable"),
    );

    render(<App />);

    expect(await screen.findByText("Evidence unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Evidence loading")).not.toBeInTheDocument();
  });
});
