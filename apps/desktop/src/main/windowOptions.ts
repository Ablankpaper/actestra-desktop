import type { BrowserWindowConstructorOptions } from "electron";

export function createWindowOptions(
  preloadPath: string,
  isPackaged: boolean,
): BrowserWindowConstructorOptions {
  return {
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {
      x: 18,
      y: 18,
    },
    backgroundColor: "#0b1020",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !isPackaged,
    },
  };
}
