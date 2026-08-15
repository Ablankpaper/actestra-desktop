import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

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
const privilegedProcessImportPattern =
  /(?:\b(?:import|export)\s+(?:(?:type\s+)?[\w*{},\s]+?\s+from\s+)?['"](?:\.\.\/)+(?:main|utility)(?:\/|['"])|\bimport\s*\(\s*['"](?:\.\.\/)+(?:main|utility)(?:\/|['"]))/;
const gitAuthorityImportPattern =
  /(?:\bimport\s+(?!type\b)(?:[\w*{},\s]+?\s+from\s+)?['"](?:isomorphic-git|simple-git|dugite|nodegit)(?:\/[a-zA-Z0-9_./-]+)?['"]|\bexport\s+(?!type\b)[\w*{},\s]+?\s+from\s+['"](?:isomorphic-git|simple-git|dugite|nodegit)(?:\/[a-zA-Z0-9_./-]+)?['"]|\bimport\s*\(\s*['"](?:isomorphic-git|simple-git|dugite|nodegit)(?:\/[a-zA-Z0-9_./-]+)?['"])/;

export const rendererPrivilegePatterns = Object.freeze([
  { label: "Electron import", pattern: electronImportPattern },
  { label: "Node import", pattern: nodeBuiltinImportPattern },
  { label: "privileged process import", pattern: privilegedProcessImportPattern },
  { label: "Git authority import", pattern: gitAuthorityImportPattern },
  { label: "CommonJS require", pattern: /\brequire\s*\(/ },
  { label: "Node process global", pattern: /\bprocess\./ },
  { label: "direct fetch client", pattern: /\bfetch\s*\(/ },
  { label: "direct WebSocket client", pattern: /\bnew\s+WebSocket\s*\(/ },
  { label: "direct EventSource client", pattern: /\bnew\s+EventSource\s*\(/ },
  { label: "direct XMLHttpRequest client", pattern: /\bnew\s+XMLHttpRequest\s*\(/ },
  { label: "window require escape", pattern: /\bwindow(?:\[['"]require['"]\]|\.require)\b/ },
]);

export const actestraTeamRendererPrivilegePatterns = Object.freeze([
  ...rendererPrivilegePatterns.filter((rule) => rule.label !== "Node process global"),
  {
    label: "Node process global",
    pattern: /\bprocess(?:\.(?!env\.NODE_ENV\b)|\s*\[)/,
  },
]);

export const actestraTeamRendererAuthorityPaths = Object.freeze([
  "packages/desktop/src/common/adapter/actestraTeamClient.ts",
  "packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx",
  "packages/desktop/src/renderer/pages/team/TeamPage.tsx",
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamArtifactList.tsx",
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "packages/desktop/src/renderer/pages/team/components/TeamCreateExperienceChooser.tsx",
  "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx",
  "packages/desktop/src/renderer/pages/team/components/TeamTabs.tsx",
  "packages/desktop/src/renderer/pages/team/components/memberPicker/TeamAddMemberPopover.tsx",
  "packages/desktop/src/renderer/pages/team/components/teamSendRuntime.ts",
  "packages/desktop/src/renderer/pages/team/hooks/TeamPermissionContext.tsx",
  "packages/desktop/src/renderer/pages/team/hooks/TeamTabsContext.tsx",
  "packages/desktop/src/renderer/pages/team/hooks/teamConfigOptions.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useSiderTeamBadges.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useTeamPendingPermissions.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useTeamRunView.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useTeamSession.ts",
  "packages/desktop/src/renderer/pages/team/hooks/useTeamWarmup.ts",
  "packages/desktop/src/renderer/pages/team/index.tsx",
]);

export const preloadPrivilegePatterns = Object.freeze([
  { label: "Node import", pattern: nodeBuiltinImportPattern },
  { label: "privileged process import", pattern: privilegedProcessImportPattern },
  { label: "Git authority import", pattern: gitAuthorityImportPattern },
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

export function inspectSourceFilesForPrivilegePatterns({ rootPath, relativePaths, rules }) {
  const resolvedRoot = path.resolve(rootPath);
  const findings = [];

  for (const relativePath of relativePaths) {
    if (
      typeof relativePath !== "string" ||
      relativePath.length === 0 ||
      relativePath.includes("\0") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error("Renderer authority source path must be a non-empty relative path");
    }
    const filePath = path.resolve(resolvedRoot, relativePath);
    const containedPath = path.relative(resolvedRoot, filePath);
    if (
      containedPath === ".." ||
      containedPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(containedPath)
    ) {
      throw new Error(`Renderer authority source path escapes its declared root: ${relativePath}`);
    }

    const source = fs.readFileSync(filePath, "utf8");
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(source)) {
        findings.push({ relativePath, label: rule.label });
      }
    }
  }

  return findings;
}
