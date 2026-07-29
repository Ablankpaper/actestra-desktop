import path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { AppInfo } from "../shared/contracts";
import { CURRENT_DATA_LAYOUT_VERSION, ensureDataLayout } from "./dataLayout";
import { registerDesktopIpc } from "./ipc/desktopIpc";
import { launchElectronPersistenceUtility } from "./persistence/electronPersistenceUtility";
import {
  createMainPlatformServices,
  type MainPlatformServices,
} from "./platform/mainPlatformServices";
import { isActestraDeepLink, PRODUCT_NAME, resolveUserDataPath } from "./productIdentity";
import { installSessionSecurity, installWindowSecurity } from "./security";
import { createWindowOptions } from "./windowOptions";
import { runGeneralWorkerProbe } from "./workers/generalWorkerProbe";

let mainWindow: BrowserWindow | null = null;
let platformServices: MainPlatformServices | null = null;
let disposeDesktopIpc: (() => void) | null = null;
let hasReportedRendererReady = false;
let platformShutdown: Promise<void> | null = null;
let platformShutdownComplete = false;

app.setName(PRODUCT_NAME);
app.setPath(
  "userData",
  resolveUserDataPath(app.getPath("appData"), process.env.ACTESTRA_USER_DATA_DIR),
);

function getAppInfo(): AppInfo {
  return {
    name: PRODUCT_NAME,
    version: app.getVersion(),
    dataLayoutVersion: CURRENT_DATA_LAYOUT_VERSION,
    platform: process.platform,
    arch: process.arch,
    environment: app.isPackaged ? "packaged" : "development",
    networkPolicy: "offline-shell",
  };
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  const window = new BrowserWindow(createWindowOptions(preloadPath, app.isPackaged));
  mainWindow = window;

  installWindowSecurity(window);

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`ACTESTRA_RENDERER_LOAD_FAILED ${errorCode} ${errorDescription}`);
  });

  window.webContents.on("preload-error", (_event, preloadPathWithError, error) => {
    console.error(`ACTESTRA_PRELOAD_FAILED ${preloadPathWithError} ${error.message}`);
  });

  window.once("ready-to-show", () => {
    window.show();
    console.info("ACTESTRA_WINDOW_READY");
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find(isActestraDeepLink);
    if (deepLink) {
      console.info("ACTESTRA_DEEP_LINK_RECEIVED");
    }
    focusMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (isActestraDeepLink(url)) {
      console.info("ACTESTRA_DEEP_LINK_RECEIVED");
      focusMainWindow();
    }
  });

  void app
    .whenReady()
    .then(async () => {
      const dataLayoutState = ensureDataLayout(app.getPath("userData"));
      console.info(
        `ACTESTRA_DATA_LAYOUT_READY ${JSON.stringify({
          version: CURRENT_DATA_LAYOUT_VERSION,
          state: dataLayoutState,
        })}`,
      );

      installSessionSecurity(session.defaultSession, app.isPackaged);
      const persistence = await launchElectronPersistenceUtility({
        modulePath: path.join(__dirname, "persistence-utility.js"),
        userDataPath: app.getPath("userData"),
        workingDirectory: process.resourcesPath,
      });
      console.info(
        `ACTESTRA_PERSISTENCE_UTILITY_READY ${JSON.stringify({
          schemaVersion: persistence.schemaVersion,
          mode: "utility-process",
        })}`,
      );
      const services = createMainPlatformServices(persistence);
      platformServices = services;
      if (process.env.ACTESTRA_E2E_TEST === "1") {
        const workerProbe = await runGeneralWorkerProbe({
          modulePath: path.join(__dirname, "general-worker.js"),
          workingDirectory: process.resourcesPath,
        });
        console.info(`ACTESTRA_GENERAL_WORKER_READY ${JSON.stringify(workerProbe)}`);
      }
      disposeDesktopIpc = registerDesktopIpc({
        ipcMain,
        trustedWebContents: () => mainWindow?.webContents ?? null,
        getAppInfo,
        getPlatformSnapshot: () => services.snapshot(),
        onRendererReady: () => {
          if (!hasReportedRendererReady) {
            hasReportedRendererReady = true;
            console.info("ACTESTRA_RENDERER_READY");
          }
        },
      });

      await createMainWindow();
      console.info(
        `ACTESTRA_READY ${JSON.stringify({
          version: app.getVersion(),
          environment: app.isPackaged ? "packaged" : "development",
        })}`,
      );

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createMainWindow().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "unknown activation error";
            console.error(`ACTESTRA_ACTIVATE_FAILED ${message}`);
          });
        } else {
          focusMainWindow();
        }
      });
    })
    .catch(async (error: unknown) => {
      disposeDesktopIpc?.();
      disposeDesktopIpc = null;
      await platformServices?.close().catch(() => undefined);
      platformServices = null;
      const message = error instanceof Error ? error.message : "unknown startup error";
      console.error(`ACTESTRA_STARTUP_FAILED ${message}`);
      app.exit(1);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", (event) => {
  if (platformShutdownComplete) {
    return;
  }

  event.preventDefault();
  if (platformShutdown !== null) {
    return;
  }

  disposeDesktopIpc?.();
  disposeDesktopIpc = null;
  const services = platformServices;
  platformServices = null;
  platformShutdown = (async () => {
    try {
      await services?.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown persistence close error";
      console.error(`ACTESTRA_PLATFORM_CLOSE_FAILED ${message}`);
    } finally {
      platformShutdownComplete = true;
      app.quit();
    }
  })();
});
