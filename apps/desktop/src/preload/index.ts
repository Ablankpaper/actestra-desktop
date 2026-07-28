import { contextBridge, ipcRenderer } from "electron";
import { createActestraBridge } from "./bridge";

contextBridge.exposeInMainWorld("actestra", createActestraBridge(ipcRenderer));
