import path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { APP_INFO_CHANNEL, RENDERER_READY_CHANNEL, type AppInfo } from "../shared/contracts";
import { CURRENT_DATA_LAYOUT_VERSION, ensureDataLayout } from "./dataLayout";
import { isActestraDeepLink, PRODUCT_NAME, resolveUserDataPath } from "./productIdentity";
import { installSessionSecurity, installWindowSecurity } from "./security";
import { createWindowOptions } from "./windowOptions";

let mainWindow: BrowserWindow | null = null;
let hasReportedRendererReady = false;

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
  const window = new BrowserWindow(createWindowOptions(preloadPath));
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
      ipcMain.handle(APP_INFO_CHANNEL, getAppInfo);
      ipcMain.on(RENDERER_READY_CHANNEL, () => {
        if (!hasReportedRendererReady) {
          hasReportedRendererReady = true;
          console.info("ACTESTRA_RENDERER_READY");
        }
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
          void createMainWindow();
        } else {
          focusMainWindow();
        }
      });
    })
    .catch((error: unknown) => {
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

app.on("will-quit", () => {
  ipcMain.removeHandler(APP_INFO_CHANNEL);
  ipcMain.removeAllListeners(RENDERER_READY_CHANNEL);
});
