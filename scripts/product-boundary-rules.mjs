import { builtinModules } from "node:module";

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const bareNodeBuiltinRoots = [
  ...new Set(builtinModules.map((specifier) => specifier.replace(/^node:/, "").split("/", 1)[0])),
]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegularExpression)
  .join("|");

const nodeBuiltinSpecifier = String.raw`(?:node:[a-zA-Z0-9_./-]+|(?:${bareNodeBuiltinRoots})(?:/[a-zA-Z0-9_./-]+)?)`;
const nodeBuiltinImportPattern = new RegExp(
  String.raw`(?:\b(?:import|export)\s+(?:(?:type\s+)?[\w*{},\s]+?\s+from\s+)?['"]${nodeBuiltinSpecifier}['"]|\bimport\s*\(\s*['"]${nodeBuiltinSpecifier}['"])`,
);
const electronImportPattern =
  /(?:\b(?:import|export)\s+(?:(?:type\s+)?[\w*{},\s]+?\s+from\s+)?['"]electron(?:\/[a-zA-Z0-9_./-]+)?['"]|\bimport\s*\(\s*['"]electron(?:\/[a-zA-Z0-9_./-]+)?['"])/;

export const rendererPrivilegePatterns = Object.freeze([
  { label: "Electron import", pattern: electronImportPattern },
  { label: "Node import", pattern: nodeBuiltinImportPattern },
  { label: "CommonJS require", pattern: /\brequire\s*\(/ },
  { label: "Node process global", pattern: /\bprocess\./ },
  { label: "direct fetch client", pattern: /\bfetch\s*\(/ },
  { label: "direct WebSocket client", pattern: /\bnew\s+WebSocket\s*\(/ },
  { label: "direct EventSource client", pattern: /\bnew\s+EventSource\s*\(/ },
  { label: "direct XMLHttpRequest client", pattern: /\bnew\s+XMLHttpRequest\s*\(/ },
  { label: "window require escape", pattern: /\bwindow(?:\[['"]require['"]\]|\.require)\b/ },
]);

export const preloadPrivilegePatterns = Object.freeze([
  { label: "Node import", pattern: nodeBuiltinImportPattern },
  { label: "main-process import", pattern: /from\s+['"]\.\.\/main(?:\/|['"])/ },
  { label: "core privileged import", pattern: /from\s+['"]\.\.\/core(?:\/|['"])/ },
  { label: "CommonJS require", pattern: /\brequire\s*\(/ },
  { label: "Node process global", pattern: /\bprocess\./ },
  {
    label: "generic IPC subscription",
    pattern: /\bipcRenderer\.(?:on|once|addListener|removeListener)\s*\(/,
  },
  {
    label: "privileged IPC primitive",
    pattern: /\bipcRenderer\.(?:sendSync|sendTo|postMessage)\s*\(/,
  },
  {
    label: "raw ipcRenderer exposure",
    pattern: /exposeInMainWorld\s*\([^,]+,\s*ipcRenderer\s*\)/,
  },
]);
