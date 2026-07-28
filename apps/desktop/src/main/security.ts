import type { BrowserWindow, Session } from "electron";

const DEVELOPMENT_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function isAllowedDevelopmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      DEVELOPMENT_HOSTS.has(url.hostname) &&
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

export function installSessionSecurity(targetSession: Session, isPackaged: boolean): void {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  targetSession.webRequest.onBeforeRequest(
    {
      urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
    },
    (details, callback) => {
      const allowDevelopmentRequest = !isPackaged && isAllowedDevelopmentUrl(details.url);
      callback({ cancel: !allowDevelopmentRequest });
    },
  );
}

export function installWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });
}
