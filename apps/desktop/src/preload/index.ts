import { contextBridge, ipcRenderer } from "electron";
import { APP_INFO_CHANNEL, RENDERER_READY_CHANNEL, type ActestraBridge } from "../shared/contracts";

const bridge: ActestraBridge = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  notifyRendererReady: () => ipcRenderer.send(RENDERER_READY_CHANNEL),
});

contextBridge.exposeInMainWorld("actestra", bridge);
