import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function absolutePath(relativePath) {
  return path.join(outputRoot, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), "utf8");
}

function write(relativePath, contents) {
  const filePath = absolutePath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function writeNew(relativePath, contents) {
  if (fs.existsSync(absolutePath(relativePath))) {
    throw new Error(`Downstream overlay expected a new file: ${relativePath}`);
  }
  write(relativePath, contents);
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

function replaceExactCount(relativePath, before, after, expectedCount) {
  const contents = read(relativePath);
  const actualCount = contents.split(before).length - 1;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} downstream patch contexts in ${relativePath}, received ${actualCount}`,
    );
  }
  write(relativePath, contents.split(before).join(after));
}

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `import { readFileSync } from 'fs';`,
  `import { readFileSync } from 'fs';
import { createRequire } from 'node:module';`,
);

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(\`node "\${resolve('scripts/build-mcp-servers.js')}"\`, { stdio: 'inherit' });
    },
  };
}`,
  `function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(\`node "\${resolve('scripts/build-mcp-servers.js')}"\`, { stdio: 'inherit' });
    },
  };
}

function buildActestraTeamPlannerManifestPlugin() {
  const requireFromConfig = createRequire(import.meta.url);
  const { writeActestraTeamPlannerManifest } = requireFromConfig(
    './src/actestra/scripts/actestraNativeTeamPlannerManifest.cjs',
  ) as {
    writeActestraTeamPlannerManifest: (projectRoot: string) => string;
  };
  let projectRoot: string | undefined;
  return {
    name: 'vite-plugin-build-actestra-team-planner-manifest',
    configResolved(config: { readonly root: string }) {
      projectRoot = config.root;
    },
    writeBundle() {
      // electron-vite materializes this config into a temporary module. Use
      // Vite's resolved root and wait until the entry bytes are on disk before
      // binding the manifest; __dirname and process.cwd() are not stable here.
      writeActestraTeamPlannerManifest(projectRoot ?? process.cwd());
    },
  };
}`,
);

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `        ...(isDevelopment ? [buildMcpServersPlugin()] : []),`,
  `        ...(isDevelopment ? [buildMcpServersPlugin()] : []),
        buildActestraTeamPlannerManifestPlugin(),`,
);

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `            'actestra-general-worker': resolve(
              'packages/desktop/src/actestra/utility/worker/generalWorkerEntry.ts'
            ),
            // Built-in MCP server entry points`,
  `            'actestra-general-worker': resolve(
              'packages/desktop/src/actestra/utility/worker/generalWorkerEntry.ts'
            ),
            'actestra-team-planner': resolve(
              'packages/desktop/src/actestra/utility/orchestration/actestraNativeTeamPlannerEntry.ts'
            ),
            // Built-in MCP server entry points`,
);

replaceOnce(
  "scripts/build-with-builder.js",
  `const crypto = require('crypto');`,
  `const crypto = require('crypto');
const ACTESTRA_TEAM_PLANNER_FINAL_ENTRY = 'out/main/actestra-team-planner.js';
const ACTESTRA_TEAM_PLANNER_MANIFEST = 'out/main/actestra-team-planner.manifest.json';
const {
  verifyActestraTeamPlannerManifest,
  writeActestraTeamPlannerManifest,
} = require('../packages/desktop/src/actestra/scripts/actestraNativeTeamPlannerManifest.cjs');`,
);

replaceOnce(
  "scripts/build-with-builder.js",
  `  // If --pack-only, skip electron-builder distributable creation
  if (packOnly) {`,
  `  writeActestraTeamPlannerManifest(path.resolve(__dirname, '..'));
  verifyActestraTeamPlannerManifest(path.resolve(__dirname, '..'));

  // If --pack-only, skip electron-builder distributable creation
  if (packOnly) {`,
);

replaceOnce(
  "scripts/build-with-builder.js",
  `  // 5. Prepare aioncore binary (for packaged runtime usage)`,
  `  verifyActestraTeamPlannerManifest(path.resolve(__dirname, '..'));

  // 5. Prepare aioncore binary (for packaged runtime usage)`,
);

const productStartupPath = "packages/desktop/src/index.ts";

replaceOnce(
  productStartupPath,
  `import {
  closeActestraShadowBridge,
  initializeActestraPersistenceUtility,
  registerActestraShadowBridge,
  resumeActestraSchedule,
} from './process/services/actestraShadowBridge';
import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';`,
  `import {
  closeActestraShadowBridge,
  configureActestraCodingJourneyRuntime,
  configureActestraGeneralWorkRuntime,
  configureActestraTeamRuntime,
  configureActestraTeamWorkerRuntimeAdmission,
  initializeActestraPersistenceUtility,
  registerActestraShadowBridge,
  resumeActestraSchedule,
} from './process/services/actestraShadowBridge';
import { ClientFactory } from './common/api/ClientFactory';
import type { TProviderWithModel } from './common/config/storage';
import {
  projectAionCoreTeamModelCatalog,
  resolveAionCoreMainModelBinding,
} from './actestra/main/model/aionCoreMainModelBinding';
import { startTrustedActestraNativeTeamPlanner } from './actestra/main/orchestration/actestraNativeTeamPlannerProcess';
import {
  resolveTrustedActestraCodingRunnerAdmission,
  startTrustedActestraCodingJourneyRuntime,
} from './actestra/main/workers/actestraCodingJourneyRuntime';
import { startTrustedActestraGeneralWorkRuntime } from './actestra/main/workers/actestraGeneralWorkRuntime';
import {
  createP8ProductJourneyLoopbackModelBinding,
  createP8ProductJourneyTeamModelCatalog,
  resolveP8ProductJourneyRuntimeConfig,
} from './actestra/main/acceptance/p8ProductJourneyRuntime';
import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';`,
);

replaceOnce(
  productStartupPath,
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));`,
  `    await initializeProcess();
    let planner: Awaited<ReturnType<typeof startTrustedActestraNativeTeamPlanner>> | null = null;
    try {
      planner = await startTrustedActestraNativeTeamPlanner();
      configureActestraTeamRuntime({ planner });
      console.info('ACTESTRA_AIONUI_TEAM_PLANNER_READY');
    } catch {
      await planner?.close().catch((): undefined => undefined);
      configureActestraTeamRuntime(null);
      console.warn('ACTESTRA_AIONUI_TEAM_PLANNER_UNAVAILABLE');
    }
`,
);

replaceOnce(
  productStartupPath,
  `  // One-shot backend migrations are deferred until after the renderer finishes
  // loading. Some migration steps (ConfigStorage.get, ipcBridge.listProviders)
  // route through the renderer via BroadcastChannel; running them here would
  // deadlock because the renderer does not exist yet. See scheduleBackendMigrations().`,
  `  const listAionCoreProviders = () => ipcBridge.mode.listProviders.invoke();
  const p8ProductJourneyRuntimeConfig = resolveP8ProductJourneyRuntimeConfig({
    packaged: app.isPackaged,
    environment: process.env,
  });
  let p8ProductJourneyGeneralRuntime: Awaited<ReturnType<typeof startTrustedActestraGeneralWorkRuntime>> = null;
  let p8ProductJourneyCodingRuntime: Awaited<ReturnType<typeof startTrustedActestraCodingJourneyRuntime>> = null;
  if (p8ProductJourneyRuntimeConfig !== null) {
    const loopbackBinding = createP8ProductJourneyLoopbackModelBinding(
      p8ProductJourneyRuntimeConfig,
    );
    p8ProductJourneyGeneralRuntime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: loopbackBinding,
    });
    p8ProductJourneyCodingRuntime = await startTrustedActestraCodingJourneyRuntime({
      userDataPath: app.getPath('userData'),
      runnerAdmission: null,
      linuxPackageResourcesPath: process.platform === 'linux' ? process.resourcesPath : undefined,
      packagedResourcesPath:
        process.platform !== 'linux' && app.isPackaged ? process.resourcesPath : undefined,
      modelBinding: loopbackBinding,
      onFailure: (stage) => {
        console.error(
          'ACTESTRA_P8_PRODUCT_JOURNEYS_RUNTIME_FAILED ' +
            JSON.stringify({ stage }),
        );
      },
    });
    configureActestraGeneralWorkRuntime(p8ProductJourneyGeneralRuntime);
    configureActestraCodingJourneyRuntime(p8ProductJourneyCodingRuntime);
  }
  const p8ProductJourneyTeamCatalog =
    p8ProductJourneyRuntimeConfig === null
      ? null
      : createP8ProductJourneyTeamModelCatalog(p8ProductJourneyRuntimeConfig);
  configureActestraTeamWorkerRuntimeAdmission({
    modelCatalog: p8ProductJourneyTeamCatalog ?? {
      list: async () =>
        Object.freeze({
          providers: Object.freeze(
            projectAionCoreTeamModelCatalog(await listAionCoreProviders()).map((provider) =>
              Object.freeze({
                provider_id: provider.providerId,
                name: provider.name,
                model_ids: provider.modelIds,
              })
            )
          ),
        }),
    },
    admit: async (selection) => {
      if (
        p8ProductJourneyRuntimeConfig !== null &&
        p8ProductJourneyGeneralRuntime !== null &&
        p8ProductJourneyCodingRuntime !== null &&
        selection.providerId === p8ProductJourneyRuntimeConfig.providerId &&
        selection.modelId === p8ProductJourneyRuntimeConfig.modelId
      ) {
        return Object.freeze({
          general: p8ProductJourneyGeneralRuntime,
          coding: p8ProductJourneyCodingRuntime,
        });
      }
      try {
        const modelBinding = await resolveAionCoreMainModelBinding({
          selection,
          listProviders: listAionCoreProviders,
          createClient: async (provider) => {
            const client = await ClientFactory.createRotatingClient(
              provider as unknown as TProviderWithModel,
              { timeout: 60_000 },
            );
            return {
              createChatCompletion: (
                request: unknown,
                options: Readonly<{ signal: AbortSignal }>,
              ) =>
                (client as unknown as {
                  createChatCompletion: (
                    value: unknown,
                    clientOptions?: Readonly<{ signal?: AbortSignal }>,
                  ) => Promise<unknown>;
                }).createChatCompletion(request, options),
            };
          },
        });
        if (modelBinding === null) return null;
        const general = startTrustedActestraGeneralWorkRuntime({ modelBinding });
        if (general === null) return null;
        const coding = await startTrustedActestraCodingJourneyRuntime({
          userDataPath: app.getPath('userData'),
          runnerAdmission: app.isPackaged ? null : resolveTrustedActestraCodingRunnerAdmission(process.env),
          linuxPackageResourcesPath: process.platform === 'linux' ? process.resourcesPath : undefined,
          packagedResourcesPath:
            process.platform !== 'linux' && app.isPackaged ? process.resourcesPath : undefined,
          modelBinding,
        });
        if (coding === null) return null;
        console.info(
          'ACTESTRA_AIONUI_TEAM_WORKER_RUNTIME_READY ' +
            JSON.stringify({ providerId: selection.providerId, modelId: selection.modelId }),
        );
        return Object.freeze({ general, coding });
      } catch {
        return null;
      }
    },
  });
  await initializeActestraPersistenceUtility(app.getPath('userData'));

  // One-shot backend migrations are deferred until after the renderer finishes
  // loading. Some migration steps (ConfigStorage.get, ipcBridge.listProviders)
  // route through the renderer via BroadcastChannel; running them here would
  // deadlock because the renderer does not exist yet. See scheduleBackendMigrations().`,
);

const preloadPath = "packages/desktop/src/preload/main.ts";

replaceOnce(
  preloadPath,
  `} from '../actestra/compatibility/aionui/scheduleBridge';`,
  `} from '../actestra/compatibility/aionui/scheduleBridge';
import {
  ACTESTRA_TEAM_EVENT_CHANNEL,
  ACTESTRA_TEAM_REQUEST_CHANNEL,
  assertAionUiTeamEvent,
  type AionUiTeamBridgeRequest,
  type AionUiTeamEventHandler,
} from '../actestra/compatibility/aionui/teamBridge';`,
);

writeNew(
  "tests/unit/renderer/team/TeamPermissionBadgeAuthority.dom.test.tsx",
  `// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';

const mocks = vi.hoisted(() => {
  const handlers = {
    add: [] as Array<(event: { conversation_id: string }) => void>,
    remove: [] as Array<(event: { conversation_id: string }) => void>,
  };
  return {
    handlers,
    providerActive: true,
    getProjectedTeam: vi.fn(),
    listNativeConfirmations: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        list: { invoke: (...args: unknown[]) => mocks.listNativeConfirmations(...args) },
        add: {
          on: vi.fn((handler: (event: { conversation_id: string }) => void) => {
            mocks.handlers.add.push(handler);
            return () => {};
          }),
        },
        remove: {
          on: vi.fn((handler: (event: { conversation_id: string }) => void) => {
            mocks.handlers.remove.push(handler);
            return () => {};
          }),
        },
      },
    },
  },
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  getActestraTeam: (...args: unknown[]) => mocks.getProjectedTeam(...args),
  isActestraTeamProviderActive: () => mocks.providerActive,
}));

import { useSiderTeamBadges } from '@/renderer/pages/team/hooks/useSiderTeamBadges';
import { useTeamPendingPermissions } from '@/renderer/pages/team/hooks/useTeamPendingPermissions';

describe('provider-active Team permission badge authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.add.length = 0;
    mocks.handlers.remove.length = 0;
    mocks.providerActive = true;
    mocks.listNativeConfirmations.mockResolvedValue([]);
    mocks.getProjectedTeam.mockResolvedValue(teamWithCount(3));
    localStorage.clear();
  });

  it('hydrates page badges from Main/Core and treats native confirmation events only as reconciliation hints', async () => {
    const { result } = renderHook(() => useTeamPendingPermissions('team-1', ['conv-1']));

    await waitFor(() => expect(result.current.pendingCounts['conv-1']).toBe(3));
    expect(mocks.getProjectedTeam).toHaveBeenCalledWith('team-1');
    expect(mocks.listNativeConfirmations).not.toHaveBeenCalled();

    mocks.getProjectedTeam.mockResolvedValue(teamWithCount(5));
    await act(async () => {
      for (const handler of mocks.handlers.add) handler({ conversation_id: 'conv-1' });
    });

    await waitFor(() => expect(result.current.pendingCounts['conv-1']).toBe(5));
    expect(result.current.pendingCounts['conv-1']).not.toBe(4);
  });

  it('reconciles a provider-active sidebar hint through the Main/Core Team projection', async () => {
    const { result } = renderHook(() => useSiderTeamBadges([teamWithCount(1)]));
    expect(result.current.get('team-1')).toBe(1);

    mocks.getProjectedTeam.mockResolvedValue(teamWithCount(4));
    await act(async () => {
      for (const handler of mocks.handlers.add) handler({ conversation_id: 'conv-1' });
    });

    await waitFor(() => expect(result.current.get('team-1')).toBe(4));
    expect(mocks.getProjectedTeam).toHaveBeenCalledWith('team-1');
    expect(result.current.get('team-1')).not.toBe(2);
  });

  it('does not let an older sidebar reconciliation overwrite a newer Main/Core projection', async () => {
    let resolveStale!: (team: TTeam) => void;
    const staleProjection = new Promise<TTeam>((resolve) => {
      resolveStale = resolve;
    });
    mocks.getProjectedTeam.mockImplementationOnce(() => staleProjection);

    const { result, rerender } = renderHook(
      ({ teams }: { teams: TTeam[] }) => useSiderTeamBadges(teams),
      { initialProps: { teams: [teamWithCount(1)] } },
    );
    expect(result.current.get('team-1')).toBe(1);

    await act(async () => {
      mocks.handlers.add[0]!({ conversation_id: 'conv-1' });
    });

    rerender({ teams: [teamWithCount(6)] });
    await waitFor(() => expect(result.current.get('team-1')).toBe(6));

    await act(async () => {
      resolveStale(teamWithCount(4));
    });
    await waitFor(() => expect(result.current.get('team-1')).toBe(6));
  });

  it('retains native list and event behavior when the Actestra Team provider is absent', async () => {
    mocks.providerActive = false;
    mocks.listNativeConfirmations.mockResolvedValue([{}, {}]);
    const { result } = renderHook(() => useTeamPendingPermissions('team-1', ['conv-1']));

    await waitFor(() => expect(result.current.pendingCounts['conv-1']).toBe(2));
    expect(mocks.getProjectedTeam).not.toHaveBeenCalled();

    act(() => {
      for (const handler of mocks.handlers.remove) handler({ conversation_id: 'conv-1' });
    });
    expect(result.current.pendingCounts['conv-1']).toBe(1);
  });
});

function teamWithCount(count: number): TTeam {
  return {
    id: 'team-1',
    user_id: 'system_default_user',
    name: 'Standard Team',
    workspace: '/private/tmp/team',
    workspace_mode: 'shared',
    leader_assistant_id: 'assistant-1',
    created_at: 1,
    updated_at: 1,
    experience: 'standard',
    assistants: [
      {
        slot_id: 'slot-1',
        conversation_id: 'conv-1',
        role: 'leader',
        assistant_backend: 'claude',
        assistant_name: 'Claude Code',
        status: 'idle',
        pending_confirmations: count,
      },
    ],
    agents: [],
  } as TTeam;
}
`,
);

const teamPendingPermissionsPath =
  "packages/desktop/src/renderer/pages/team/hooks/useTeamPendingPermissions.ts";
replaceOnce(
  teamPendingPermissionsPath,
  `import { ipcBridge } from '@/common';
import { useCallback, useEffect, useState } from 'react';`,
  `import { ipcBridge } from '@/common';
import { getActestraTeam, isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';
import type { TTeam } from '@/common/types/team/teamTypes';
import { useCallback, useEffect, useRef, useState } from 'react';`,
);
replaceOnce(
  teamPendingPermissionsPath,
  `  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>(() => readFromStorage());`,
  `  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>(() => readFromStorage());
  const reconcileSequence = useRef(0);`,
);
replaceOnce(
  teamPendingPermissionsPath,
  "    const idSet = new Set(conversation_ids);",
  [
    "    const idSet = new Set(conversation_ids);",
    "    const providerActive = isActestraTeamProviderActive();",
    "    const reconcileFromMain = async (): Promise<void> => {",
    "      const sequence = ++reconcileSequence.current;",
    "      try {",
    "        const projected: TTeam = await getActestraTeam(team_id);",
    "        if (sequence !== reconcileSequence.current) return;",
    "        const counts: Record<string, number> = {};",
    "        for (const assistant of projected.assistants) {",
    "          if (assistant.conversation_id !== undefined && idSet.has(assistant.conversation_id)) {",
    "            counts[assistant.conversation_id] = assistant.pending_confirmations ?? 0;",
    "          }",
    "        }",
    "        setPendingCounts((prev) => {",
    "          const next = { ...prev };",
    "          for (const conversationId of conversation_ids) next[conversationId] = counts[conversationId] ?? 0;",
    "          return next;",
    "        });",
    "      } catch {",
    "        // Keep the last known count while the authoritative projection is unavailable.",
    "      }",
    "    };",
  ].join("\n"),
);
replaceOnce(
  teamPendingPermissionsPath,
  "    const fetchInitial = async () => {",
  [
    "    const fetchInitial = async () => {",
    "      if (providerActive) {",
    "        await reconcileFromMain();",
    "        return;",
    "      }",
  ].join("\n"),
);
replaceExactCount(
  teamPendingPermissionsPath,
  "        if (!idSet.has(data.conversation_id)) return;",
  [
    "        if (!idSet.has(data.conversation_id)) return;",
    "        if (providerActive) {",
    "          void reconcileFromMain();",
    "          return;",
    "        }",
  ].join("\n"),
  2,
);
replaceOnce(
  teamPendingPermissionsPath,
  "  }, [conversation_ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps",
  "  }, [team_id, conversation_ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps",
);

const siderTeamBadgesPath = "packages/desktop/src/renderer/pages/team/hooks/useSiderTeamBadges.ts";
replaceOnce(
  siderTeamBadgesPath,
  "import { ipcBridge } from '@/common';\nimport type { TTeam } from '@/common/types/team/teamTypes';\nimport { useEffect, useState } from 'react';",
  "import { ipcBridge } from '@/common';\nimport { getActestraTeam, isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';\nimport type { TTeam } from '@/common/types/team/teamTypes';\nimport { useEffect, useRef, useState } from 'react';",
);
replaceOnce(
  siderTeamBadgesPath,
  "  const [counts, setCounts] = useState<Map<string, number>>(() => buildTeamCounts(teams));",
  "  const [counts, setCounts] = useState<Map<string, number>>(() => buildTeamCounts(teams));\n  const reconcileSequence = useRef(new Map<string, number>());\n  const providerActive = isActestraTeamProviderActive();",
);
replaceOnce(
  siderTeamBadgesPath,
  "  useEffect(() => {\n    setCounts(buildTeamCounts(teams));\n    // Include pending count summaries so a refreshed team list replaces stale\n    // sidebar state with the backend source of truth.\n  }, [teamSignature]); // eslint-disable-line react-hooks/exhaustive-deps",
  "  useEffect(() => {\n    const affectedTeamIds = new Set(teams.map(({ id }) => id));\n    for (const teamId of reconcileSequence.current.keys()) affectedTeamIds.add(teamId);\n    for (const teamId of affectedTeamIds) {\n      reconcileSequence.current.set(teamId, (reconcileSequence.current.get(teamId) ?? 0) + 1);\n    }\n    setCounts(buildTeamCounts(teams));\n    // Include pending count summaries so a refreshed team list replaces stale\n    // sidebar state with the backend source of truth.\n  }, [teamSignature]); // eslint-disable-line react-hooks/exhaustive-deps",
);
replaceOnce(
  siderTeamBadgesPath,
  "    return removeStack(\n      ipcBridge.conversation.confirmation.add.on((data) => {\n        updateCount(data.conversation_id, +1);\n      }),\n      ipcBridge.conversation.confirmation.remove.on((data) => {\n        updateCount(data.conversation_id, -1);\n      })\n    );",
  [
    "    const reconcileTeam = async (team_id: string): Promise<void> => {",
    "      const sequence = (reconcileSequence.current.get(team_id) ?? 0) + 1;",
    "      reconcileSequence.current.set(team_id, sequence);",
    "      try {",
    "        const projected = await getActestraTeam(team_id);",
    "        if (reconcileSequence.current.get(team_id) !== sequence) return;",
    "        setCounts((prev) => {",
    "          const next = new Map(prev);",
    "          next.set(team_id, buildTeamCounts([projected]).get(team_id) ?? 0);",
    "          return next;",
    "        });",
    "      } catch {",
    "        // Keep the last known count while the authoritative projection is unavailable.",
    "      }",
    "    };",
    "    const applyNativeHint = (conversation_id: string, delta: number): void => {",
    "      const team_id = cidToTeamId.get(conversation_id);",
    "      if (!team_id) return;",
    "      if (providerActive) {",
    "        void reconcileTeam(team_id);",
    "        return;",
    "      }",
    "      updateCount(conversation_id, delta);",
    "    };",
    "",
    "    return removeStack(",
    "      ipcBridge.conversation.confirmation.add.on((data) => {",
    "        applyNativeHint(data.conversation_id, +1);",
    "      }),",
    "      ipcBridge.conversation.confirmation.remove.on((data) => {",
    "        applyNativeHint(data.conversation_id, -1);",
    "      })",
    "    );",
  ].join("\n"),
);

replaceOnce(
  preloadPath,
  `contextBridge.exposeInMainWorld('electronAPI', {`,
  `contextBridge.exposeInMainWorld('actestraTeam', {
  request: (request: AionUiTeamBridgeRequest) =>
    ipcRenderer.invoke(ACTESTRA_TEAM_REQUEST_CHANNEL, request),
  onEvent: (handler: AionUiTeamEventHandler) => {
    const listener = (_event: unknown, value: unknown) => {
      try {
        assertAionUiTeamEvent(value);
      } catch {
        return;
      }
      handler(value);
    };
    ipcRenderer.on(ACTESTRA_TEAM_EVENT_CHANNEL, listener);
    return () => {
      ipcRenderer.off(ACTESTRA_TEAM_EVENT_CHANNEL, listener);
    };
  },
});

contextBridge.exposeInMainWorld('electronAPI', {`,
);

writeNew(
  "packages/desktop/src/process/services/actestraTeamComposition.ts",
  `import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { getDataPath } from '@process/utils';
import type { ActestraPersistencePort, Instant, TeamDefinition } from '@/actestra/core';
import {
  runP8GeneralGooseTeamJourney,
  type P8GeneralGooseTeamJourneyInput,
} from '@/actestra/main/acceptance/p8ProductJourneySmoke';
import type { AionUiTeamBridgeRoute } from '@/actestra/compatibility/aionui/teamBridge';
import {
  AionUiTeamBridgeService,
  registerAionUiTeamBridgeIpc,
} from '@/actestra/main/compatibility/aionuiTeamBridgeService';
import {
  AionCoreProbeProcessGuard,
  AionUiStandardTeamCreationService,
  AionUiTeamService,
  LoopbackAionUiStandardTeamBackend,
  type AionUiTeamModelCatalogPort,
} from '@/actestra/main/compatibility/aionuiTeamService';
import {
  TeamJourneyWorkerRouter,
  type TeamCodingJourneyPort,
  type TeamGeneralWorkJourneyPort,
} from '@/actestra/main/orchestration/teamJourneyWorkerRouter';
import {
  TeamOrchestratorService,
  type TeamResultAggregationPort,
} from '@/actestra/main/orchestration/teamOrchestratorService';
import { TeamPlanAdmissionService, type TeamPlannerPort } from '@/actestra/main/orchestration/teamPlanAdmissionService';
import { TeamWorkspaceGrantContext } from '@/actestra/main/orchestration/teamWorkspaceGrantContext';

export interface ActestraTeamPlannerRuntime extends TeamPlannerPort, TeamResultAggregationPort {
  close(): Promise<void>;
}

export interface ActestraTeamRuntime {
  readonly planner: ActestraTeamPlannerRuntime;
}

export interface ActestraTeamWorkerRuntime {
  readonly general: TeamGeneralWorkJourneyPort;
  readonly coding: TeamCodingJourneyPort;
  close(): Promise<void>;
}

export interface ActestraTeamWorkerRuntimeAdmission {
  admit(team: TeamDefinition): Promise<ActestraTeamWorkerRuntime | null>;
}

export type ActestraTeamModelCatalog = AionUiTeamModelCatalogPort;
export type ActestraTeamModelSelection = NonNullable<TeamDefinition['modelSelection']>;

export interface ActestraTeamCompositionOptions {
  readonly persistence: ActestraPersistencePort;
  readonly modelCatalog: AionUiTeamModelCatalogPort | null;
  readonly workerRuntimeAdmission: ActestraTeamWorkerRuntimeAdmission | null;
  readonly runtime: ActestraTeamRuntime | null;
  readonly now: () => Instant;
}

export type ActestraTeamWorkerReadiness = 'planner-unavailable' | 'worker-runtime-unavailable' | 'ready';

export function deriveActestraTeamWorkerReadiness(input: {
  readonly planner: ActestraTeamPlannerRuntime | null;
  readonly general: TeamGeneralWorkJourneyPort | null;
  readonly coding: TeamCodingJourneyPort | null;
}): ActestraTeamWorkerReadiness {
  if (input.planner === null) return 'planner-unavailable';
  if (input.general === null || input.coding === null) return 'worker-runtime-unavailable';
  return 'ready';
}

export class ActestraTeamComposition {
  readonly #service: AionUiTeamService;
  readonly #standardBackend: LoopbackAionUiStandardTeamBackend;
  readonly #planner: ActestraTeamPlannerRuntime | null;
  readonly #teamRuntimes = new Map<string, Readonly<{
    selectionKey: string;
    orchestrator: TeamOrchestratorService;
    runtime: ActestraTeamWorkerRuntime;
  }>>();
  readonly #pendingAdmissions = new Map<string, Readonly<{
    selectionKey: string;
    admission: Promise<TeamOrchestratorService | null>;
  }>>();
  #disposeIpc: (() => void) | null = null;
  #window: BrowserWindow | null = null;
  #workerRecovery: Promise<number> | null = null;
  #closed = false;

  constructor(private readonly options: ActestraTeamCompositionOptions) {
    const runtimePlanner = options.runtime?.planner ?? null;
    this.#planner = runtimePlanner;
    const admission =
      this.#planner === null
        ? null
        : new TeamPlanAdmissionService({
            planner: this.#planner,
            persistence: options.persistence,
          });
    this.#standardBackend = new LoopbackAionUiStandardTeamBackend({
      probeProcessGuard: new AionCoreProbeProcessGuard({ dataDirectory: getDataPath() }),
    });
    this.#service = new AionUiTeamService({
      persistence: options.persistence,
      admission,
      orchestrator: null,
      modelCatalog: options.modelCatalog,
      workerRuntimeAdmission:
        this.#planner === null || options.workerRuntimeAdmission === null
          ? null
          : { admit: (team) => this.#admitTeamRuntime(team) },
      workspaceSelection: { select: () => this.#selectWorkspace() },
      standardTeamCreation: new AionUiStandardTeamCreationService({
        backend: this.#standardBackend,
      }),
      now: options.now,
      createDigest: () => randomBytes(32).toString('hex'),
    });
  }

  async runP8GeneralGooseTeamJourney(
    input: Pick<P8GeneralGooseTeamJourneyInput, 'workspaceId' | 'providerId' | 'modelId'>,
  ): Promise<void> {
    if (this.#closed) throw new Error('Actestra Team composition is closed');
    await runP8GeneralGooseTeamJourney({
      ...input,
      authority: Object.freeze({
        dispatch: (route: AionUiTeamBridgeRoute) => this.#service.dispatch(route),
      }),
      persistence: this.options.persistence,
    });
  }

  async recoverStandardAuthority(): Promise<number> {
    if (this.#closed) throw new Error('Actestra Team composition is closed');
    return this.#service.recoverStandardTeamMessageDeliveries();
  }

  async waitForWorkerRecovery(): Promise<number> {
    if (this.#closed) throw new Error('Actestra Team composition is closed');
    this.#workerRecovery ??= this.#recoverWorkerRuns();
    return this.#workerRecovery;
  }

  async #recoverWorkerRuns(): Promise<number> {
    if (this.#closed) throw new Error('Actestra Team composition is closed');
    let recoveredCount = 0;
    for (const team of await this.options.persistence.listTeamDefinitions(100)) {
      if (team.experience !== 'orchestrated' || team.modelSelection === undefined) continue;
      const runs = await this.options.persistence.listTeamRunsForTeam(team.teamId, 100);
      if (!runs.some((run) => !['completed', 'failed', 'cancelled'].includes(run.status))) continue;
      const orchestrator = await this.#admitTeamRuntime(team);
      if (orchestrator === null) continue;
      recoveredCount += (await orchestrator.recover(this.options.now(), team.teamId)).length;
    }
    return recoveredCount;
  }

  register(window: BrowserWindow): void {
    if (this.#closed || window.isDestroyed()) return;
    this.#window = window;
    if (this.#disposeIpc === null) {
      this.#disposeIpc = registerAionUiTeamBridgeIpc({
        ipcMain,
        trustedWebContents: () => {
          const trustedWindow = this.#window;
          return trustedWindow === null || trustedWindow.isDestroyed()
            ? null
            : trustedWindow.webContents;
        },
        bridge: new AionUiTeamBridgeService(this.#service),
      });
    }
    window.webContents.once('did-finish-load', () => {
      if (this.#closed || this.#workerRecovery !== null) return;
      const recovery = this.waitForWorkerRecovery();
      this.#workerRecovery = recovery;
      void recovery.then(
        (recoveredRuns) => {
          if (!this.#closed) {
            console.info(
              'ACTESTRA_AIONUI_TEAM_RECOVERY_READY ' + JSON.stringify({ recoveredRuns })
            );
          }
        },
        () => {
          if (!this.#closed) console.warn('ACTESTRA_AIONUI_TEAM_RECOVERY_UNAVAILABLE');
        }
      );
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#disposeIpc?.();
    this.#disposeIpc = null;
    this.#window = null;
    this.#service.close();
    const failures: unknown[] = [];
    try {
      await this.#standardBackend.close();
    } catch (error) {
      failures.push(error);
    }
    const pendingAdmissions = await Promise.allSettled(
      [...this.#pendingAdmissions.values()].map(({ admission }) => admission)
    );
    for (const outcome of pendingAdmissions) {
      if (outcome.status === 'rejected') failures.push(outcome.reason);
    }
    for (const { orchestrator, runtime } of this.#teamRuntimes.values()) {
      try {
        await orchestrator.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await runtime.close();
      } catch (error) {
        failures.push(error);
      }
    }
    this.#teamRuntimes.clear();
    try {
      await this.#planner?.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Actestra Team composition shutdown failed');
    }
  }

  async #admitTeamRuntime(team: TeamDefinition): Promise<TeamOrchestratorService | null> {
    if (
      this.#closed ||
      this.#planner === null ||
      this.options.workerRuntimeAdmission === null ||
      team.modelSelection === undefined
    ) {
      return null;
    }
    const teamKey = team.teamId;
    const selectionKey = team.modelSelection.providerId + '\\u0000' + team.modelSelection.modelId;
    const existing = this.#teamRuntimes.get(teamKey);
    if (existing !== undefined) {
      if (existing.selectionKey === selectionKey) return existing.orchestrator;
      await this.#closeTeamRuntime(teamKey, existing);
    }
    const pending = this.#pendingAdmissions.get(teamKey);
    if (pending !== undefined) {
      if (pending.selectionKey === selectionKey) return pending.admission;
      await pending.admission.catch((): undefined => undefined);
      const stale = this.#teamRuntimes.get(teamKey);
      if (stale !== undefined && stale.selectionKey !== selectionKey) {
        await this.#closeTeamRuntime(teamKey, stale);
      }
      return this.#admitTeamRuntime(team);
    }
    const admission = this.#createTeamRuntime(team, selectionKey);
    const pendingAdmission = Object.freeze({ selectionKey, admission });
    this.#pendingAdmissions.set(teamKey, pendingAdmission);
    try {
      return await admission;
    } finally {
      if (this.#pendingAdmissions.get(teamKey) === pendingAdmission) {
        this.#pendingAdmissions.delete(teamKey);
      }
    }
  }

  async #closeTeamRuntime(
    teamKey: string,
    expected: Readonly<{
      selectionKey: string;
      orchestrator: TeamOrchestratorService;
      runtime: ActestraTeamWorkerRuntime;
    }>,
  ): Promise<void> {
    if (this.#teamRuntimes.get(teamKey) !== expected) return;
    this.#teamRuntimes.delete(teamKey);
    const failures: unknown[] = [];
    try {
      await expected.orchestrator.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await expected.runtime.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Actestra Team runtime replacement failed');
    }
  }

  async #createTeamRuntime(
    team: TeamDefinition,
    selectionKey: string,
  ): Promise<TeamOrchestratorService | null> {
    const runtime = await this.options.workerRuntimeAdmission!.admit(team);
    if (this.#closed && runtime !== null) {
      await runtime.close().catch((): undefined => undefined);
      return null;
    }
    if (
      runtime === null ||
      deriveActestraTeamWorkerReadiness({
        planner: this.#planner,
        general: runtime.general,
        coding: runtime.coding,
      }) !== 'ready'
    ) {
      return null;
    }
    try {
      const worker = new TeamJourneyWorkerRouter({
        persistence: this.options.persistence,
        workspaceContext: new TeamWorkspaceGrantContext({ persistence: this.options.persistence }),
        general: runtime.general,
        coding: runtime.coding,
      });
      const orchestrator = new TeamOrchestratorService({
        persistence: this.options.persistence,
        worker,
        aggregator: this.#planner!,
        now: this.options.now,
      });
      this.#teamRuntimes.set(team.teamId, Object.freeze({ selectionKey, orchestrator, runtime }));
      return orchestrator;
    } catch {
      await runtime.close().catch((): undefined => undefined);
      return null;
    }
  }

  async #selectWorkspace(): Promise<Readonly<{ rootPath: string; displayName: string }> | null> {
    const window = this.#window;
    if (window === null || window.isDestroyed()) {
      throw new Error('Actestra Team workspace selection requires the active main window');
    }
    const selected = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    const selectedPath = selected.filePaths[0];
    if (selected.canceled || selectedPath === undefined) return null;
    const rootPath = await realpath(selectedPath);
    if (rootPath === path.parse(rootPath).root) {
      throw new Error('Actestra Team workspace cannot be a filesystem root');
    }
    return Object.freeze({ rootPath, displayName: path.basename(rootPath) });
  }
}
`,
);

const shadowBridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  shadowBridgePath,
  `import type { TrustedActestraCodingJourneyRuntime } from '@/actestra/main/workers/actestraCodingJourneyRuntime';`,
  `import type { TrustedActestraCodingJourneyRuntime } from '@/actestra/main/workers/actestraCodingJourneyRuntime';
import type { TrustedActestraGeneralWorkRuntime } from '@/actestra/main/workers/actestraGeneralWorkRuntime';`,
);

replaceOnce(
  shadowBridgePath,
  `import {
  resolveActestraGeneralWorkSmokeConfig,`,
  `import {
  ActestraTeamComposition,
  type ActestraTeamModelCatalog,
  type ActestraTeamModelSelection,
  type ActestraTeamRuntime,
  type ActestraTeamWorkerRuntime,
} from './actestraTeamComposition';
import {
  resolveActestraGeneralWorkSmokeConfig,`,
);

replaceOnce(
  shadowBridgePath,
  `let scheduleService: AionUiScheduleService | null = null;
let disposeScheduleBridgeIpc: (() => void) | null = null;`,
  `let scheduleService: AionUiScheduleService | null = null;
let generalWorkRuntime: TrustedActestraGeneralWorkRuntime | null = null;
let teamComposition: ActestraTeamComposition | null = null;
let teamRuntime: ActestraTeamRuntime | null = null;
let teamWorkerRuntimeAdmission: TrustedActestraTeamWorkerRuntimeAdmission | null = null;
let disposeScheduleBridgeIpc: (() => void) | null = null;`,
);

replaceOnce(
  shadowBridgePath,
  `export function configureActestraCodingJourneyRuntime(
  runtime: TrustedActestraCodingJourneyRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra coding journey runtime must be injected before persistence startup');
  }
  codingJourneyRuntime = runtime;
}`,
  `export function configureActestraCodingJourneyRuntime(
  runtime: TrustedActestraCodingJourneyRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra coding journey runtime must be injected before persistence startup');
  }
  codingJourneyRuntime = runtime;
}

export function configureActestraGeneralWorkRuntime(
  runtime: TrustedActestraGeneralWorkRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra General Work runtime must be injected before persistence startup');
  }
  generalWorkRuntime = runtime;
}

export interface TrustedActestraTeamWorkerRuntime {
  readonly general: TrustedActestraGeneralWorkRuntime;
  readonly coding: TrustedActestraCodingJourneyRuntime;
}

export interface TrustedActestraTeamWorkerRuntimeAdmission {
  readonly modelCatalog: ActestraTeamModelCatalog;
  admit(selection: ActestraTeamModelSelection): Promise<TrustedActestraTeamWorkerRuntime | null>;
}

export function configureActestraTeamWorkerRuntimeAdmission(
  admission: TrustedActestraTeamWorkerRuntimeAdmission | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra Team Worker runtime admission must be injected before persistence startup');
  }
  teamWorkerRuntimeAdmission = admission;
}

export function configureActestraTeamRuntime(runtime: ActestraTeamRuntime | null): void {
  if (persistence !== null) {
    throw new Error('Actestra Team runtime must be injected before persistence startup');
  }
  teamRuntime = runtime;
}`,
);

replaceOnce(
  shadowBridgePath,
  `  const journey = new AionUiGeneralWorkJourneyService({`,
  `  const createGeneralWorkJourney = (modelRuntime: TrustedActestraGeneralWorkRuntime | null) =>
    new AionUiGeneralWorkJourneyService({`,
);

replaceOnce(
  shadowBridgePath,
  `      const requestIds =
        journeyKind === 'workspace-file-artifact' ||`,
  `      if (generalWorkSmokeConfig === null && modelRuntime === null) {
        throw new Error('Actestra General Work model runtime is unavailable');
      }
      const requestIds =
        journeyKind === 'workspace-file-artifact' ||`,
);

replaceOnce(
  shadowBridgePath,
  `          executionMode:
            generalWorkSmokeConfig?.scenario === 'cancellation' ||
            generalWorkSmokeConfig?.scenario === 'prepare-worker-crash'
              ? 'hold'
              : journeyKind === 'office-document-artifact'
                ? 'office-document-artifact-fixture'
              : journeyKind === 'writing-artifact'
                ? 'writing-artifact-fixture'
              : journeyKind === 'local-research-artifact'
                ? 'local-research-artifact-fixture'
                : journeyKind === 'workspace-file-artifact'
                  ? 'workspace-read-then-task-output-write-fixture'
                  : 'task-output-write-text-fixture',`,
  `          executionMode:
            modelRuntime !== null
              ? 'model-writing-artifact'
              : generalWorkSmokeConfig === null
                ? 'model-writing-artifact'
                : generalWorkSmokeConfig.scenario === 'cancellation' ||
                  generalWorkSmokeConfig.scenario === 'prepare-worker-crash'
                ? 'hold'
                : journeyKind === 'office-document-artifact'
                  ? 'office-document-artifact-fixture'
                : journeyKind === 'writing-artifact'
                  ? 'writing-artifact-fixture'
                : journeyKind === 'local-research-artifact'
                  ? 'local-research-artifact-fixture'
                  : journeyKind === 'workspace-file-artifact'
                    ? 'workspace-read-then-task-output-write-fixture'
                    : 'task-output-write-text-fixture',
          ...(modelRuntime !== null
            ? { modelRuntime: modelRuntime! }
            : {}),`,
);

replaceOnce(
  shadowBridgePath,
  `  generalWorkJourneyService = journey;
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(journey);
  const scheduleClock = new SystemAionUiScheduleClock();`,
  `  const journey = createGeneralWorkJourney(generalWorkRuntime);
  generalWorkJourneyService = journey;
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(journey);
  teamComposition = new ActestraTeamComposition({
    persistence: activePersistence,
    modelCatalog: teamWorkerRuntimeAdmission?.modelCatalog ?? null,
    workerRuntimeAdmission:
      teamWorkerRuntimeAdmission === null
        ? null
        : {
            admit: async (team): Promise<ActestraTeamWorkerRuntime | null> => {
              if (team.modelSelection === undefined) return null;
              const trustedRuntime = await teamWorkerRuntimeAdmission!.admit(team.modelSelection);
              if (trustedRuntime === null) return null;
              const general = createGeneralWorkJourney(trustedRuntime.general);
              const codingAgent = new AionUiCodingAgentService({
                getMainService: () => isolatedCodingMainService,
                runnerAdmission: trustedRuntime.coding.runnerAdmission,
                admittedArtifact: trustedRuntime.coding.admittedArtifact,
                revalidateArtifact: trustedRuntime.coding.revalidateArtifact,
              });
              const coding = new AionUiCodingJourneyService({
                persistence: activePersistence,
                clock: platform.clock,
                nativeContext,
                codingAgent,
                getMainService: () => isolatedCodingMainService,
                privateRootParent: trustedRuntime.coding.privateRootParent,
                modelId: trustedRuntime.coding.modelId,
                modelInvoker: trustedRuntime.coding.modelInvoker,
                commands: trustedRuntime.coding.commands,
                tests: trustedRuntime.coding.tests,
              });
              await coding.recoverArtifactDeliveries();
              return Object.freeze({
                general,
                coding,
                close: async () => {
                  const outcomes = await Promise.allSettled([general.close(), coding.close()]);
                  const failures = outcomes.flatMap((outcome) =>
                    outcome.status === 'rejected' ? [outcome.reason] : []
                  );
                  if (failures.length > 0) {
                    throw new AggregateError(failures, 'Actestra Team Worker runtime shutdown failed');
                  }
                },
              });
            },
          },
    runtime: teamRuntime,
    now: () => platform.clock.now(),
  });
  const scheduleClock = new SystemAionUiScheduleClock();`,
);

replaceOnce(
  shadowBridgePath,
  `    await scheduleService.recover();
    scheduleRecovered = true;
    registerRecoveredScheduleBridge();`,
  `    await scheduleService.recover();
    scheduleRecovered = true;
    await teamComposition.recoverStandardAuthority();
    registerRecoveredScheduleBridge();
    registerRecoveredTeamBridge();`,
);

replaceOnce(
  shadowBridgePath,
  `  } catch {
    await isolatedCodingMainService?.close().catch((): undefined => undefined);`,
  `  } catch {
    const failedTeamComposition = teamComposition;
    const failedTeamRuntime = teamRuntime;
    await failedTeamComposition?.close().catch((): undefined => undefined);
    if (failedTeamComposition === null) {
      await failedTeamRuntime?.planner.close().catch((): undefined => undefined);
    }
    teamComposition = null;
    teamRuntime = null;
    await isolatedCodingMainService?.close().catch((): undefined => undefined);`,
);

replaceOnce(
  shadowBridgePath,
  `export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
  `function registerRecoveredTeamBridge(): void {
  const activeWindow = currentWindow;
  if (activeWindow === null || activeWindow.isDestroyed()) return;
  teamComposition?.register(activeWindow);
}

export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
);

replaceOnce(
  shadowBridgePath,
  `  registerRecoveredScheduleBridge();
  // Recovery needs the native backend`,
  `  registerRecoveredScheduleBridge();
  registerRecoveredTeamBridge();
  // Recovery needs the native backend`,
);

replaceOnce(
  shadowBridgePath,
  `  const activeSchedule = scheduleService;
  const activeGeneralWork = generalWorkJourneyService;`,
  `  const activeSchedule = scheduleService;
  const activeTeam = teamComposition;
  const activeTeamRuntime = teamRuntime;
  const activeGeneralWork = generalWorkJourneyService;`,
);

replaceOnce(
  shadowBridgePath,
  `  scheduleService = null;
  disposeScheduleBridgeIpc = null;`,
  `  scheduleService = null;
  teamComposition = null;
  teamRuntime = null;
  disposeScheduleBridgeIpc = null;`,
);

replaceOnce(
  shadowBridgePath,
  `  disposeScheduleBridge?.();
  let codingJourneyCloseError: unknown;`,
  `  disposeScheduleBridge?.();
  let teamCloseError: unknown;
  try {
    await activeTeam?.close();
  } catch (error) {
    teamCloseError = error;
  }
  if (activeTeam === null) {
    try {
      await activeTeamRuntime?.planner.close();
    } catch (error) {
      teamCloseError = error;
    }
  }
  let codingJourneyCloseError: unknown;`,
);

replaceOnce(
  shadowBridgePath,
  `  if (
    codingJourneyCloseError !== undefined ||
    codingArtifactCloseError !== undefined ||
    isolatedCodingCloseFailed
  ) {
    throw new AggregateError(
      [codingJourneyCloseError, codingArtifactCloseError, isolatedCodingCloseError].filter(`,
  `  if (
    teamCloseError !== undefined ||
    codingJourneyCloseError !== undefined ||
    codingArtifactCloseError !== undefined ||
    isolatedCodingCloseFailed
  ) {
    throw new AggregateError(
      [teamCloseError, codingJourneyCloseError, codingArtifactCloseError, isolatedCodingCloseError].filter(`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraTeamClient.ts",
  `import {
  AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
  ACTESTRA_TEAM_LOCAL_USER_ID,
  assertAionUiTeamBridgeResponse,
  type AionUiTeamBridgeMethod,
  type AionUiTeamEvent,
  type NativeAionUiStandardTeam,
  type NativeAionUiStandardTeamMemberAck,
  type NativeAionUiStandardTeamRunAck,
  type NativeAionUiStandardTeamRunState,
  type NativeAionUiTeam,
  type NativeAionUiTeamConfigOptions,
  type NativeAionUiTeamModelOptions,
  type NativeAionUiTeamModelSelection,
  type NativeAionUiTeamRunAck,
  type NativeAionUiTeamRunState,
  type NativeAionUiTeamWorkspaceOption,
  type NativeAionUiTeamWorkspaceOptions,
} from '@/actestra/compatibility/aionui/teamBridge';
import type { ITeamRunAck, ITeamRunStateResponse, TeamAssistant, TTeam } from '@/common/types/team/teamTypes';
import type { GetConfigOptionsResponse } from '@/common/types/platform/acpTypes';
import { BackendHttpError } from './httpBridge';
import {
  fromBackendAssistant,
  fromBackendTeam,
  fromBackendTeamList,
  toBackendAssistant,
  type IAddTeamAssistantParams,
  type ICreateTeamParams,
  type TeamAssistantInput,
} from './teamMapper';

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function isActestraTeamProviderActive(): boolean {
  return typeof window !== 'undefined' && window.actestraTeam !== undefined;
}

function unavailable(method: string, path: string): BackendHttpError {
  return new BackendHttpError({
    method,
    path,
    status: 503,
    body: { success: false, error: 'Actestra Team work is unavailable', code: 'team-unavailable' },
  });
}

async function requestActestraTeam<Data>(method: AionUiTeamBridgeMethod, path: string, body?: unknown): Promise<Data> {
  if (!isActestraTeamProviderActive()) throw unavailable(method, path);
  let response: unknown;
  try {
    response = await window.actestraTeam!.request({
      contractVersion: AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
      method,
      path,
      body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
    });
    assertAionUiTeamBridgeResponse(response);
  } catch {
    throw unavailable(method, path);
  }
  if (response.status !== 200) {
    throw new BackendHttpError({
      method,
      path,
      status: response.status,
      body: { success: false, error: response.message, code: response.code },
    });
  }
  return response.data as Data;
}

export async function listActestraTeams(): Promise<TTeam[]> {
  const teams = await requestActestraTeam<readonly NativeAionUiTeam[]>(
    'GET',
    '/api/teams?user_id=' + encodeURIComponent(ACTESTRA_TEAM_LOCAL_USER_ID)
  );
  return fromBackendTeamList(teams);
}

export async function getActestraTeam(teamId: string): Promise<TTeam> {
  return fromBackendTeam(await requestActestraTeam<NativeAionUiTeam>('GET', '/api/teams/' + segment(teamId)));
}

export function isActestraTeamUnavailableError(error: unknown): boolean {
  return error instanceof BackendHttpError && error.code === 'team-unavailable';
}

function toStandardMemberIntent(agent: TeamAssistantInput): Record<string, unknown> {
  if (!agent.assistant_id) throw new Error('assistant_id is required');
  return {
    name: agent.assistant_name,
    role: agent.role === 'leader' ? 'lead' : 'teammate',
    assistant_id: agent.assistant_id,
    requested_model: agent.model?.trim() || null,
  };
}

export async function createStandardTeam(input: ICreateTeamParams): Promise<TTeam> {
  return fromBackendTeam(
    await requestActestraTeam<NativeAionUiStandardTeam>('POST', '/api/teams', {
      experience: 'standard',
      user_id: input.user_id,
      name: input.name,
      workspace: input.workspace,
      workspace_mode: 'shared',
      agents: input.agents.map(toStandardMemberIntent),
    })
  );
}

export async function addStandardTeamMember(input: IAddTeamAssistantParams): Promise<TeamAssistant> {
  const result = await requestActestraTeam<NativeAionUiStandardTeamMemberAck>(
    'POST',
    '/api/teams/' + segment(input.team_id) + '/agents',
    { experience: 'standard', assistant: toStandardMemberIntent(input.assistant) }
  );
  return fromBackendAssistant(result.assistant);
}

export async function renameStandardTeamMember(teamId: string, slotId: string, name: string): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeam>(
    'PATCH',
    '/api/teams/' + segment(teamId) + '/agents/' + segment(slotId) + '/name',
    { name }
  );
}

export async function removeStandardTeamMember(teamId: string, slotId: string): Promise<void> {
  await requestActestraTeam<null>('DELETE', '/api/teams/' + segment(teamId) + '/agents/' + segment(slotId));
}

export async function ensureActestraTeamSession(teamId: string): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeam | NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(teamId) + '/session'
  );
}

function fromBackendConfigOptions(result: NativeAionUiTeamConfigOptions): GetConfigOptionsResponse {
  return {
    config_options: result.config_options.map((option) => ({
      id: option.id,
      name: option.name,
      category: option.category,
      type: option.type,
      current_value: option.current_value,
      options: option.options.map((choice) => ({
        value: choice.value,
        name: choice.name,
        description: choice.description,
      })),
    })),
  };
}

export async function getStandardTeamConfigOptions(
  teamId: string,
  conversationId: string
): Promise<GetConfigOptionsResponse> {
  const result = await requestActestraTeam<NativeAionUiTeamConfigOptions>(
    'GET',
    '/api/teams/' + segment(teamId) + '/conversations/' + segment(conversationId) + '/config-options'
  );
  return fromBackendConfigOptions(result);
}

export async function setStandardTeamConfigOption(
  teamId: string,
  conversationId: string,
  optionId: string,
  value: string
): Promise<GetConfigOptionsResponse> {
  const result = await requestActestraTeam<NativeAionUiTeamConfigOptions>(
    'PUT',
    '/api/teams/' +
      segment(teamId) +
      '/conversations/' +
      segment(conversationId) +
      '/config-options/' +
      segment(optionId),
    { value }
  );
  return fromBackendConfigOptions(result);
}

export async function setStandardTeamSessionMode(
  teamId: string,
  leaderConversationId: string,
  mode: string
): Promise<TTeam> {
  return fromBackendTeam(
    await requestActestraTeam<NativeAionUiStandardTeam>('POST', '/api/teams/' + segment(teamId) + '/session-mode', {
      conversation_id: leaderConversationId,
      mode,
    })
  );
}

export async function renameStandardTeam(teamId: string, name: string): Promise<TTeam> {
  return fromBackendTeam(
    await requestActestraTeam<NativeAionUiStandardTeam>('PATCH', '/api/teams/' + segment(teamId) + '/name', { name })
  );
}

export async function removeStandardTeam(teamId: string): Promise<void> {
  await requestActestraTeam<null>('DELETE', '/api/teams/' + segment(teamId));
}

function fromStandardTeamRunAck(result: NativeAionUiStandardTeamRunAck): ITeamRunAck {
  return {
    enqueue_status: result.enqueue_status,
    message_id: result.message_id,
    run: result.run as ITeamRunAck['run'],
  };
}

export async function sendStandardTeamMessage(input: {
  teamId: string;
  content: string;
  files: string[];
  requestNonce: string;
}): Promise<ITeamRunAck> {
  return fromStandardTeamRunAck(
    await requestActestraTeam<NativeAionUiStandardTeamRunAck>(
      'POST',
      '/api/teams/' + segment(input.teamId) + '/messages',
      { content: input.content, files: input.files, request_nonce: input.requestNonce }
    )
  );
}

export async function sendStandardTeamMemberMessage(input: {
  teamId: string;
  slotId: string;
  content: string;
  files: string[];
  requestNonce: string;
}): Promise<ITeamRunAck> {
  return fromStandardTeamRunAck(
    await requestActestraTeam<NativeAionUiStandardTeamRunAck>(
      'POST',
      '/api/teams/' + segment(input.teamId) + '/agents/' + segment(input.slotId) + '/messages',
      { content: input.content, files: input.files, request_nonce: input.requestNonce }
    )
  );
}

export async function getStandardTeamRunState(teamId: string): Promise<ITeamRunStateResponse> {
  const result = await requestActestraTeam<NativeAionUiStandardTeamRunState>(
    'GET',
    '/api/teams/' + segment(teamId) + '/run-state'
  );
  return {
    session_generation: result.session_generation,
    active_run: result.active_run as ITeamRunStateResponse['active_run'],
    slot_work: result.slot_work as ITeamRunStateResponse['slot_work'],
  };
}

export async function cancelStandardTeamMemberWork(input: {
  teamId: string;
  runId: string;
  slotId: string;
  reason: string;
}): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeamRunState>(
    'POST',
    '/api/teams/' +
      segment(input.teamId) +
      '/runs/' +
      segment(input.runId) +
      '/agents/' +
      segment(input.slotId) +
      '/cancel',
    { reason: input.reason }
  );
}

export async function pauseStandardTeamMemberWork(input: {
  teamId: string;
  runId: string;
  slotId: string;
  reason: string;
}): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeamRunState>(
    'POST',
    '/api/teams/' +
      segment(input.teamId) +
      '/runs/' +
      segment(input.runId) +
      '/agents/' +
      segment(input.slotId) +
      '/pause',
    { reason: input.reason }
  );
}

export async function attachStandardTeamMember(input: { teamId: string; slotId: string }): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeam>(
    'POST',
    '/api/teams/' + segment(input.teamId) + '/agents/' + segment(input.slotId) + '/attach'
  );
}

export async function createActestraTeam(
  input: ICreateTeamParams & { modelSelection: { providerId: string; modelId: string } }
): Promise<TTeam> {
  return fromBackendTeam(
    await requestActestraTeam<NativeAionUiTeam>('POST', '/api/teams', {
      experience: 'orchestrated',
      name: input.name,
      description: input.description?.trim() || null,
      agents: input.agents.map(toBackendAssistant),
      workspace: input.workspace,
      model_selection: {
        provider_id: input.modelSelection.providerId,
        model_id: input.modelSelection.modelId,
      },
    })
  );
}

export function listActestraTeamModelOptions(): Promise<NativeAionUiTeamModelOptions> {
  return requestActestraTeam<NativeAionUiTeamModelOptions>('GET', '/api/teams/model-options');
}

export function getActestraTeamModelSelection(
  teamId: string
): Promise<NativeAionUiTeamModelSelection> {
  return requestActestraTeam<NativeAionUiTeamModelSelection>(
    'GET',
    '/api/teams/' + segment(teamId) + '/model-selection'
  );
}

export function updateActestraTeamModelSelection(input: {
  teamId: string;
  providerId: string;
  modelId: string;
}): Promise<NativeAionUiTeamModelSelection> {
  return requestActestraTeam<NativeAionUiTeamModelSelection>(
    'PATCH',
    '/api/teams/' + segment(input.teamId) + '/model-selection',
    { provider_id: input.providerId, model_id: input.modelId }
  );
}

export function listActestraTeamWorkspaceOptions(): Promise<NativeAionUiTeamWorkspaceOptions> {
  return requestActestraTeam<NativeAionUiTeamWorkspaceOptions>('GET', '/api/teams/workspace-options');
}

export function selectActestraTeamWorkspace(): Promise<NativeAionUiTeamWorkspaceOption | null> {
  return requestActestraTeam<NativeAionUiTeamWorkspaceOption | null>('POST', '/api/teams/workspace-options/select');
}

export async function renameActestraTeam(teamId: string, name: string): Promise<void> {
  await requestActestraTeam<NativeAionUiTeam>('PATCH', '/api/teams/' + segment(teamId) + '/name', { name });
}

export async function removeActestraTeam(teamId: string): Promise<void> {
  await requestActestraTeam<null>('DELETE', '/api/teams/' + segment(teamId));
}

export function isActestraTeamDefinition(team: TTeam): boolean {
  return team.experience === 'orchestrated';
}

export function subscribeActestraTeamEvents(handler: (event: AionUiTeamEvent) => void): () => void {
  if (!isActestraTeamProviderActive()) return () => {};
  return window.actestraTeam!.onEvent(handler);
}

export function getActestraTeamRunState(teamId: string): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>('GET', '/api/teams/' + segment(teamId) + '/run-state');
}

export function submitActestraTeamTask(teamId: string, content: string): Promise<NativeAionUiTeamRunAck> {
  const requestNonce =
    'team-request-' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
  return requestActestraTeam<NativeAionUiTeamRunAck>('POST', '/api/teams/' + segment(teamId) + '/messages', {
    content,
    request_nonce: requestNonce,
  });
}

export type ActestraTeamNodeAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'replace' | 'handoff' | 'revise';

export function controlActestraTeamNode(input: {
  teamId: string;
  runId: string;
  slotId: string;
  action: ActestraTeamNodeAction;
  reason: string;
}): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' +
      segment(input.teamId) +
      '/runs/' +
      segment(input.runId) +
      '/agents/' +
      segment(input.slotId) +
      '/' +
      input.action,
    { reason: input.reason }
  );
}

export function decideActestraTeamApproval(input: {
  teamId: string;
  runId: string;
  slotId: string;
  decision: 'approved' | 'denied';
}): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' +
      segment(input.teamId) +
      '/runs/' +
      segment(input.runId) +
      '/agents/' +
      segment(input.slotId) +
      '/approval',
    { decision: input.decision }
  );
}

export function resolveActestraTeamFeedback(input: {
  teamId: string;
  runId: string;
  decision: 'approved' | 'denied';
  note: string;
}): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(input.teamId) + '/runs/' + segment(input.runId) + '/feedback',
    { decision: input.decision, note: input.note }
  );
}

export function completeActestraTeamHandoff(input: {
  teamId: string;
  runId: string;
  slotId: string;
  content: string;
}): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' +
      segment(input.teamId) +
      '/runs/' +
      segment(input.runId) +
      '/agents/' +
      segment(input.slotId) +
      '/handoff-completion',
    { content: input.content }
  );
}

export function cancelActestraTeamRun(
  teamId: string,
  runId: string,
  reason: string
): Promise<NativeAionUiTeamRunState> {
  return requestActestraTeam<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(teamId) + '/runs/' + segment(runId) + '/cancel',
    { reason }
  );
}
`,
);

const teamPermissionContextPath =
  "packages/desktop/src/renderer/pages/team/hooks/TeamPermissionContext.tsx";
const teamConfigOptionsPath = "packages/desktop/src/renderer/pages/team/hooks/teamConfigOptions.ts";
replaceOnce(
  teamConfigOptionsPath,
  `type TeamConfigOptionsLoad = (conversation_id: string) => Promise<AcpConfigOptionDto[] | null>;

export type TeamConfigOptionsLoader = TeamConfigOptionsLoad & {`,
  `type TeamConfigOptionsLoad = (conversation_id: string) => Promise<AcpConfigOptionDto[] | null>;
type TeamConfigOptionsSet = (conversation_id: string, optionId: string, value: string) => Promise<AcpConfigOptionDto[]>;

export type TeamConfigOptionsLoader = TeamConfigOptionsLoad & {`,
);
replaceOnce(
  teamConfigOptionsPath,
  `  load: TeamConfigOptionsLoad;
  warmup: () => Promise<void>;
};`,
  `  load: TeamConfigOptionsLoad;
  warmup: () => Promise<void>;
  setConfigOption: TeamConfigOptionsSet;
};`,
);
replaceOnce(
  teamConfigOptionsPath,
  `  getConfigOptions: (team_id: string, conversation_id: string) => Promise<GetConfigOptionsResponse>;
};`,
  `  getConfigOptions: (team_id: string, conversation_id: string) => Promise<GetConfigOptionsResponse>;
  setConfigOption: (team_id: string, conversation_id: string, optionId: string, value: string) => Promise<GetConfigOptionsResponse>;
};`,
);
replaceOnce(
  teamConfigOptionsPath,
  `  getConfigOptions,
}: CreateTeamConfigOptionsLoaderArgs): TeamConfigOptionsLoader {`,
  `  getConfigOptions,
  setConfigOption: setConfigOptionThroughTeam,
}: CreateTeamConfigOptionsLoaderArgs): TeamConfigOptionsLoader {`,
);
replaceOnce(
  teamConfigOptionsPath,
  `  return Object.assign(load, { load, warmup });`,
  `  const setConfigOption: TeamConfigOptionsSet = async (conversation_id, optionId, value) =>
    (await setConfigOptionThroughTeam(team_id, conversation_id, optionId, value)).config_options;

  return Object.assign(load, { load, warmup, setConfigOption });`,
);
replaceOnce(
  teamPermissionContextPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import {
  ensureActestraTeamSession,
  getStandardTeamConfigOptions,
  isActestraTeamProviderActive,
  setStandardTeamConfigOption,
  setStandardTeamSessionMode,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamPermissionContextPath,
  `  propagateMode: (mode: string) => void;`,
  `  propagateMode: (mode: string) => Promise<void>;`,
);
const legacyTeamSessionModeCall = [
  "ipcBridge.team.setSession",
  "Mode.invoke({ team_id, session_mode: mode })",
].join("");
replaceOnce(
  teamPermissionContextPath,
  `  const propagateMode = useCallback(
    (mode: string) => {
      // Persist session_mode on the team record so newly spawned agents inherit it
      void ${legacyTeamSessionModeCall}.catch(() => {
        // Best-effort: if this fails, active agents still receive per-conversation config updates.
      });
    },
    [team_id]
  );`,
  `  const propagateMode = useCallback(
    async (mode: string): Promise<void> => {
      if (isActestraTeamProviderActive()) {
        await setStandardTeamSessionMode(team_id, leaderConversationId, mode);
        return;
      }
      await ipcBridge.team.setSessionMode.invoke({ team_id, session_mode: mode });
    },
    [leaderConversationId, team_id]
  );`,
);
replaceOnce(
  teamPermissionContextPath,
  `        getConfigOptions: (targetTeamId, conversation_id) =>
          ipcBridge.team.getConfigOptions.invoke({ team_id: targetTeamId, conversation_id }),`,
  `        getConfigOptions: (targetTeamId, conversation_id) =>
          isActestraTeamProviderActive()
            ? getStandardTeamConfigOptions(targetTeamId, conversation_id)
            : ipcBridge.team.getConfigOptions.invoke({ team_id: targetTeamId, conversation_id }),
        setConfigOption: (targetTeamId, conversation_id, optionId, value) =>
          setStandardTeamConfigOption(targetTeamId, conversation_id, optionId, value),`,
);
replaceOnce(
  teamPermissionContextPath,
  `  loadConfigOptions: TeamConfigOptionsLoader;
};`,
  `  loadConfigOptions: TeamConfigOptionsLoader;
  setConfigOption?: TeamConfigOptionsLoader['setConfigOption'];
};`,
);
replaceOnce(
  teamPermissionContextPath,
  `      warmupSession,
      loadConfigOptions,
    }),`,
  `      warmupSession,
      loadConfigOptions,
      setConfigOption: isActestraTeamProviderActive() ? loadConfigOptions.setConfigOption : undefined,
    }),`,
);
replaceOnce(
  teamPermissionContextPath,
  `    const promise = ipcBridge.team.ensureSession.invoke({ team_id });`,
  `    const promise = isActestraTeamProviderActive()
      ? ensureActestraTeamSession(team_id)
      : ipcBridge.team.ensureSession.invoke({ team_id });`,
);

const useTeamWarmupPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamWarmup.ts";
replaceOnce(
  useTeamWarmupPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import { ensureActestraTeamSession, isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  useTeamWarmupPath,
  `    ipcBridge.team.ensureSession
      .invoke({ team_id })`,
  `    (isActestraTeamProviderActive()
      ? ensureActestraTeamSession(team_id)
      : ipcBridge.team.ensureSession.invoke({ team_id })
    )`,
);

const useTeamWarmupDomTestPath = "tests/unit/renderer/team/useTeamWarmup.dom.test.tsx";
replaceOnce(
  useTeamWarmupDomTestPath,
  `const ensureSessionMock = vi.fn();`,
  `const ensureSessionMock = vi.fn();
const ensureProjectedSessionMock = vi.fn();
let providerActive = false;`,
);
replaceOnce(
  useTeamWarmupDomTestPath,
  `import { useTeamWarmup } from '@/renderer/pages/team/hooks/useTeamWarmup';`,
  `vi.mock('@/common/adapter/actestraTeamClient', () => ({
  ensureActestraTeamSession: (...args: unknown[]) => ensureProjectedSessionMock(...args),
  isActestraTeamProviderActive: () => providerActive,
}));

import { useTeamWarmup } from '@/renderer/pages/team/hooks/useTeamWarmup';`,
);
replaceOnce(
  useTeamWarmupDomTestPath,
  `  beforeEach(() => {
    ensureSessionMock.mockReset();`,
  `  beforeEach(() => {
    ensureSessionMock.mockReset();
    ensureProjectedSessionMock.mockReset();
    providerActive = false;`,
);
replaceOnce(
  useTeamWarmupDomTestPath,
  `  it('goes to error when the team session fails to start', async () => {`,
  `  it('routes provider-active warmup through the Main/Core Team projection', async () => {
    providerActive = true;
    ensureProjectedSessionMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamWarmup('team-provider-owned'));

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(ensureProjectedSessionMock).toHaveBeenCalledWith('team-provider-owned');
    expect(ensureSessionMock).not.toHaveBeenCalled();
  });

  it('goes to error when the team session fails to start', async () => {`,
);

writeNew(
  "tests/unit/renderer/team/TeamPermissionContext.dom.test.tsx",
  `/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureNativeSessionMock = vi.fn();
const ensureProjectedSessionMock = vi.fn();
const getNativeConfigOptionsMock = vi.fn();
const getProjectedConfigOptionsMock = vi.fn();
const setNativeSessionModeMock = vi.fn();
const setProjectedSessionModeMock = vi.fn();
let providerActive = false;

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: (...args: unknown[]) => ensureNativeSessionMock(...args) },
      getConfigOptions: { invoke: (...args: unknown[]) => getNativeConfigOptionsMock(...args) },
      setSessionMode: { invoke: (...args: unknown[]) => setNativeSessionModeMock(...args) },
    },
  },
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  ensureActestraTeamSession: (...args: unknown[]) => ensureProjectedSessionMock(...args),
  getStandardTeamConfigOptions: (...args: unknown[]) => getProjectedConfigOptionsMock(...args),
  isActestraTeamProviderActive: () => providerActive,
  setStandardTeamConfigOption: vi.fn(),
  setStandardTeamSessionMode: (...args: unknown[]) => setProjectedSessionModeMock(...args),
}));

import { TeamPermissionProvider, useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';

const wrapper = ({ children }: PropsWithChildren) => (
  <TeamPermissionProvider
    team_id='team-main-owned'
    isLeaderAgent
    leaderConversationId='conversation-leader'
    allConversationIds={['conversation-leader', 'conversation-member']}
  >
    {children}
  </TeamPermissionProvider>
);

describe('TeamPermissionContext warmup authority', () => {
  beforeEach(() => {
    providerActive = false;
    ensureNativeSessionMock.mockReset();
    ensureProjectedSessionMock.mockReset();
    getNativeConfigOptionsMock.mockReset();
    getProjectedConfigOptionsMock.mockReset();
    setNativeSessionModeMock.mockReset();
    setProjectedSessionModeMock.mockReset();
  });

  it('routes provider-active warmup through the Main/Core Team projection', async () => {
    providerActive = true;
    ensureNativeSessionMock.mockResolvedValue(undefined);
    ensureProjectedSessionMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.warmupSession();
    });

    expect(ensureProjectedSessionMock).toHaveBeenCalledWith('team-main-owned');
    expect(ensureNativeSessionMock).not.toHaveBeenCalled();
  });

  it('retains the native AionUI warmup when the Actestra provider is absent', async () => {
    ensureNativeSessionMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.warmupSession();
    });

    expect(ensureNativeSessionMock).toHaveBeenCalledWith({ team_id: 'team-main-owned' });
    expect(ensureProjectedSessionMock).not.toHaveBeenCalled();
  });

  it('routes provider-active session mode through the Main/Core Team projection', async () => {
    providerActive = true;
    setProjectedSessionModeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.propagateMode('default');
    });

    expect(setProjectedSessionModeMock).toHaveBeenCalledWith('team-main-owned', 'conversation-leader', 'default');
    expect(setNativeSessionModeMock).not.toHaveBeenCalled();
  });

  it('retains native AionUI session-mode persistence when the Actestra provider is absent', async () => {
    setNativeSessionModeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.propagateMode('default');
    });

    expect(setNativeSessionModeMock).toHaveBeenCalledWith({
      team_id: 'team-main-owned',
      session_mode: 'default',
    });
    expect(setProjectedSessionModeMock).not.toHaveBeenCalled();
  });

  it('routes provider-active config reads through the Main/Core Team projection', async () => {
    providerActive = true;
    getProjectedConfigOptionsMock.mockResolvedValue({ config_options: [] });
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.loadConfigOptions('conversation-leader');
    });

    expect(getProjectedConfigOptionsMock).toHaveBeenCalledWith('team-main-owned', 'conversation-leader');
    expect(getNativeConfigOptionsMock).not.toHaveBeenCalled();
  });

  it('retains native AionUI config reads when the Actestra provider is absent', async () => {
    getNativeConfigOptionsMock.mockResolvedValue({ config_options: [] });
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    await act(async () => {
      await result.current!.loadConfigOptions('conversation-leader');
    });

    expect(getNativeConfigOptionsMock).toHaveBeenCalledWith({
      team_id: 'team-main-owned',
      conversation_id: 'conversation-leader',
    });
    expect(getProjectedConfigOptionsMock).not.toHaveBeenCalled();
  });

  it('leaves the native per-conversation config setter in place when the Actestra provider is absent', () => {
    const { result } = renderHook(() => useTeamPermission(), { wrapper });

    expect(result.current!.setConfigOption).toBeUndefined();
  });
});
`,
);

const useAcpModelInfoDomTestPath = "tests/unit/renderer/useAcpModelInfo.dom.test.ts";
const useAcpConfigOptionsPath = "packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts";
const useAcpModelInfoPath = "packages/desktop/src/renderer/hooks/agent/useAcpModelInfo.ts";
replaceOnce(
  useAcpConfigOptionsPath,
  `export type AcpConfigOptionsLoader = (conversation_id: string) => Promise<AcpConfigOptionDto[] | null | undefined>;
`,
  `export type AcpConfigOptionsLoader = (conversation_id: string) => Promise<AcpConfigOptionDto[] | null | undefined>;
export type AcpConfigOptionSetter = (conversation_id: string, optionId: string, value: string) => Promise<AcpConfigOptionDto[]>;
`,
);
replaceOnce(
  useAcpModelInfoPath,
  `  type AcpConfigOptionsLoader,
  type AcpConfigSetStatus,`,
  `  type AcpConfigOptionSetter,
  type AcpConfigOptionsLoader,
  type AcpConfigSetStatus,`,
);
replaceOnce(
  useAcpModelInfoPath,
  `  loadConfigOptions?: AcpConfigOptionsLoader;
  enabled?: boolean;`,
  `  loadConfigOptions?: AcpConfigOptionsLoader;
  setConfigOption?: AcpConfigOptionSetter;
  enabled?: boolean;`,
);
replaceOnce(
  useAcpModelInfoPath,
  `  loadConfigOptions,
  enabled = true,`,
  `  loadConfigOptions,
  setConfigOption: setConfigOptionThroughOwner,
  enabled = true,`,
);
replaceOnce(
  useAcpModelInfoPath,
  `    loadConfigOptions,
    enabled,`,
  `    loadConfigOptions,
    setConfigOption: setConfigOptionThroughOwner,
    enabled,`,
);
replaceOnce(
  useAcpConfigOptionsPath,
  `  loadConfigOptions = ensureRuntimeConfigOptions,
  enabled = true,
}: {`,
  `  loadConfigOptions = ensureRuntimeConfigOptions,
  setConfigOption: setConfigOptionThroughOwner,
  enabled = true,
}: {`,
);
replaceOnce(
  useAcpConfigOptionsPath,
  `  loadConfigOptions?: AcpConfigOptionsLoader;
  enabled?: boolean;`,
  `  loadConfigOptions?: AcpConfigOptionsLoader;
  setConfigOption?: AcpConfigOptionSetter;
  enabled?: boolean;`,
);
replaceOnce(
  useAcpConfigOptionsPath,
  `        const response = await ipcBridge.acpConversation.setConfigOption.invoke({
          conversation_id,
          option_id: optionId,
          value,
        });`,
  `        const response = setConfigOptionThroughOwner
          ? { confirmation: 'observed' as const, config_options: await setConfigOptionThroughOwner(conversation_id, optionId, value) }
          : await ipcBridge.acpConversation.setConfigOption.invoke({
              conversation_id,
              option_id: optionId,
              value,
            });`,
);
replaceOnce(
  useAcpConfigOptionsPath,
  `    [conversation_id, key, loadConfigOptions, prepareRuntime, prepareSetRuntime, replaceSnapshot]`,
  `    [conversation_id, key, loadConfigOptions, prepareRuntime, prepareSetRuntime, replaceSnapshot, setConfigOptionThroughOwner]`,
);
replaceOnce(
  useAcpModelInfoDomTestPath,
  `  it('runs set-only runtime preparation before selecting a model without warming during initial load', async () => {`,
  `  it('uses an injected Team config setter instead of standalone conversation IPC', async () => {
    const loadConfigOptions = vi.fn().mockResolvedValue(buildConfigOptions('sonnet-4'));
    const setConfigOption = vi.fn(async (conversationId: string, optionId: string, value: string) => {
      expect({ conversationId, optionId, value }).toEqual({
        conversationId: 'conv-1',
        optionId: 'model',
        value: 'opus-4',
      });
      return buildConfigOptions('opus-4');
    });

    const { result } = renderUseAcpModelInfo({
      conversation_id: 'conv-1',
      backend: 'claude',
      loadConfigOptions,
      setConfigOption,
    });

    await waitFor(() => {
      expect(result.current.canSwitch).toBe(true);
    });
    act(() => {
      result.current.selectModel('opus-4');
    });
    await waitFor(() => {
      expect(result.current.model_info?.current_model_id).toBe('opus-4');
    });
    expect(setConfigOption).toHaveBeenCalledOnce();
    expect(setConfigOptionInvokeMock).not.toHaveBeenCalled();
  });

  it('runs set-only runtime preparation before selecting a model without warming during initial load', async () => {`,
);

const teamTypesPath = "packages/desktop/src/common/types/team/teamTypes.ts";
replaceOnce(
  teamTypesPath,
  `export type WorkspaceMode = 'shared' | 'isolated';`,
  `export type WorkspaceMode = 'shared' | 'isolated';

/** Main/provider-projected product experience for one Team. */
export type TeamExperience = 'standard' | 'orchestrated' | 'unavailable';`,
);
replaceOnce(
  teamTypesPath,
  `export type TTeam = {
  id: string;`,
  `export type TTeam = {
  id: string;
  /** Missing legacy AionUI values migrate to standard at the compatibility mapper. */
  experience?: TeamExperience;
  experience_error?: string;`,
);
replaceOnce(
  teamTypesPath,
  `  name: string;
  workspace: string;`,
  `  name: string;
  description?: string | null;
  workspace: string;`,
);

const teamMapperPath = "packages/desktop/src/common/adapter/teamMapper.ts";
replaceOnce(
  teamMapperPath,
  `export type ICreateTeamParams = {
  user_id: string;
  name: string;`,
  `export type ICreateTeamParams = {
  user_id: string;
  name: string;
  description?: string;`,
);
replaceOnce(
  teamMapperPath,
  `  const leaderAssistantId =
    (r.leader_assistant_id as string | undefined) ?? (r.leader_agent_id as string | undefined) ?? '';
  return {`,
  `  const leaderAssistantId =
    (r.leader_assistant_id as string | undefined) ?? (r.leader_agent_id as string | undefined) ?? '';
  const rawExperience = r.experience;
  const experience =
    rawExperience === 'orchestrated'
      ? 'orchestrated'
      : rawExperience === undefined || rawExperience === 'standard'
        ? 'standard'
        : 'unavailable';
  return {
    experience,
    ...(experience === 'unavailable'
      ? { experience_error: 'team.experience.invalidProjection' }
      : {}),`,
);
replaceOnce(
  teamMapperPath,
  `    name: (r.name as string | undefined) ?? '',
    workspace: (r.workspace as string | undefined) ?? '',`,
  `    name: (r.name as string | undefined) ?? '',
    description: typeof r.description === 'string' ? r.description : null,
    workspace: (r.workspace as string | undefined) ?? '',`,
);
replaceOnce(
  teamMapperPath,
  `export function fromBackendTeamList(raw: unknown): TTeam[] {`,
  `export function resolveTeamExperience(team: TTeam): 'standard' | 'orchestrated' | 'unavailable' {
  return team.experience ?? 'standard';
}

export function fromBackendTeamList(raw: unknown): TTeam[] {`,
);

const standardTeamCreateModalPath =
  "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx";
replaceOnce(
  standardTeamCreateModalPath,
  `import { ipcBridge } from '@/common';`,
  `import { createStandardTeam } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `import { resolveDefaultTeamAgentModel } from './teamCreateModelResolver';\n`,
  ``,
);
replaceOnce(
  standardTeamCreateModalPath,
  `      const resolvedModels = await Promise.all(
        selectedMembers.map(async (member) => {
          try {
            const model = await resolveDefaultTeamAgentModel({
              assistant_id: member.assistant.id,
              assistant_backend: member.assistant.backend,
            });
            return [member.selectionId, model] as const;
          } catch (error) {
            throw new Error(\`\${member.assistant.name}: \${getConversationCreateErrorMessage(error, t)}\`, {
              cause: error,
            });
          }
        })
      );
      const modelBySelectionId = new Map(resolvedModels);
      const agents: TeamAssistantInput[] = selectedMembers.map((member) => ({
        role: member.selectionId === leaderSelectionId ? 'leader' : 'teammate',
        assistant_name: member.assistant.name,
        assistant_id: member.assistant.id,
        model: modelBySelectionId.get(member.selectionId),
      }));

      const team = await ipcBridge.team.create.invoke({
        user_id,
        name,`,
  `      const agents: TeamAssistantInput[] = selectedMembers.map((member) => ({
        role: member.selectionId === leaderSelectionId ? 'leader' : 'teammate',
        assistant_name: member.assistant.name,
        assistant_id: member.assistant.id,
      }));

      const team = await createStandardTeam({
        user_id,
        name: name.trim(),`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);`,
  `  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `    setWorkspace('');
    setAssistantDropdownOpen(false);`,
  `    setWorkspace('');
    setCreateError(null);
    setAssistantDropdownOpen(false);`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `    const user_id = user?.id ?? 'system_default_user';
    setLoading(true);`,
  `    const user_id = user?.id ?? 'system_default_user';
    setCreateError(null);
    setLoading(true);`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `    } catch (error) {
      Message.error(getConversationCreateErrorMessage(error, t));
    } finally {`,
  `    } catch (error) {
      const message = getConversationCreateErrorMessage(error, t);
      setCreateError(message);
      Message.error(message);
    } finally {`,
);
replaceOnce(
  standardTeamCreateModalPath,
  `        <WorkspaceFolderSelect
          value={workspace}
          onChange={setWorkspace}
          placeholder={t('team.create.selectFolder', { defaultValue: 'Select folder' })}
          recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
          chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
            defaultValue: 'Choose a different folder',
          })}
          triggerTestId='team-create-workspace-trigger'
          menuTestId='team-create-workspace-menu'
        />
      </div>
    </div>`,
  `        <WorkspaceFolderSelect
          value={workspace}
          onChange={setWorkspace}
          placeholder={t('team.create.selectFolder', { defaultValue: 'Select folder' })}
          recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
          chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
            defaultValue: 'Choose a different folder',
          })}
          triggerTestId='team-create-workspace-trigger'
          menuTestId='team-create-workspace-menu'
        />
      </div>
      {createError ? (
        <div
          data-testid='team-create-error'
          role='alert'
          className='col-span-2 rounded-8px border border-solid border-danger-3 bg-danger-1 px-12px py-10px text-12px leading-18px text-danger-7'
        >
          <div className='font-600'>{t('team.create.error')}</div>
          <div className='mt-2px break-words'>{createError}</div>
          <div className='mt-2px text-danger-6'>{t('team.create.failureNextStep')}</div>
        </div>
      ) : null}
    </div>`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/en-US/agentMode.json",
  `  "switchFailed": "Failed to switch mode"`,
  `  "switchFailed": "Failed to switch mode",
  "unavailable": "Unavailable",
  "unavailableDescription": "This Team runtime does not expose permission modes. Chat and model selection remain available."`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/zh-CN/agentMode.json",
  `  "switchFailed": "模式切换失败"`,
  `  "switchFailed": "模式切换失败",
  "unavailable": "暂不可用",
  "unavailableDescription": "当前 Team runtime 未提供权限模式；聊天和模型选择仍可使用。"`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/en-US/team.json",
  `    "error": "Failed to create team",`,
  `    "error": "Failed to create team",
    "failureNextStep": "The Team was not created. Check the selected assistant's CLI login or configuration, then retry.",`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/zh-CN/team.json",
  `    "error": "创建团队失败",`,
  `    "error": "创建团队失败",
    "failureNextStep": "该 Team 尚未创建。请检查所选助手 CLI 的登录或配置，然后重试。",`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/TeamCreateExperienceChooser.tsx",
  `import { Popover } from '@arco-design/web-react';
import { BranchOne, Peoples, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import AionModal from '@renderer/components/base/AionModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';

export type TeamCreateExperience = 'standard' | 'orchestrated';

type Props = {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onChoose: (experience: TeamCreateExperience) => void;
  anchor: React.ReactElement;
};

const TeamCreateExperienceChooser: React.FC<Props> = ({ visible, onVisibleChange, onChoose, anchor }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const choices = (
    <div role='menu' aria-label={t('team.experience.chooseTitle')} className='w-360px max-w-[calc(100vw-32px)] py-6px'>
      <button
        type='button'
        role='menuitem'
        data-testid='team-create-kind-standard'
        className='w-full border-0 bg-transparent px-12px py-10px flex items-start gap-10px text-left rd-8px cursor-pointer hover:bg-fill-2 focus-visible:outline-2 focus-visible:outline-primary-6'
        onClick={() => onChoose('standard')}
      >
        <span className='mt-1px text-t-secondary shrink-0'><Peoples size='18' fill='currentColor' /></span>
        <span className='min-w-0 flex-1'>
          <span className='block text-14px font-500 text-t-primary'>{t('team.experience.standardTitle')}</span>
          <span className='mt-2px block text-12px leading-18px text-t-tertiary'>{t('team.experience.standardDescription')}</span>
        </span>
        <Right className='mt-4px shrink-0 text-t-tertiary' size='14' fill='currentColor' />
      </button>
      <button
        type='button'
        role='menuitem'
        data-testid='team-create-kind-orchestrated'
        className='w-full border-0 bg-transparent px-12px py-10px flex items-start gap-10px text-left rd-8px cursor-pointer hover:bg-fill-2 focus-visible:outline-2 focus-visible:outline-primary-6'
        onClick={() => onChoose('orchestrated')}
      >
        <span className='mt-1px text-t-secondary shrink-0'><BranchOne size='18' fill='currentColor' /></span>
        <span className='min-w-0 flex-1'>
          <span className='block text-14px font-500 text-t-primary'>{t('team.experience.orchestratedTitle')}</span>
          <span className='mt-2px block text-12px leading-18px text-t-tertiary'>{t('team.experience.orchestratedDescription')}</span>
        </span>
        <Right className='mt-4px shrink-0 text-t-tertiary' size='14' fill='currentColor' />
      </button>
    </div>
  );

  if (layout?.isMobile) {
    return (
      <>
        {anchor}
        <AionModal
          variant='standard'
          visible={visible}
          onCancel={() => onVisibleChange(false)}
          footer={null}
          style={{ width: 'calc(100vw - 24px)', maxWidth: 420 }}
          header={{ title: t('team.experience.chooseTitle'), showClose: true }}
        >
          {choices}
        </AionModal>
      </>
    );
  }

  return (
    <Popover
      trigger='click'
      position='rt'
      popupVisible={visible}
      onVisibleChange={onVisibleChange}
      content={choices}
      unmountOnExit
    >
      {anchor}
    </Popover>
  );
};

export default TeamCreateExperienceChooser;
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
  `import { Button, Input, Message, Radio, Select } from '@arco-design/web-react';
import { DeleteOne, FolderOpen, Plus } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { TTeam } from '@/common/types/team/teamTypes';
import {
  createActestraTeam,
  listActestraTeamModelOptions,
  listActestraTeamWorkspaceOptions,
  selectActestraTeamWorkspace,
} from '@/common/adapter/actestraTeamClient';
import AionModal from '@renderer/components/base/AionModal';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

type MemberCapability = 'general' | 'coding';
type MemberDraft = {
  key: string;
  capability: MemberCapability;
  name: string;
  fixed: boolean;
};

const ActestraTeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const initialMembers = (): MemberDraft[] => [
    { key: 'general-primary', capability: 'general', name: t('team.actestra.generalDefaultName'), fixed: true },
    { key: 'goose-primary', capability: 'coding', name: t('team.actestra.gooseDefaultName'), fixed: true },
  ];
  const [members, setMembers] = useState<MemberDraft[]>(initialMembers);
  const [leaderKey, setLeaderKey] = useState('general-primary');
  const [nextMemberNumber, setNextMemberNumber] = useState(2);
  const [loading, setLoading] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [workspaceSelecting, setWorkspaceSelecting] = useState(false);
  const { data: workspaceData, error: workspaceError, isLoading: workspacesLoading, mutate: refreshWorkspaces } = useSWR(
    visible ? 'actestra-team-workspace-options' : null,
    listActestraTeamWorkspaceOptions,
    { revalidateOnFocus: false },
  );
  const workspaceOptions = workspaceData?.workspace_options ?? [];
  const { data: modelOptionsData, error: modelOptionsError, isLoading: modelOptionsLoading } = useSWR(
    visible ? 'actestra-team-model-options' : null,
    listActestraTeamModelOptions,
    { revalidateOnFocus: false },
  );
  const providers = modelOptionsData?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.provider_id === providerId);
  const availableModels = selectedProvider?.model_ids ?? [];

  useEffect(() => {
    if (!visible) return;
    if (!members.some((member) => member.key === leaderKey)) setLeaderKey(members[0]?.key ?? 'general-primary');
  }, [leaderKey, members, visible]);

  const valid = useMemo(
    () =>
      name.trim().length > 0 &&
      description.trim().length > 0 &&
      members.length >= 2 &&
      members.length <= 5 &&
      members.every((member) => member.name.trim().length > 0) &&
      members.some((member) => member.capability === 'general') &&
      members.some((member) => member.capability === 'coding') &&
      members.some((member) => member.key === leaderKey) &&
      selectedProvider !== undefined &&
      availableModels.includes(modelId) &&
      workspaceOptions.some((option) => option.workspace_id === workspaceId),
    [availableModels, description, leaderKey, members, modelId, name, selectedProvider, workspaceId, workspaceOptions],
  );

  const addMember = () => {
    if (members.length >= 5) return;
    const number = nextMemberNumber;
    setNextMemberNumber((current) => current + 1);
    setMembers((current) => [
      ...current,
      {
        key: 'extra-' + String(number),
        capability: 'general',
        name: t('team.actestra.generalDefaultName') + ' ' + String(number),
        fixed: false,
      },
    ]);
  };

  const updateMember = (key: string, update: Partial<Pick<MemberDraft, 'capability' | 'name'>>) => {
    setMembers((current) => current.map((member) => member.key === key ? { ...member, ...update } : member));
  };

  const removeMember = (key: string) => {
    const member = members.find((candidate) => candidate.key === key);
    if (member?.fixed || members.length <= 2) return;
    const remaining = members.filter((candidate) => candidate.key !== key);
    setMembers(remaining);
    if (leaderKey === key) setLeaderKey(remaining[0]!.key);
  };

  const selectWorkspace = async () => {
    setWorkspaceSelecting(true);
    try {
      const selected = await selectActestraTeamWorkspace();
      if (selected === null) return;
      await refreshWorkspaces();
      setWorkspaceId(selected.workspace_id);
    } catch {
      Message.error(t('team.actestra.workspaceGrantFailed'));
    } finally {
      setWorkspaceSelecting(false);
    }
  };

  const close = () => {
    setName('');
    setDescription('');
    setWorkspaceId('');
    setProviderId('');
    setModelId('');
    setMembers(initialMembers());
    setLeaderKey('general-primary');
    setNextMemberNumber(2);
    setCreateFailed(false);
    onClose();
  };

  const create = async () => {
    if (!valid) {
      Message.warning(t('team.actestra.createInvalid'));
      return;
    }
    setCreateFailed(false);
    setLoading(true);
    try {
      const team = await createActestraTeam({
        user_id: 'actestra-local-user',
        name: name.trim(),
        description: description.trim(),
        workspace: workspaceId.trim(),
        workspace_mode: 'isolated',
        modelSelection: { providerId, modelId },
        agents: members.map((member) => ({
          role: member.key === leaderKey ? 'leader' : 'teammate',
          assistant_name: member.name.trim(),
          assistant_id: member.capability === 'general' ? 'actestra-general-worker' : 'actestra-goose-worker',
          model: 'default',
        })),
      });
      onCreated(team);
      close();
    } catch {
      setCreateFailed(true);
      Message.error(t('team.actestra.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={close}
      style={{ width: 720, maxWidth: 'calc(100vw - 32px)' }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={true}
      header={{
        title: t('team.actestra.createTitle'),
        subtitle: t('team.actestra.createSubtitle'),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-10px'>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button data-testid='actestra-team-create-submit' type='primary' loading={loading} disabled={!valid} onClick={() => void create()}>
              {t('team.actestra.createAction')}
            </Button>
          </div>
        ),
      }}
    >
      <div data-testid='actestra-team-create-modal' className='flex flex-col gap-18px px-20px py-18px'>
        <div className='rounded-10px border border-solid border-[color:var(--border-base)] bg-fill-1 p-14px'>
          <div className='text-14px font-600 text-t-primary'>{t('team.actestra.coreAuthorityTitle')}</div>
          <div className='mt-4px text-12px leading-18px text-t-tertiary'>{t('team.actestra.coreAuthorityDescription')}</div>
        </div>
        {createFailed && (
          <div
            data-testid='actestra-team-create-error'
            role='alert'
            className='rounded-8px border border-solid border-danger-3 bg-danger-1 px-12px py-10px text-12px leading-18px text-danger-7'
          >
            <div className='font-600'>{t('team.actestra.createFailed')}</div>
            <div className='mt-2px text-danger-6'>{t('team.actestra.createFailedNextStep')}</div>
          </div>
        )}
        <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
          {t('team.create.nameLabel')}
          <Input data-testid='actestra-team-name-input' value={name} maxLength={120} onChange={setName} placeholder={t('team.actestra.namePlaceholder')} />
        </label>
        <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
          {t('team.actestra.descriptionLabel')}
          <Input.TextArea
            data-testid='actestra-team-description-input'
            value={description}
            maxLength={800}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={setDescription}
            placeholder={t('team.actestra.descriptionPlaceholder')}
          />
        </label>
        <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
          {t('team.actestra.workspaceLabel')}
          <Select
            data-testid='actestra-team-workspace-select'
            value={workspaceId || undefined}
            loading={workspacesLoading}
            disabled={workspacesLoading || workspaceError !== undefined || workspaceOptions.length === 0}
            placeholder={
              workspaceError !== undefined
                ? t('team.actestra.workspaceUnavailable')
                : t('team.actestra.workspacePlaceholder')
            }
            onChange={setWorkspaceId}
          >
            {workspaceOptions.map((option) => (
              <Select.Option key={option.workspace_id} value={option.workspace_id}>
                {option.display_name}
              </Select.Option>
            ))}
          </Select>
          {workspaceOptions.length === 0 && !workspacesLoading && workspaceError === undefined && (
            <span className='text-12px font-400 text-t-tertiary'>{t('team.actestra.workspaceEmpty')}</span>
          )}
          <Button
            data-testid='actestra-team-workspace-grant'
            type='text'
            size='small'
            className='self-start !px-0'
            icon={<FolderOpen />}
            loading={workspaceSelecting}
            onClick={() => void selectWorkspace()}
          >
            {t('team.actestra.chooseWorkspaceAction')}
          </Button>
        </label>
        <div className='grid grid-cols-2 gap-10px'>
          <div className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
            <span id='actestra-team-provider-label'>{t('team.actestra.providerLabel')}</span>
            <Select
              data-testid='actestra-team-provider-select'
              aria-labelledby='actestra-team-provider-label'
              value={providerId || undefined}
              placeholder={t('team.actestra.providerPlaceholder')}
              loading={modelOptionsLoading}
              disabled={modelOptionsLoading || modelOptionsError !== undefined}
              onChange={(value) => {
                setProviderId(value);
                setModelId('');
              }}
            >
              {providers.map((provider) => (
                <Select.Option key={provider.provider_id} value={provider.provider_id}>{provider.name}</Select.Option>
              ))}
            </Select>
          </div>
          <div className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
            <span id='actestra-team-model-label'>{t('team.actestra.modelLabel')}</span>
            <Select
              data-testid='actestra-team-model-select'
              aria-labelledby='actestra-team-model-label'
              value={modelId || undefined}
              disabled={selectedProvider === undefined}
              placeholder={t('team.actestra.modelPlaceholder')}
              onChange={setModelId}
            >
              {availableModels.map((model) => (
                <Select.Option key={model} value={model}>{model}</Select.Option>
              ))}
            </Select>
          </div>
        </div>
        <div className='flex flex-col gap-10px'>
          <div className='flex items-center justify-between gap-12px'>
            <div>
              <div className='text-13px font-500 text-t-secondary'>{t('team.actestra.membersConfig')}</div>
              <div className='mt-2px text-12px text-t-tertiary'>{t('team.actestra.membersHint', { count: members.length })}</div>
            </div>
            <Button data-testid='actestra-team-member-add' size='small' icon={<Plus />} disabled={members.length >= 5} onClick={addMember}>
              {t('team.actestra.addMember')}
            </Button>
          </div>
          {members.map((member) => (
            <div key={member.key} data-testid='actestra-team-member-row' className='grid grid-cols-[minmax(120px,0.8fr)_minmax(160px,1.4fr)_auto_auto] items-center gap-8px rounded-10px border border-solid border-[color:var(--border-base)] p-10px'>
              <Select
                aria-label={t('team.actestra.capabilityLabel')}
                value={member.capability}
                disabled={member.fixed}
                onChange={(value) => updateMember(member.key, { capability: value as MemberCapability })}
              >
                <Select.Option value='general'>{t('team.actestra.generalWorkerLabel')}</Select.Option>
                <Select.Option value='coding'>{t('team.actestra.gooseWorkerLabel')}</Select.Option>
              </Select>
              <Input
                data-testid='actestra-team-member-name'
                aria-label={t('team.actestra.memberNameLabel')}
                value={member.name}
                maxLength={120}
                onChange={(value) => updateMember(member.key, { name: value })}
              />
              <Radio checked={leaderKey === member.key} onChange={() => setLeaderKey(member.key)}>
                {t('team.actestra.leader')}
              </Radio>
              {!member.fixed && (
                <Button
                  data-testid='actestra-team-member-remove'
                  aria-label={t('team.actestra.removeMember')}
                  type='text'
                  status='danger'
                  icon={<DeleteOne />}
                  onClick={() => removeMember(member.key)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </AionModal>
  );
};

export default ActestraTeamCreateModal;
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamArtifactList.tsx",
  `import React from 'react';
import { Tag } from '@arco-design/web-react';
import type { NativeAionUiTeamArtifactReference } from '@/actestra/compatibility/aionui/teamBridge';
import ActestraCodingArtifactCard, { type ActestraCodingArtifactCardArtifact } from '@/renderer/components/actestra/ActestraCodingArtifactCard';

/**
 * Renders a Team node's Artifacts. A coding Artifact that produced a patch carries a delivery
 * projection, and is rendered with the same card the non-Team surface uses so apply behaves
 * identically on both surfaces. Anything else stays an inert label: a General node writes no patch,
 * so there is nothing to apply.
 *
 * The mapping here is only snake_case to camelCase. No capability is added: every privileged action
 * still goes through the Main-owned journey bridge that the card calls.
 */

/** Bound so a malformed projection cannot make the renderer walk an unbounded list. */
const ARTIFACT_LIMIT = 100;

function cardArtifact(artifact: NativeAionUiTeamArtifactReference): ActestraCodingArtifactCardArtifact {
  const delivery = artifact.delivery;
  if (delivery === undefined) {
    return { artifactId: artifact.artifact_id as ActestraCodingArtifactCardArtifact['artifactId'], label: artifact.label };
  }
  return {
    artifactId: artifact.artifact_id as ActestraCodingArtifactCardArtifact['artifactId'],
    label: artifact.label,
    delivery: {
      deliveryState: delivery.delivery_state,
      baseCommit: delivery.base_commit,
      changedFileCount: delivery.changed_file_count,
      ...(delivery.failure_code === undefined ? {} : { failureCode: delivery.failure_code }),
      ...(delivery.apply_approval_id === undefined ? {} : { applyApprovalId: delivery.apply_approval_id }),
    },
  };
}

const ActestraTeamArtifactList: React.FC<{
  artifacts: readonly NativeAionUiTeamArtifactReference[];
  label: (artifact: NativeAionUiTeamArtifactReference) => string;
  onDeliveryChanged?: () => void | Promise<void>;
}> = ({ artifacts, label, onDeliveryChanged }) => {
  if (artifacts.length === 0) return null;
  return (
    <div className='mt-8px flex flex-col gap-6px' data-testid='actestra-team-artifacts'>
      {artifacts.slice(0, ARTIFACT_LIMIT).map((artifact) =>
        artifact.delivery ? (
          <ActestraCodingArtifactCard key={artifact.artifact_id} nativeConversationId={artifact.delivery.native_conversation_id} artifact={cardArtifact(artifact)} onDeliveryChanged={onDeliveryChanged} />
        ) : (
          <div key={artifact.artifact_id} className='flex flex-wrap gap-6px'>
            <Tag color='green'>{label(artifact)}</Tag>
          </div>
        ),
      )}
    </div>
  );
};

export default ActestraTeamArtifactList;
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
  `import { Button, Empty, Input, Message, Progress, Spin, Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Pause, Peoples, Play, Refresh, TransferData, UserToUserTransmission } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { AionUiTeamEvent, NativeAionUiTeamNodeView, NativeAionUiTeamRunState } from '@/actestra/compatibility/aionui/teamBridge';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import ActestraTeamArtifactList from '@/renderer/pages/team/components/ActestraTeamArtifactList';
import TeamTabs from '@/renderer/pages/team/components/TeamTabs';
import TeamViewToggle from '@/renderer/pages/team/components/TeamViewToggle';
import { TeamTabsProvider, useTeamTabs } from '@/renderer/pages/team/hooks/TeamTabsContext';
import { useTeamViewMode } from '@/renderer/pages/team/hooks/useTeamViewMode';
import {
  cancelActestraTeamRun,
  completeActestraTeamHandoff,
  controlActestraTeamNode,
  decideActestraTeamApproval,
  getActestraTeamRunState,
  renameActestraTeam,
  resolveActestraTeamFeedback,
  submitActestraTeamTask,
  subscribeActestraTeamEvents,
  type ActestraTeamNodeAction,
} from '@/common/adapter/actestraTeamClient';

type Props = { team: TTeam };
type Activity = { id: string; author: string; slot_id?: string | null; content: string; tone: 'user' | 'system' | 'worker' };
type SubmitFailure = 'plannerUnavailable' | 'workerRuntimeUnavailable' | 'plannerInvalid' | 'plannerTimeout' | 'invalidRequest' | 'submitFailed';
type ActionFailure = 'controlFailed' | 'feedbackFailed' | 'cancelFailed' | 'renameFailed';

function submitFailure(error: unknown): SubmitFailure {
  if (!isBackendHttpError(error)) return 'submitFailed';
  if (error.code === 'team-planner-unavailable') return 'plannerUnavailable';
  if (error.code === 'team-worker-runtime-unavailable') return 'workerRuntimeUnavailable';
  if (error.code === 'team-planner-invalid') return 'plannerInvalid';
  if (error.code === 'team-planner-timeout') return 'plannerTimeout';
  // A rejected request body is the author's to fix, not a Core outage. Only the
  // closed code is mapped: the parser's free-text reason never reaches the UI.
  if (error.code === 'team-invalid-request') return 'invalidRequest';
  return 'submitFailed';
}

function eventTeamId(event: AionUiTeamEvent): string | null {
  if ('team_id' in event.payload && typeof event.payload.team_id === 'string') return event.payload.team_id;
  return null;
}

function eventBelongsToTeam(event: AionUiTeamEvent, team: TTeam): boolean {
  const directTeamId = eventTeamId(event);
  if (directTeamId !== null) return directTeamId === team.id;
  return event.type === 'team.teammateMessage' && team.assistants.some(
    (assistant) => assistant.conversation_id === event.payload.conversation_id,
  );
}

function statusColor(status: string): 'blue' | 'green' | 'red' | 'orange' | 'gray' {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'blocked' || status === 'paused') return 'orange';
  if (status === 'running' || status === 'ready') return 'blue';
  return 'gray';
}

function blockedExplanation(
  node: NativeAionUiTeamNodeView,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  switch (node.blocked_reason) {
    case 'dependency': return translate('team.actestra.blocked.dependency');
    case 'human-feedback': return translate('team.actestra.blocked.humanFeedback');
    case 'protected-approval': return translate('team.actestra.blocked.protectedApproval');
    case 'attempt-failed': return translate('team.actestra.blocked.attemptFailed');
    case 'cancelled': return translate('team.actestra.blocked.cancelled');
    case 'paused': return translate('team.actestra.blocked.paused');
    case 'handoff': return translate('team.actestra.blocked.handoff');
    case 'interrupted': return translate('team.actestra.blocked.interrupted');
    case 'revision-requested': return translate('team.actestra.blocked.revisionRequested');
    case null: return node.blocked_explanation;
    default: return translate('team.actestra.blocked.unknown');
  }
}

const ActestraTeamWorkspaceContent: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { activeSlotId } = useTeamTabs();
  const [viewMode, setViewMode] = useTeamViewMode(team.id);
  const [displayName, setDisplayName] = useState(team.name);
  const { data, error, isLoading, mutate } = useSWR<NativeAionUiTeamRunState>(
    'actestra-team-run/' + team.id,
    () => getActestraTeamRunState(team.id),
    { revalidateOnFocus: false },
  );
  const [task, setTask] = useState('');
  const [handoffContent, setHandoffContent] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [submitFailureKey, setSubmitFailureKey] = useState<SubmitFailure | null>(null);
  const [actionFailureKey, setActionFailureKey] = useState<ActionFailure | null>(null);
  const [liveActivities, setLiveActivities] = useState<Activity[]>([]);

  useEffect(() => setDisplayName(team.name), [team.name]);

  useEffect(() =>
    subscribeActestraTeamEvents((event) => {
      if (!eventBelongsToTeam(event, team)) return;
      if (event.type === 'team.teammateMessage') {
        setLiveActivities((current) => [
          ...current,
          { id: event.payload.conversation_id + '-' + String(current.length), author: event.payload.from_name, slot_id: event.payload.from_slot_id, content: event.payload.content, tone: 'worker' },
        ]);
      }
      void mutate();
    }),
  [mutate, team]);

  const run = data?.active_run ?? null;
  const submissionUnavailable = data?.submission.availability !== 'available';
  const nodes = run?.actestra.nodes ?? [];
  const activities = useMemo(() => {
    const byId = new Map<string, Activity>();
    for (const activity of data?.activities ?? []) byId.set(activity.id, activity);
    for (const activity of liveActivities) if (!byId.has(activity.id)) byId.set(activity.id, activity);
    return [...byId.values()];
  }, [data?.activities, liveActivities]);
  const progress = useMemo(() => {
    if (nodes.length === 0) return 0;
    return Math.round((nodes.filter((node) => node.state === 'completed').length / nodes.length) * 100);
  }, [nodes]);
  const currentExecutors = useMemo(
    () => [...new Set(nodes.filter((node) => ['ready', 'running', 'blocked', 'paused', 'handoff-required'].includes(node.state)).map((node) => node.current_executor))],
    [nodes],
  );
  const activeAssistant = team.assistants.find((assistant) => assistant.slot_id === activeSlotId);
  const visibleAssistants =
    viewMode === 'single' && activeAssistant ? [activeAssistant] : team.assistants;
  const visibleActivities =
    viewMode === 'single' && activeAssistant
      ? activities.filter((activity) =>
          activity.tone !== 'worker'
            ? true
            : typeof activity.slot_id === 'string'
              ? activity.slot_id === activeAssistant.slot_id
              : activity.author === activeAssistant.assistant_name,
        )
      : activities;

  const refresh = useCallback(async (next?: NativeAionUiTeamRunState) => {
    if (next) await mutate(next, false);
    else await mutate();
  }, [mutate]);

  const submit = async () => {
    const content = task.trim();
    if (!content || busy !== null || error !== undefined || submissionUnavailable) return;
    setSubmitFailureKey(null);
    setBusy('submit');
    try {
      const ack = await submitActestraTeamTask(team.id, content);
      setLiveActivities((current) => [...current, { id: ack.message_id, author: 'You', content, tone: 'user' }]);
      setTask('');
      await refresh();
    } catch (submitError) {
      setSubmitFailureKey(submitFailure(submitError));
    } finally {
      setBusy(null);
    }
  };

  const control = async (node: NativeAionUiTeamNodeView, action: string) => {
    if (!run || busy !== null) return;
    const key = node.action_id + '-' + action;
    setActionFailureKey(null);
    setBusy(key);
    try {
      let next: NativeAionUiTeamRunState;
      if (action === 'approve' || action === 'deny') {
        next = await decideActestraTeamApproval({
          teamId: team.id,
          runId: run.team_run_id,
          slotId: node.slot_id,
          decision: action === 'approve' ? 'approved' : 'denied',
        });
      } else {
        next = await controlActestraTeamNode({
          teamId: team.id,
          runId: run.team_run_id,
          slotId: node.slot_id,
          action: action as ActestraTeamNodeAction,
          reason: 'User requested ' + action + ' from the Actestra Team page.',
        });
      }
      await refresh(next);
    } catch {
      setActionFailureKey('controlFailed');
    } finally {
      setBusy(null);
    }
  };

  const resolveFeedback = async (decision: 'approved' | 'denied') => {
    if (!run || busy !== null) return;
    setActionFailureKey(null);
    setBusy('feedback-' + decision);
    try {
      await refresh(await resolveActestraTeamFeedback({
        teamId: team.id,
        runId: run.team_run_id,
        decision,
        note: decision === 'approved' ? 'Continue from Team feedback.' : 'Revise from Team feedback.',
      }));
    } catch {
      setActionFailureKey('feedbackFailed');
    } finally {
      setBusy(null);
    }
  };

  const completeHandoff = async (node: NativeAionUiTeamNodeView) => {
    if (!run || busy !== null) return;
    const content = (handoffContent[node.action_id] ?? '').trim();
    if (!content) return;
    setActionFailureKey(null);
    setBusy(node.action_id + '-handoff-completion');
    try {
      await refresh(await completeActestraTeamHandoff({
        teamId: team.id,
        runId: run.team_run_id,
        slotId: node.slot_id,
        content,
      }));
      setHandoffContent((current) => ({ ...current, [node.action_id]: '' }));
    } catch {
      setActionFailureKey('controlFailed');
    } finally {
      setBusy(null);
    }
  };

  const cancelRun = async () => {
    if (!run || busy !== null) return;
    setActionFailureKey(null);
    setBusy('cancel-run');
    try {
      await refresh(await cancelActestraTeamRun(team.id, run.team_run_id, 'User cancelled the whole Team from the Actestra Team page.'));
    } catch {
      setActionFailureKey('cancelFailed');
    } finally {
      setBusy(null);
    }
  };

  const renameTeam = useCallback(async (nextName: string): Promise<boolean> => {
    setActionFailureKey(null);
    try {
      await renameActestraTeam(team.id, nextName);
      setDisplayName(nextName);
      return true;
    } catch {
      setActionFailureKey('renameFailed');
      return false;
    }
  }, [team.id]);

  if (isLoading) return <div className='flex h-full items-center justify-center'><Spin loading /></div>;

  return (
    <ChatLayout
      title={displayName}
      sider={<div />}
      workspaceEnabled={false}
      tabsSlot={<TeamTabs reorderEnabled={false} />}
      conversation_id={activeAssistant?.conversation_id}
      workspacePreferenceKey={team.id}
      onRenameTitle={renameTeam}
      headerExtra={
        <TeamViewToggle value={viewMode} onChange={setViewMode} />
      }
      headerLeading={
        <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center leading-none text-t-primary'>
          <Peoples theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />
        </span>
      }
    >
    <div
      data-testid='actestra-team-workspace'
      data-view-mode={viewMode}
      className='flex h-full min-h-0 flex-col overflow-hidden bg-1'
    >
      <header className='flex flex-wrap items-center justify-between gap-12px border-b border-solid border-[color:var(--border-base)] px-18px py-14px'>
        <div className='min-w-0'>
          <div className='flex items-center gap-8px'>
            <Tag color='arcoblue'>{t('team.actestra.typeLabel')}</Tag>
            {run && (
              <Tag data-testid='actestra-team-run-status' color={statusColor(run.actestra.core_status)}>
                {t('team.actestra.runStatus.' + run.actestra.core_status)}
              </Tag>
            )}
          </div>
          <p className='m-0 mt-4px text-12px text-t-tertiary'>{t('team.actestra.authorityCaption', { workspace: team.workspace })}</p>
        </div>
        <div className='flex items-center gap-8px'>
          <Button icon={<Refresh />} onClick={() => void refresh()}>{t('common.refresh')}</Button>
          {run && !['completed', 'cancelled', 'failed'].includes(run.status) && (
            <Button status='danger' icon={<CloseOne />} loading={busy === 'cancel-run'} onClick={() => void cancelRun()}>
              {t('team.actestra.cancelWholeTeam')}
            </Button>
          )}
        </div>
      </header>
      {actionFailureKey && (
        <div data-testid='actestra-team-action-error' role='alert' className='border-b border-solid border-[color:var(--danger-3)] bg-danger-1 px-18px py-10px text-12px leading-18px text-danger-7'>
          <div className='font-600'>{t('team.actestra.' + actionFailureKey)}</div>
          <div className='mt-3px text-t-secondary'>{t('team.actestra.' + actionFailureKey + 'NextStep')}</div>
        </div>
      )}

      <section className='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[260px_minmax(360px,1fr)_minmax(320px,420px)]'>
        <aside className='border-b border-solid border-[color:var(--border-base)] p-16px xl:border-b-0 xl:border-r'>
          <h2 className='m-0 text-14px font-600 text-t-primary'>{t('team.actestra.members')}</h2>
          <div className='mt-12px flex flex-col gap-10px'>
            {visibleAssistants.map((assistant) => (
              <article key={assistant.slot_id} className='rounded-10px border border-solid border-[color:var(--border-base)] bg-fill-1 p-12px'>
                <div className='flex items-center justify-between gap-8px'>
                  <span className='font-600 text-t-primary'>{assistant.assistant_name}</span>
                  <Tag color={assistant.assistant_backend === 'goose' ? 'orange' : 'blue'}>{assistant.assistant_backend === 'goose' ? 'Goose' : 'General'}</Tag>
                </div>
                <div className='mt-6px flex items-center justify-between text-12px text-t-tertiary'>
                  <span>{t('team.actestra.role.' + assistant.role)}</span>
                  <span data-testid='actestra-team-member-status'>
                    {t('team.actestra.assistantStatus.' + assistant.status)}
                  </span>
                </div>
              </article>
            ))}
          </div>
          <div className='mt-14px rounded-10px bg-fill-1 p-12px text-12px leading-18px text-t-secondary'>
            <div className='font-600 text-t-primary'>{t('team.actestra.authoritySourceTitle')}</div>
            <div className='mt-4px'>{t('team.actestra.authoritySourceDescription')}</div>
            <div className='mt-8px font-600 text-t-primary'>{t('team.actestra.currentExecutorTitle')}</div>
            <div className='mt-4px' data-testid='actestra-team-current-executor'>{currentExecutors.length > 0 ? currentExecutors.join(' + ') : t('team.actestra.noCurrentExecutor')}</div>
          </div>
        </aside>

        <section className='flex min-h-520px flex-col border-b border-solid border-[color:var(--border-base)] xl:border-b-0 xl:border-r'>
          <div className='border-b border-solid border-[color:var(--border-base)] px-16px py-12px'>
            <h2 className='m-0 text-14px font-600 text-t-primary'>{t('team.actestra.groupChat')}</h2>
            <p className='m-0 mt-3px text-12px text-t-tertiary'>{t('team.actestra.groupChatDescription')}</p>
          </div>
          <div className='flex flex-1 flex-col gap-12px overflow-y-auto p-16px' data-testid='actestra-team-activity'>
            {activities.length === 0 && run === null ? (
              <Empty description={t('team.actestra.noRun')} />
            ) : (
              <>
                {run && (
                  <div className='max-w-[92%] self-start rounded-12px bg-fill-2 px-13px py-10px text-13px text-t-secondary'>
                    <div className='mb-3px text-11px font-600 uppercase tracking-wide text-t-tertiary'>{t('team.actestra.recoveredRevision', { revision: run.actestra.revision })}</div>
                    {run.actestra.status_explanation}
                  </div>
                )}
                {visibleActivities.map((activity) => (
                  <div key={activity.id} className={'max-w-[88%] rounded-12px px-13px py-10px text-13px ' + (activity.tone === 'user' ? 'self-end bg-primary-6 text-white' : 'self-start bg-fill-2 text-t-primary')}>
                    <div className={'mb-3px text-11px font-600 ' + (activity.tone === 'user' ? 'text-white/80' : 'text-t-tertiary')}>{activity.author}</div>
                    {activity.content}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className='border-t border-solid border-[color:var(--border-base)] p-12px'>
            {submissionUnavailable && data?.submission.blocked_reason === 'planner-unavailable' && (
              <div data-testid='actestra-team-submission-unavailable' role='status' className='mb-10px rounded-8px border border-solid border-[color:var(--warning-3)] bg-warning-1 p-10px text-12px leading-18px text-warning-7'>
                <div className='font-600'>{t('team.actestra.plannerUnavailable')}</div>
                <div className='mt-3px text-t-secondary'>{t('team.actestra.plannerUnavailableNextStep')}</div>
              </div>
            )}
            {submissionUnavailable && data?.submission.blocked_reason === 'worker-runtime-unavailable' && (
              <div data-testid='actestra-team-worker-runtime-unavailable' role='status' className='mb-10px rounded-8px border border-solid border-[color:var(--warning-3)] bg-warning-1 p-10px text-12px leading-18px text-warning-7'>
                <div className='font-600'>{t('team.actestra.workerRuntimeUnavailable')}</div>
                <div className='mt-3px text-t-secondary'>{t('team.actestra.workerRuntimeUnavailableNextStep')}</div>
              </div>
            )}
            {submitFailureKey && (
              <div data-testid='actestra-team-submit-error' role='alert' className='mb-10px rounded-8px border border-solid border-[color:var(--danger-3)] bg-danger-1 p-10px text-12px leading-18px text-danger-7'>
                <div className='font-600'>{t('team.actestra.' + submitFailureKey)}</div>
                <div className='mt-3px text-t-secondary'>{t('team.actestra.' + submitFailureKey + 'NextStep')}</div>
              </div>
            )}
            <Input.TextArea
              data-testid='actestra-team-task-input'
              value={task}
              maxLength={16 * 1024}
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={error !== undefined || submissionUnavailable || busy !== null || Boolean(run && !['completed', 'cancelled', 'failed'].includes(run.status))}
              placeholder={t('team.actestra.taskPlaceholder')}
              onChange={setTask}
            />
            <div className='mt-8px flex items-center justify-between gap-8px'>
              <span className='text-11px text-t-tertiary'>{t('team.actestra.taskPrivacy')}</span>
              <Button data-testid='actestra-team-run-submit' type='primary' icon={<Play />} loading={busy === 'submit'} disabled={error !== undefined || submissionUnavailable || !task.trim()} onClick={() => void submit()}>
                {t('team.actestra.runTeam')}
              </Button>
            </div>
          </div>
        </section>

        <aside className='p-16px'>
          <div className='flex items-center justify-between gap-8px'>
            <h2 className='m-0 text-14px font-600 text-t-primary'>{t('team.actestra.planTitle')}</h2>
            {run && <span className='text-11px text-t-tertiary'>{t('team.actestra.revision', { revision: run.actestra.revision })}</span>}
          </div>
          {error && <div className='mt-12px rounded-8px bg-danger-1 p-10px text-12px text-danger-6'>{t('team.actestra.authorityUnavailable')}</div>}
          {run ? (
            <>
              <Progress className='mt-12px' percent={progress} size='small' />
              <div className='mt-12px flex flex-col gap-10px'>
                {nodes.map((node) => (
                  <article key={node.action_id} data-testid={'actestra-team-node-' + node.action_id} className='rounded-10px border border-solid border-[color:var(--border-base)] p-12px'>
                    <div className='flex items-start justify-between gap-8px'>
                      <div>
                        <div className='text-13px font-600 text-t-primary'>{node.title}</div>
                        <div className='mt-3px text-11px text-t-tertiary'>
                          {node.current_executor} ·{' '}
                          <span data-testid='actestra-team-node-capability'>
                            {t('team.actestra.capability.' + node.capability)}
                          </span>
                        </div>
                      </div>
                      <Tag data-testid='actestra-team-node-status' color={statusColor(node.state)}>
                        {t('team.actestra.nodeState.' + node.state)}
                      </Tag>
                    </div>
                    {node.depends_on_action_ids.length > 0 && <div className='mt-8px text-11px text-t-tertiary'>{t('team.actestra.dependsOn', { count: node.depends_on_action_ids.length })}</div>}
                    {blockedExplanation(node, t) && <div data-testid='actestra-team-blocked-reason' className='mt-8px rounded-8px bg-warning-1 p-8px text-12px text-warning-7'>{blockedExplanation(node, t)}</div>}
                    <ActestraTeamArtifactList artifacts={node.artifacts} label={(artifact) => t('team.actestra.artifactLabel', { label: artifact.label })} onDeliveryChanged={refresh} />
                    {node.state === 'handoff-required' && (
                      <div className='mt-9px rounded-8px bg-fill-1 p-8px' data-testid='actestra-team-handoff'>
                        <Input
                          data-testid='actestra-team-handoff-input'
                          value={handoffContent[node.action_id] ?? ''}
                          maxLength={4096}
                          disabled={busy !== null}
                          placeholder={t('team.actestra.handoffPlaceholder')}
                          onChange={(value) => setHandoffContent((current) => ({ ...current, [node.action_id]: value }))}
                        />
                        <Button
                          className='mt-6px'
                          size='mini'
                          type='primary'
                          loading={busy === node.action_id + '-handoff-completion'}
                          disabled={!(handoffContent[node.action_id] ?? '').trim()}
                          icon={<CheckOne />}
                          onClick={() => void completeHandoff(node)}
                        >
                          {t('team.actestra.handoffComplete')}
                        </Button>
                      </div>
                    )}
                    <div className='mt-9px flex flex-wrap gap-6px'>
                      {node.next_actions.map((action) => (
                        <Button key={action} size='mini' loading={busy === node.action_id + '-' + action} icon={action === 'pause' ? <Pause /> : action === 'resume' || action === 'retry' || action === 'revise' ? <Refresh /> : action === 'handoff' ? <UserToUserTransmission /> : action === 'replace' ? <TransferData /> : action === 'approve' ? <CheckOne /> : action === 'cancel' || action === 'deny' ? <CloseOne /> : undefined} onClick={() => void control(node, action)}>
                          {t('team.actestra.action.' + action)}
                        </Button>
                      ))}
                      {node.capability === 'feedback' && node.blocked_reason === 'human-feedback' && (
                        <>
                          <Button size='mini' loading={busy === 'feedback-approved'} icon={<CheckOne />} onClick={() => void resolveFeedback('approved')}>{t('team.actestra.feedbackContinue')}</Button>
                          <Button size='mini' loading={busy === 'feedback-denied'} icon={<Refresh />} onClick={() => void resolveFeedback('denied')}>{t('team.actestra.feedbackRevise')}</Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {run.actestra.result && (
                <section className='mt-14px rounded-10px border border-solid border-[color:var(--success-3)] bg-success-1 p-12px' data-testid='actestra-team-result'>
                  <h3 className='m-0 text-13px font-600 text-success-7'>{t('team.actestra.resultTitle')}</h3>
                  <p className='m-0 mt-6px text-12px text-t-secondary'>{run.actestra.result.summary}</p>
                  <ActestraTeamArtifactList artifacts={run.actestra.result.artifacts} label={(artifact) => artifact.label} onDeliveryChanged={refresh} />
                </section>
              )}
            </>
          ) : (
            <div className='mt-18px'><Empty description={t('team.actestra.planEmpty')} /></div>
          )}
        </aside>
      </section>
    </div>
    </ChatLayout>
  );
};

const ActestraTeamWorkspace: React.FC<Props> = ({ team }) => {
  const statusMap = useMemo(
    () =>
      new Map(
        team.assistants.map((assistant) => [
          assistant.slot_id,
          {
            slot_id: assistant.slot_id,
            status: assistant.status,
          },
        ]),
      ),
    [team.assistants],
  );

  return (
    <TeamTabsProvider
      assistants={team.assistants}
      statusMap={statusMap}
      defaultActiveSlotId={team.leader_assistant_id || team.assistants[0]?.slot_id || ''}
      team_id={team.id}
    >
      <ActestraTeamWorkspaceContent team={team} />
    </TeamTabsProvider>
  );
};

export default ActestraTeamWorkspace;
`,
);

const teamListPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts";
replaceOnce(
  teamListPath,
  `import { useCallback, useEffect } from 'react';`,
  `import { useCallback, useEffect } from 'react';`,
);
replaceOnce(
  teamListPath,
  `import { removeTeamWithCronCleanup } from '../utils/removeTeamAssistantWithCronCleanup';`,
  `import { removeTeamWithCronCleanup } from '../utils/removeTeamAssistantWithCronCleanup';
import { resolveTeamExperience } from '@/common/adapter/teamMapper';
import {
  isActestraTeamProviderActive,
  listActestraTeams,
  removeActestraTeam,
  removeStandardTeam,
  subscribeActestraTeamEvents,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamListPath,
  `  const { data: teams = [], mutate } = useSWR<TTeam[]>(
    \`teams/\${user_id}\`,
    () => ipcBridge.team.list.invoke({ user_id }),
    { revalidateOnFocus: false }
  );`,
  `  const providerActive = isActestraTeamProviderActive();
  const {
    data: teams = [],
    error: teamProviderError,
    mutate,
  } = useSWR<TTeam[]>(
    \`teams/\${user_id}\`,
    providerActive ? listActestraTeams : () => ipcBridge.team.list.invoke({ user_id }),
    { revalidateOnFocus: false }
  );
  const teamProviderUnavailable = providerActive && teamProviderError !== undefined;`,
);
replaceOnce(
  teamListPath,
  `    const unsubRenamed = ipcBridge.team.renamed.on(() => {
      void mutate();
    });`,
  `    const unsubRenamed = ipcBridge.team.renamed.on(() => {
      void mutate();
    });
    const unsubActestra = subscribeActestraTeamEvents(() => {
      void mutate();
    });`,
);
replaceOnce(
  teamListPath,
  `      unsubRenamed();`,
  `      unsubRenamed();
      unsubActestra();`,
);
replaceOnce(
  teamListPath,
  `      if (team) {
        await removeTeamWithCronCleanup({`,
  `      if (team && resolveTeamExperience(team) === 'orchestrated') {
        await removeActestraTeam(team.id);
      } else if (team && resolveTeamExperience(team) === 'unavailable') {
        throw new Error(team.experience_error ?? 'This Team type is unavailable.');
      } else if (team) {
        await removeTeamWithCronCleanup({`,
);
replaceOnce(
  teamListPath,
  `          removeTeam: (params) => ipcBridge.team.remove.invoke(params),`,
  `          removeTeam: (params) =>
            providerActive ? removeStandardTeam(params.id) : ipcBridge.team.remove.invoke(params),`,
);
replaceOnce(
  teamListPath,
  `      } else {
        await ipcBridge.team.remove.invoke({ id });
      }`,
  `      } else if (providerActive) {
        throw new Error('The Team state changed. Refresh the Team list and try again.');
      } else {
        await ipcBridge.team.remove.invoke({ id });
      }`,
);
replaceOnce(teamListPath, `    [teams, mutate]`, `    [teams, mutate, providerActive]`);
replaceOnce(
  teamListPath,
  `  return { teams, mutate, removeTeam };`,
  `  return { teams, mutate, removeTeam, teamProviderUnavailable };`,
);

const teamListCronCleanupTestPath = "tests/unit/renderer/team/useTeamListCronCleanup.dom.test.tsx";
replaceOnce(
  teamListCronCleanupTestPath,
  `const { getConversationOrNullMock, eventChannel } = vi.hoisted(() => ({
  getConversationOrNullMock: vi.fn(),
  eventChannel: { on: vi.fn(() => () => {}) },
}));`,
  `const { getConversationOrNullMock, eventChannel, standardTeamAuthority } = vi.hoisted(() => ({
  getConversationOrNullMock: vi.fn(),
  eventChannel: { on: vi.fn(() => () => {}) },
  standardTeamAuthority: {
    providerActive: false,
    list: vi.fn(),
    removeStandard: vi.fn(),
    removeOrchestrated: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));`,
);
replaceOnce(
  teamListCronCleanupTestPath,
  `vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({`,
  `vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => standardTeamAuthority.providerActive,
  listActestraTeams: (...args: unknown[]) => standardTeamAuthority.list(...args),
  removeStandardTeam: (...args: unknown[]) => standardTeamAuthority.removeStandard(...args),
  removeActestraTeam: (...args: unknown[]) => standardTeamAuthority.removeOrchestrated(...args),
  subscribeActestraTeamEvents: (...args: unknown[]) => standardTeamAuthority.subscribe(...args),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({`,
);
replaceOnce(
  teamListCronCleanupTestPath,
  `    localStorage.clear();
    vi.mocked(ipcBridge.team.list.invoke).mockResolvedValue([team()]);`,
  `    localStorage.clear();
    standardTeamAuthority.providerActive = false;
    standardTeamAuthority.list.mockResolvedValue([team()]);
    standardTeamAuthority.removeStandard.mockResolvedValue(undefined);
    standardTeamAuthority.removeOrchestrated.mockResolvedValue(undefined);
    vi.mocked(ipcBridge.team.list.invoke).mockResolvedValue([team()]);`,
);
replaceOnce(
  teamListCronCleanupTestPath,
  `  it('removes leader and member cron jobs before removing a team', async () => {`,
  `  it('fails closed before native deletion when a provider-active Team is absent from the current projection', async () => {
    standardTeamAuthority.providerActive = true;
    standardTeamAuthority.list.mockResolvedValue([]);

    const { result } = renderHook(() => useTeamList(), { wrapper: swrWrapper });
    await waitFor(() => expect(standardTeamAuthority.list).toHaveBeenCalledOnce());

    await expect(result.current.removeTeam('team-stale')).rejects.toThrow(
      'The Team state changed. Refresh the Team list and try again.'
    );

    expect(ipcBridge.team.remove.invoke).not.toHaveBeenCalled();
    expect(standardTeamAuthority.removeStandard).not.toHaveBeenCalled();
    expect(standardTeamAuthority.removeOrchestrated).not.toHaveBeenCalled();
  });

  it('removes leader and member cron jobs before removing a team', async () => {`,
);

const teamIndexPath = "packages/desktop/src/renderer/pages/team/index.tsx";
replaceOnce(
  teamIndexPath,
  `import TeamPage from './TeamPage';`,
  `import TeamPage from './TeamPage';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  getActestraTeam,
  isActestraTeamProviderActive,
  isActestraTeamUnavailableError,
  renameStandardTeam,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamIndexPath,
  `  const { data: team, isLoading } = useSWR(id ? \`team/\${id}\` : null, () => ipcBridge.team.get.invoke({ id: id! }));`,
  `  const { t } = useTranslation();
  const { data: team, isLoading, error } = useSWR(id ? \`team/\${id}\` : null, async () => {
    if (!isActestraTeamProviderActive()) return ipcBridge.team.get.invoke({ id: id! });
    return getActestraTeam(id!);
  });`,
);
replaceOnce(
  teamIndexPath,
  `  if (isLoading) return <Spin loading />;
  if (!team) return null;`,
  `  if (isLoading) return <Spin loading />;
  if (error) {
    const messageKey = isActestraTeamUnavailableError(error)
      ? 'team.experience.providerUnavailable'
      : 'team.experience.loadFailed';
    return (
      <main data-testid='team-provider-unavailable' className='h-full flex items-center justify-center p-24px'>
        <div className='max-w-480px text-center'>
          <h2 className='m-0 text-18px font-600 text-t-primary'>{t('team.experience.unavailableTitle')}</h2>
          <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>{t(messageKey)}</p>
        </div>
      </main>
    );
  }
  if (!team) return null;`,
);
replaceOnce(
  teamIndexPath,
  `  return <TeamPage key={team.id} team={team} />;`,
  `  return (
    <TeamPage
      key={team.id}
      team={team}
      standardTeamRename={isActestraTeamProviderActive() ? renameStandardTeam : undefined}
    />
  );`,
);

const teamSiderPath = "packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx";
replaceOnce(
  teamSiderPath,
  `import React, { useCallback, useEffect, useMemo, useState } from 'react';`,
  `import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';`,
);
replaceOnce(
  teamSiderPath,
  `import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';`,
  `import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';
import ActestraTeamCreateModal from '@renderer/pages/team/components/ActestraTeamCreateModal';
import TeamCreateExperienceChooser, { type TeamCreateExperience } from '@renderer/pages/team/components/TeamCreateExperienceChooser';
import {
  isActestraTeamProviderActive,
  renameActestraTeam,
  renameStandardTeam,
} from '@/common/adapter/actestraTeamClient';
import { resolveTeamExperience } from '@/common/adapter/teamMapper';`,
);
replaceOnce(
  teamSiderPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';`,
);
replaceOnce(
  teamSiderPath,
  `  const { teams, mutate: refreshTeams, removeTeam } = useTeamList();`,
  `  const { teams, mutate: refreshTeams, removeTeam, teamProviderUnavailable } = useTeamList();`,
);
replaceOnce(
  teamSiderPath,
  `  const [createTeamVisible, setCreateTeamVisible] = useState(false);`,
  `  const [createChooserVisible, setCreateChooserVisible] = useState(false);
  const [standardCreateVisible, setStandardCreateVisible] = useState(false);
  const [orchestratedCreateVisible, setOrchestratedCreateVisible] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const closeChooser = useCallback(() => {
    setCreateChooserVisible(false);
    requestAnimationFrame(() => createButtonRef.current?.focus());
  }, []);
  const chooseExperience = useCallback((experience: TeamCreateExperience) => {
    setCreateChooserVisible(false);
    if (experience === 'standard') setStandardCreateVisible(true);
    else setOrchestratedCreateVisible(true);
  }, []);`,
);
replaceOnce(
  teamSiderPath,
  `      await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });`,
  `      const team = teams.find((candidate) => candidate.id === renameId);
      if (team && resolveTeamExperience(team) === 'orchestrated') {
        await renameActestraTeam(renameId, renameName.trim());
      } else if (team && resolveTeamExperience(team) === 'unavailable') {
        throw new Error(team.experience_error ?? 'This Team type is unavailable.');
      } else if (team && isActestraTeamProviderActive()) {
        await renameStandardTeam(renameId, renameName.trim());
      } else if (isActestraTeamProviderActive()) {
        throw new Error('The Team state changed. Refresh the Team list and try again.');
      } else {
        await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });
      }`,
);
replaceOnce(
  teamSiderPath,
  `  }, [globalMutate, refreshTeams, renameId, renameName, t]);`,
  `  }, [globalMutate, refreshTeams, renameId, renameName, t, teams]);`,
);
replaceOnce(
  teamSiderPath,
  `  const sortedTeams = useMemo(() => {`,
  `  const handleTeamCreated = useCallback((team: TTeam) => {
    void refreshTeams(
      (current) => {
        const previous = current ?? [];
        return previous.some((candidate) => candidate.id === team.id)
          ? previous.map((candidate) => candidate.id === team.id ? team : candidate)
          : [...previous, team];
      },
      { revalidate: true },
    );
    Promise.resolve(navigate(\`/team/\${team.id}\`)).catch(console.error);
  }, [navigate, refreshTeams]);

  const sortedTeams = useMemo(() => {`,
);
replaceOnce(
  teamSiderPath,
  `            <Tooltip content={t('team.sider.createTeam')} position='top'>
              <div
                data-testid='team-create-btn'
                className='ml-auto -mr-4px size-20px rd-4px flex items-center justify-center hover:bg-fill-4 transition-all shrink-0 cursor-pointer text-t-secondary hover:text-t-primary'
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateTeamVisible(true);
                }}
              >
                <Plus
                  theme='outline'
                  size='14'
                  fill='currentColor'
                  className='block leading-none'
                  style={{ lineHeight: 0 }}
                />
              </div>
            </Tooltip>`,
  `            <TeamCreateExperienceChooser
              visible={createChooserVisible}
              onVisibleChange={(visible) => {
                setCreateChooserVisible(visible);
                if (!visible) closeChooser();
              }}
              onChoose={chooseExperience}
              anchor={
                <Tooltip content={t('team.sider.createTeam')} position='top'>
                  <button
                    ref={createButtonRef}
                    type='button'
                    data-testid='team-create-btn'
                    aria-label={t('team.sider.createTeam')}
                    className='ml-auto -mr-4px size-20px rd-4px border-0 bg-transparent flex items-center justify-center hover:bg-fill-4 transition-all shrink-0 cursor-pointer text-t-secondary hover:text-t-primary'
                    onClick={(event) => {
                      event.stopPropagation();
                      setCreateChooserVisible(true);
                    }}
                  >
                    <Plus theme='outline' size='14' fill='currentColor' className='block leading-none' style={{ lineHeight: 0 }} />
                  </button>
                </Tooltip>
              }
            />`,
);
replaceOnce(
  teamSiderPath,
  `      <TeamCreateModal
        visible={createTeamVisible}
        onClose={() => setCreateTeamVisible(false)}`,
  `      <TeamCreateModal
        visible={standardCreateVisible}
        onClose={() => setStandardCreateVisible(false)}`,
);
replaceOnce(
  teamSiderPath,
  `          </div>
          {expanded &&
            sortedTeams.length > 0 &&`,
  `          </div>
          {teamProviderUnavailable && (
            <div
              data-testid='actestra-team-provider-unavailable'
              role='status'
              className='mx-12px rounded-6px bg-warning-1 px-8px py-6px text-11px leading-16px text-warning-7'
            >
              {t('team.experience.providerUnavailable')}
            </div>
          )}
          {expanded &&
            sortedTeams.length > 0 &&`,
);
replaceOnce(
  teamSiderPath,
  `      />
      <Modal
        title={t('team.sider.renameTitle')}`,
  `      />
      <ActestraTeamCreateModal
        visible={orchestratedCreateVisible}
        onClose={() => setOrchestratedCreateVisible(false)}
        onCreated={(team) => {
          void refreshTeams();
          Promise.resolve(navigate(\`/team/\${team.id}\`)).catch(console.error);
        }}
      />
      <Modal
        title={t('team.sider.renameTitle')}`,
);
replaceExactCount(
  teamSiderPath,
  `        onCreated={(team) => {
          void refreshTeams();
          Promise.resolve(navigate(\`/team/\${team.id}\`)).catch(console.error);
        }}`,
  `        onCreated={handleTeamCreated}`,
  2,
);

replaceOnce(
  "tests/unit/bootstrap/buildWithBuilder.test.ts",
  `    ensurePlaceholder('out/main/index.js');`,
  `    ensurePlaceholder('out/main/index.js');
    ensurePlaceholder('out/main/actestra-team-planner.js');`,
);

const teamSiderDomTestPath = "tests/unit/renderer/layout/TeamSiderSection.dom.test.tsx";
replaceOnce(
  teamSiderDomTestPath,
  `vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: fixtures.globalMutate }) }));`,
  `vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: fixtures.globalMutate }),
}));
vi.mock('@renderer/pages/team/components/ActestraTeamCreateModal', () => ({ default: () => null }));
vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => false,
  renameActestraTeam: vi.fn(),
  renameStandardTeam: vi.fn(),
  createActestraTeam: vi.fn(),
  listActestraTeamModelOptions: vi.fn(),
  listActestraTeamWorkspaceOptions: vi.fn(),
  selectActestraTeamWorkspace: vi.fn(),
}));`,
);
replaceOnce(
  teamSiderDomTestPath,
  `    Pushpin: icon('Pushpin'),
    Right: icon('Right'),`,
  `    Pushpin: icon('Pushpin'),
    Right: icon('Right'),
    BranchOne: icon('BranchOne'),
    Close: icon('Close'),
    FolderOpen: icon('FolderOpen'),`,
);
replaceOnce(
  teamSiderDomTestPath,
  `    Input: () => null,
    Message: { success: vi.fn(), error: vi.fn() },
    Modal,`,
  `    Input: () => null,
    Message: { success: vi.fn(), error: vi.fn() },
    Modal,
    Popover: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/utils/conversationCache.ts",
  `export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  try {`,
  `/** Actestra Team member conversations are Main-owned, so AionCore never holds one and a lookup is always 404. */
const ACTESTRA_TEAM_CONVERSATION_PREFIX = 'actestra-team-conversation-';

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  if (conversation_id.startsWith(ACTESTRA_TEAM_CONVERSATION_PREFIX)) return null;
  try {`,
);
replaceOnce(
  "tests/unit/renderer/utils/conversationCache.test.ts",
  `    it('returns the conversation when the backend lookup succeeds', async () => {`,
  `    it('skips the backend lookup for Main-owned Actestra Team member conversations', async () => {
      await expect(getConversationOrNull('actestra-team-conversation-' + 'a'.repeat(64))).resolves.toBeNull();

      expect(ipcBridge.conversation.get.invoke).not.toHaveBeenCalled();
    });

    it('returns the conversation when the backend lookup succeeds', async () => {`,
);

const teamPagePath = "packages/desktop/src/renderer/pages/team/TeamPage.tsx";
replaceOnce(
  teamPagePath,
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: Boolean(conversation_id),`,
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    setConfigOption: teamPermission?.setConfigOption,
    enabled: Boolean(conversation_id),`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: true,`,
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    setConfigOption: teamPermission?.setConfigOption,
    enabled: true,`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: isMobile,`,
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    setConfigOption: teamPermission?.setConfigOption,
    enabled: isMobile,`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: Boolean(conversation_id),`,
  `    loadConfigOptions: teamPermission?.loadConfigOptions,
    setConfigOption: teamPermission?.setConfigOption,
    enabled: Boolean(conversation_id),`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        if (isLeaderInTeam) teamPermission?.propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));`,
  `      try {
        if (isLeaderInTeam && teamPermission?.propagateMode) {
          await teamPermission.propagateMode(mode);
        } else {
          await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        }
        setCurrentMode(mode);
        Message.success(t('agentMode.switchSuccess'));`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  `      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));`,
  `      try {
        if (propagateMode) {
          await propagateMode(mode);
        } else {
          await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        }
        setCurrentMode(mode);
        Message.success(t('agentMode.switchSuccess'));`,
);
const acpSendBoxDomTestPath = "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx";
replaceOnce(
  acpSendBoxDomTestPath,
  `vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
}));`,
  `vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
  useRemoveMessageByMsgId: () => vi.fn(),
}));`,
);
replaceOnce(
  acpSendBoxDomTestPath,
  `vi.mock('@arco-design/web-react', () => ({
  Message: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));`,
  `vi.mock('@arco-design/web-react', () => {
  const Select = Object.assign(() => null, {
    Option: () => null,
    OptGroup: () => null,
  });
  return {
    Message: {
      success: vi.fn(),
      error: vi.fn(),
    },
    Select,
    Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});`,
);
replaceOnce(
  acpSendBoxDomTestPath,
  `  it('applies runtime thought level from the mobile action sheet without persisting a global preference', async () => {`,
  `  it('routes a mobile leader mode through Team authority without a direct member config effect', async () => {
    isMobileMock.current = true;
    const setConfigOption = vi.fn();
    const propagateMode = vi.fn().mockRejectedValue(new Error('team mode rejected'));
    useAcpConfigOptionsMock.mockReturnValue({
      mode: {
        id: 'mode',
        category: 'mode',
        currentValue: 'plan',
        options: [
          { value: 'plan', label: 'Plan' },
          { value: 'default', label: 'Ask before effects' },
        ],
      },
      model: null,
      thoughtLevel: null,
      setStatus: { state: 'idle' },
      setConfigOption,
      reload: vi.fn(),
      isLoading: false,
      configOptions: [],
    });
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode,
      warmupSession: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <AcpSendBox
        conversation_id='conv-1'
        backend='claude'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      mobileActionSheetEntries.current
        .find((entry) => entry.key === 'permission')
        ?.submenu?.onSelect?.('default');
      await Promise.resolve();
    });

    await waitFor(() => expect(propagateMode).toHaveBeenCalledWith('default'));
    expect(setConfigOption).not.toHaveBeenCalled();
  });

  it('applies runtime thought level from the mobile action sheet without persisting a global preference', async () => {`,
);
replaceOnce(
  teamPagePath,
  `import { usePreviewContext } from '@/renderer/pages/conversation/Preview';`,
  `import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { resolveTeamExperience } from '@/common/adapter/teamMapper';
import ActestraTeamWorkspace from './components/ActestraTeamWorkspace';`,
);
replaceOnce(
  teamPagePath,
  `type Props = {
  team: TTeam;
};`,
  `type Props = {
  team: TTeam;
  standardTeamRename?: (teamId: string, name: string) => Promise<TTeam>;
};`,
);
replaceOnce(
  teamPagePath,
  `        await ipcBridge.team.renameTeam.invoke({ id: team.id, name: new_name });`,
  `        if (standardTeamRename) {
          await standardTeamRename(team.id, new_name);
        } else {
          await ipcBridge.team.renameTeam.invoke({ id: team.id, name: new_name });
        }`,
);
replaceOnce(
  teamPagePath,
  `const TeamPage: React.FC<Props> = ({ team }) => {`,
  `const NativeTeamPage: React.FC<Props> = ({ team, standardTeamRename }) => {`,
);
replaceOnce(
  teamPagePath,
  `export default TeamPage;`,
  `const TeamPage: React.FC<Props> = ({ team, standardTeamRename }) => {
  const { t } = useTranslation();
  if (resolveTeamExperience(team) === 'orchestrated') {
    return <ActestraTeamWorkspace team={team} />;
  }
  if (resolveTeamExperience(team) === 'standard') {
    return <NativeTeamPage team={team} standardTeamRename={standardTeamRename} />;
  }
  return (
    <main data-testid='team-experience-unavailable' className='h-full flex items-center justify-center p-24px'>
      <div className='max-w-480px text-center'>
        <h2 className='m-0 text-18px font-600 text-t-primary'>{t('team.experience.unavailableTitle')}</h2>
        <p className='m-0 mt-8px text-13px leading-20px text-t-secondary'>
          {t(team.experience_error ?? 'team.experience.unavailableDescription')}
        </p>
      </div>
    </main>
  );
};

export default TeamPage;`,
);

const teamSendRuntimePath =
  "packages/desktop/src/renderer/pages/team/components/teamSendRuntime.ts";
replaceOnce(
  teamSendRuntimePath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import { attachStandardTeamMember, isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamSendRuntimePath,
  `  async () => {
    await ipcBridge.team.attachAgent.invoke({ team_id, slot_id });
  };`,
  `  async () => {
    if (isActestraTeamProviderActive()) {
      await attachStandardTeamMember({ teamId: team_id, slotId: slot_id });
      return;
    }
    await ipcBridge.team.attachAgent.invoke({ team_id, slot_id });
  };`,
);
const teamSendRuntimeTestPath = "tests/unit/renderer/teamSendRuntime.test.ts";
replaceOnce(
  teamSendRuntimeTestPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import { attachStandardTeamMember } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamSendRuntimeTestPath,
  `vi.mock('@/common', () => ({
  ipcBridge: { team: { attachAgent: { invoke: vi.fn(() => Promise.resolve()) } } },
}));`,
  `const standardTeamAuthorityMocks = vi.hoisted(() => ({
  providerActive: true,
  attachStandardTeamMember: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common', () => ({
  ipcBridge: { team: { attachAgent: { invoke: vi.fn(() => Promise.resolve()) } } },
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => standardTeamAuthorityMocks.providerActive,
  attachStandardTeamMember: standardTeamAuthorityMocks.attachStandardTeamMember,
}));`,
);
replaceOnce(
  teamSendRuntimeTestPath,
  `describe('buildTeamRetryStartHandler', () => {
  it('invokes the directed per-member attach route (not warmupSession)', async () => {
    const invoke = vi.mocked(ipcBridge.team.attachAgent.invoke);
    invoke.mockClear();
    await buildTeamRetryStartHandler({ team_id: 't1', slot_id: 's2' })();
    expect(invoke).toHaveBeenCalledWith({ team_id: 't1', slot_id: 's2' });
  });
});`,
  `describe('buildTeamRetryStartHandler', () => {
  it('routes provider-active retry through the Main-owned standard-Team attach projection', async () => {
    standardTeamAuthorityMocks.providerActive = true;
    standardTeamAuthorityMocks.attachStandardTeamMember.mockClear();
    const invoke = vi.mocked(ipcBridge.team.attachAgent.invoke);
    invoke.mockClear();

    await buildTeamRetryStartHandler({ team_id: 't1', slot_id: 's2' })();

    expect(attachStandardTeamMember).toHaveBeenCalledWith({ teamId: 't1', slotId: 's2' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('retains the native attach route when the Actestra provider is absent', async () => {
    standardTeamAuthorityMocks.providerActive = false;
    standardTeamAuthorityMocks.attachStandardTeamMember.mockClear();
    const invoke = vi.mocked(ipcBridge.team.attachAgent.invoke);
    invoke.mockClear();

    await buildTeamRetryStartHandler({ team_id: 't1', slot_id: 's2' })();

    expect(invoke).toHaveBeenCalledWith({ team_id: 't1', slot_id: 's2' });
    expect(attachStandardTeamMember).not.toHaveBeenCalled();
  });
});`,
);
replaceOnce(
  teamSendRuntimePath,
  `  onRetryStart?: () => Promise<void>;
};`,
  `  onRetryStart?: () => Promise<void>;
  slowResponse: boolean;
  onCancelSlowResponse?: () => Promise<void>;
  onRetrySlowResponse?: () => Promise<void>;
  onAddTeamMember?: () => void;
};`,
);
replaceOnce(
  teamSendRuntimePath,
  `  sessionStopped?: boolean;
};`,
  `  sessionStopped?: boolean;
  onCancelSlowResponse?: () => Promise<void>;
  onRetrySlowResponse?: () => Promise<void>;
  onAddTeamMember?: () => void;
};`,
);
replaceOnce(
  teamSendRuntimePath,
  `  processingWithQueued: (count: number) => string;
  runtimeStarting: () => string;`,
  `  processingWithQueued: (count: number) => string;
  slowResponse: () => string;
  runtimeStarting: () => string;`,
);
replaceOnce(
  teamSendRuntimePath,
  `const hasActiveTeamWork = (work?: ITeamSlotWork): boolean => work?.state === 'starting' || work?.state === 'running';`,
  `const hasActiveTeamWork = (work?: ITeamSlotWork): boolean => work?.state === 'starting' || work?.state === 'running';

export const isTeamTurnSlow = (work?: ITeamSlotWork, nowMs = Date.now()): boolean => {
  if (work?.active_turn_slow === true) return true;
  if (
    !work?.active_turn_id ||
    typeof work.active_turn_started_at_ms !== 'number' ||
    typeof work.active_turn_slow_threshold_ms !== 'number' ||
    work.active_turn_slow_threshold_ms <= 0
  ) {
    return false;
  }
  return nowMs >= work.active_turn_started_at_ms + work.active_turn_slow_threshold_ms;
};`,
);
replaceOnce(
  teamSendRuntimePath,
  `  const queuedCount = getTeamWorkQueuedCount(work);
  if (hasActiveTeamWork(work)) {`,
  `  if (isTeamTurnSlow(work)) {
    return format.slowResponse();
  }

  const queuedCount = getTeamWorkQueuedCount(work);
  if (hasActiveTeamWork(work)) {`,
);
replaceOnce(
  teamSendRuntimePath,
  `  onStop,
  sessionStopped,
}: BuildTeamSendRuntimeOptions): TeamSendBoxRuntime => {`,
  `  onStop,
  sessionStopped,
  onCancelSlowResponse,
  onRetrySlowResponse,
  onAddTeamMember,
}: BuildTeamSendRuntimeOptions): TeamSendBoxRuntime => {`,
);
replaceOnce(
  teamSendRuntimePath,
  `  return {
    loading,
    queuedCount,
    statusText,`,
  `  return {
    loading,
    queuedCount,
    statusText,
    slowResponse: isTeamTurnSlow(work),
    onCancelSlowResponse,
    onRetrySlowResponse,
    onAddTeamMember,`,
);

const thoughtDisplayPath = "packages/desktop/src/renderer/components/chat/ThoughtDisplay.tsx";
replaceOnce(
  thoughtDisplayPath,
  `  onRetryStart?: () => void;
  // Absolute start timestamp (ms) supplied by an external source (e.g. team slot work).`,
  `  onRetryStart?: () => void;
  slowResponse?: boolean;
  onCancelSlowResponse?: () => void;
  onRetrySlowResponse?: () => void;
  onAddTeamMember?: () => void;
  // Absolute start timestamp (ms) supplied by an external source (e.g. team slot work).`,
);
replaceOnce(
  thoughtDisplayPath,
  `  onRetryStart,
  startedAtMs,`,
  `  onRetryStart,
  slowResponse = false,
  onCancelSlowResponse,
  onRetrySlowResponse,
  onAddTeamMember,
  startedAtMs,`,
);
replaceOnce(
  thoughtDisplayPath,
  `        {onRetryStart && (
          <Button className='flex-shrink-0' size='mini' type='text' onClick={onRetryStart}>
            {t('team.work.retryStart', { defaultValue: 'Retry start' })}
          </Button>
        )}`,
  `        {onRetryStart && (
          <Button className='flex-shrink-0' size='mini' type='text' onClick={onRetryStart}>
            {t('team.work.retryStart', { defaultValue: 'Retry start' })}
          </Button>
        )}
        {slowResponse && (
          <div className='flex flex-shrink-0 items-center gap-4px' data-testid='team-slow-response-actions'>
            {onCancelSlowResponse && (
              <Button size='mini' type='text' onClick={onCancelSlowResponse}>
                {t('team.work.cancelResponse', { defaultValue: 'Cancel response' })}
              </Button>
            )}
            {onRetrySlowResponse && (
              <Button size='mini' type='text' onClick={onRetrySlowResponse}>
                {t('team.work.retryRequest', { defaultValue: 'Retry request' })}
              </Button>
            )}
            {onAddTeamMember && (
              <Button size='mini' type='text' onClick={onAddTeamMember}>
                {t('team.addMember.title', { defaultValue: 'Add member' })}
              </Button>
            )}
          </div>
        )}`,
);

const teamChatViewPath = "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx";
replaceOnce(
  teamChatViewPath,
  `import { resolveConversationBackend } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';`,
  `import { resolveConversationBackend } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import {
  cancelStandardTeamMemberWork,
  isActestraTeamProviderActive,
  pauseStandardTeamMemberWork,
  sendStandardTeamMemberMessage,
  sendStandardTeamMessage,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamChatViewPath,
  `  const teamSendMessage = useCallback<TeamSendOverride>(
    async ({ input, files }) => {
      if (!team_id) throw new Error('Missing team id for team send');
      if (isLeader) {
        const ack = await ipcBridge.team.sendMessage.invoke({ team_id, input, files });
        onTeamRunAck?.(ack);
        return;
      }
      if (!slot_id) throw new Error('Missing slot id for team agent send');
      const ack = await ipcBridge.team.sendMessageToAgent.invoke({ team_id, slot_id, input, files });
      onTeamRunAck?.(ack);
    },
    [isLeader, onTeamRunAck, slot_id, team_id]
  );`,
  `  const teamSendMessage = useCallback<TeamSendOverride>(
    async ({ input, files }) => {
      if (!team_id) throw new Error('Missing team id for team send');
      if (isActestraTeamProviderActive()) {
        const targetSlotId = isLeader ? null : (slot_id ?? null);
        if (!isLeader && targetSlotId === null) throw new Error('Missing slot id for team agent send');
        const requestNonce = await reserveTeamRequestNonce({
          conversationId: conversation.id,
          teamId: team_id,
          slotId: targetSlotId,
          content: input,
          files,
        });
        try {
          const ack = isLeader
            ? await sendStandardTeamMessage({ teamId: team_id, content: input, files, requestNonce })
            : await sendStandardTeamMemberMessage({
                teamId: team_id,
                slotId: targetSlotId!,
                content: input,
                files,
                requestNonce,
              });
          clearTeamRequestNonce(conversation.id, targetSlotId, requestNonce);
          onTeamRunAck?.(ack);
          return;
        } catch (error) {
          throw error;
        }
      }
      if (isLeader) {
        const ack = await ipcBridge.team.sendMessage.invoke({ team_id, input, files });
        onTeamRunAck?.(ack);
        return;
      }
      if (!slot_id) throw new Error('Missing slot id for team agent send');
      const ack = await ipcBridge.team.sendMessageToAgent.invoke({ team_id, slot_id, input, files });
      onTeamRunAck?.(ack);
    },
    [conversation.id, isLeader, onTeamRunAck, slot_id, team_id]
  );`,
);
replaceOnce(
  teamChatViewPath,
  `import React, { Suspense, useCallback } from 'react';`,
  `import React, { Suspense, useCallback, useRef } from 'react';`,
);
replaceOnce(
  teamChatViewPath,
  `const EMPTY_TEAM_RUN_VIEW: TeamRunViewState = {
  activeRun: undefined,
  childTurnsBySlot: {},
  slotWorkBySlot: {},
  sessionStopped: false,
};`,
  `const EMPTY_TEAM_RUN_VIEW: TeamRunViewState = {
  activeRun: undefined,
  childTurnsBySlot: {},
  slotWorkBySlot: {},
  sessionStopped: false,
};

const readLastPersistedTeamRequest = async (conversation_id: string): Promise<string | undefined> => {
  const page = await ipcBridge.database.getConversationMessages.invoke({
    conversation_id,
    limit: 50,
    content_mode: 'full',
  });
  for (let index = page.items.length - 1; index >= 0; index -= 1) {
    const message = page.items[index];
    if (message?.type !== 'text' || message.position !== 'right') continue;
    const input = message.content.content.trim();
    if (input) return input;
  }
  return undefined;
};

type PersistedTeamRequestNonce = { fingerprint: string; nonce: string };

const teamRequestNonceStorageKey = (conversationId: string, slotId: string | null): string =>
  'actestra.standard-team-request.' + conversationId + '.' + (slotId ?? 'leader');

const teamRequestFingerprint = async (input: {
  teamId: string;
  slotId: string | null;
  content: string;
  files: string[];
}): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify([input.teamId, input.slotId, input.content, input.files]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
};

const reserveTeamRequestNonce = async (input: {
  conversationId: string;
  teamId: string;
  slotId: string | null;
  content: string;
  files: string[];
}): Promise<string> => {
  const key = teamRequestNonceStorageKey(input.conversationId, input.slotId);
  const fingerprint = await teamRequestFingerprint(input);
  const encoded = window.localStorage.getItem(key);
  if (encoded) {
    try {
      const stored = JSON.parse(encoded) as Partial<PersistedTeamRequestNonce>;
      if (
        stored.fingerprint === fingerprint &&
        typeof stored.nonce === 'string' &&
        /^team-request-[a-f0-9]{64}$/.test(stored.nonce)
      ) {
        return stored.nonce;
      }
      if (typeof stored.fingerprint === 'string' && typeof stored.nonce === 'string') {
        throw new Error('A previous Standard Team message outcome is unresolved');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('outcome is unresolved')) throw error;
    }
  }
  const nonce =
    'team-request-' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
  window.localStorage.setItem(key, JSON.stringify({ fingerprint, nonce } satisfies PersistedTeamRequestNonce));
  return nonce;
};

const clearTeamRequestNonce = (conversationId: string, slotId: string | null, nonce: string): void => {
  const key = teamRequestNonceStorageKey(conversationId, slotId);
  const encoded = window.localStorage.getItem(key);
  if (!encoded) return;
  try {
    const stored = JSON.parse(encoded) as Partial<PersistedTeamRequestNonce>;
    if (stored.nonce === nonce) window.localStorage.removeItem(key);
  } catch {
    window.localStorage.removeItem(key);
  }
};`,
);
replaceOnce(
  teamChatViewPath,
  `  onTeamRunAck?: (ack: ITeamRunAck) => void;
  onRunStateStale?: () => Promise<boolean>;
};`,
  `  onTeamRunAck?: (ack: ITeamRunAck) => void;
  onRunStateStale?: () => Promise<boolean>;
  onRequestAddMember?: () => void;
};`,
);
replaceOnce(
  teamChatViewPath,
  `  onTeamRunAck,
  onRunStateStale,
}) => {`,
  `  onTeamRunAck,
  onRunStateStale,
  onRequestAddMember,
}) => {`,
);
replaceOnce(
  teamChatViewPath,
  `        processingWithQueued: (count) =>
          t('team.work.processingWithQueued', {
            count,
            defaultValue: \`Processing… \${count} queued\`,
          }),
        runtimeStarting: () => t('team.work.runtimeStarting', { defaultValue: 'Waiting for this assistant to start…' }),`,
  `        processingWithQueued: (count) =>
          t('team.work.processingWithQueued', {
            count,
            defaultValue: \`Processing… \${count} queued\`,
          }),
        slowResponse: () =>
          t('team.work.slowResponse', {
            defaultValue: 'This assistant has not produced a reply or tool call yet.',
          }),
        runtimeStarting: () => t('team.work.runtimeStarting', { defaultValue: 'Waiting for this assistant to start…' }),`,
);
replaceOnce(
  teamChatViewPath,
  `  const isRuntimeFailed = slot_id ? slotWork?.blocked_reason === 'runtime_failed' : false;
  const teamRuntime =`,
  `  const isRuntimeFailed = slot_id ? slotWork?.blocked_reason === 'runtime_failed' : false;
  const slowRecoveryBusyRef = useRef(false);
  const activeSlowRunId = slotWork?.team_run_id ?? teamRunView.activeRun?.team_run_id;
  const handleCancelSlowResponse = useCallback(async () => {
    if (!team_id || !slot_id || !activeSlowRunId || slowRecoveryBusyRef.current) {
      if (!slowRecoveryBusyRef.current) {
        Message.error(
          t('team.work.slowRecoveryUnavailable', {
            defaultValue: 'This response can no longer be recovered. Refresh the Team state and try again.',
          })
        );
      }
      return;
    }
    slowRecoveryBusyRef.current = true;
    try {
      if (isActestraTeamProviderActive()) {
        await cancelStandardTeamMemberWork({
          teamId: team_id,
          runId: activeSlowRunId,
          slotId: slot_id,
          reason: 'slow_response',
        });
      } else {
        await ipcBridge.team.cancelChildTurn.invoke({
          team_id,
          team_run_id: activeSlowRunId,
          slot_id,
          reason: 'slow_response',
        });
      }
      await onRunStateStale?.();
    } catch (error) {
      console.warn('[TeamChatView] slow response cancellation failed', error);
      Message.error(
        t('team.work.cancelResponseFailed', {
          defaultValue: 'Failed to cancel this response. Please try again.',
        })
      );
    } finally {
      slowRecoveryBusyRef.current = false;
    }
  }, [activeSlowRunId, onRunStateStale, slot_id, t, team_id]);
  const handleRetrySlowResponse = useCallback(async () => {
    if (!team_id || !slot_id || !activeSlowRunId || slowRecoveryBusyRef.current) {
      if (!slowRecoveryBusyRef.current) {
        Message.error(
          t('team.work.slowRecoveryUnavailable', {
            defaultValue: 'This response can no longer be recovered. Refresh the Team state and try again.',
          })
        );
      }
      return;
    }
    slowRecoveryBusyRef.current = true;
    let cancelled = false;
    try {
      const input = await readLastPersistedTeamRequest(conversation.id);
      if (!input) {
        Message.error(
          t('team.work.retryUnavailable', {
            defaultValue: 'The original request is unavailable. Enter it again in the message box.',
          })
        );
        return;
      }
      const providerActive = isActestraTeamProviderActive();
      const requestNonce = providerActive
        ? await reserveTeamRequestNonce({
            conversationId: conversation.id,
            teamId: team_id,
            slotId: slot_id,
            content: input,
            files: [],
          })
        : null;
      if (providerActive) {
        await cancelStandardTeamMemberWork({
          teamId: team_id,
          runId: activeSlowRunId,
          slotId: slot_id,
          reason: 'slow_response',
        });
      } else {
        await ipcBridge.team.cancelChildTurn.invoke({
          team_id,
          team_run_id: activeSlowRunId,
          slot_id,
          reason: 'slow_response',
        });
      }
      cancelled = true;
      const ack = providerActive
        ? await sendStandardTeamMemberMessage({
            teamId: team_id,
            slotId: slot_id,
            content: input,
            files: [],
            requestNonce: requestNonce!,
          })
        : await ipcBridge.team.sendMessageToAgent.invoke({ team_id, slot_id, input, files: [] });
      if (providerActive) clearTeamRequestNonce(conversation.id, slot_id, requestNonce!);
      onTeamRunAck?.(ack);
    } catch (error) {
      if (cancelled) await onRunStateStale?.();
      console.warn('[TeamChatView] slow response retry failed', error);
      Message.error(
        t('team.work.retryRequestFailed', {
          defaultValue: 'Failed to retry this request. The previous response was cancelled.',
        })
      );
    } finally {
      slowRecoveryBusyRef.current = false;
    }
  }, [activeSlowRunId, conversation.id, onRunStateStale, onTeamRunAck, slot_id, t, team_id]);
  const teamRuntime =`,
);
replaceOnce(
  teamChatViewPath,
  `            onStop: buildTeamStopHandler({
              team_id,
              slot_id,
              runView: teamRunView,
              pauseSlotWork: (params) => ipcBridge.team.pauseSlotWork.invoke(params),`,
  `            onStop: buildTeamStopHandler({
              team_id,
              slot_id,
              runView: teamRunView,
              pauseSlotWork: isActestraTeamProviderActive()
                ? ({ team_id, team_run_id, slot_id, reason }) =>
                    pauseStandardTeamMemberWork({
                      teamId: team_id,
                      runId: team_run_id,
                      slotId: slot_id,
                      reason,
                    })
                : (params) => ipcBridge.team.pauseSlotWork.invoke(params),`,
);
replaceOnce(
  teamChatViewPath,
  `              onRunStateStale,
            }),
          }),`,
  `              onRunStateStale,
            }),
            onCancelSlowResponse: handleCancelSlowResponse,
            onRetrySlowResponse: handleRetrySlowResponse,
            onAddTeamMember: onRequestAddMember,
          }),`,
);

for (const sendBoxPath of [
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
]) {
  replaceOnce(
    sendBoxPath,
    `        onRetryStart={teamRuntime?.onRetryStart ? () => void teamRuntime.onRetryStart?.() : undefined}
      />`,
    `        onRetryStart={teamRuntime?.onRetryStart ? () => void teamRuntime.onRetryStart?.() : undefined}
        slowResponse={teamRuntime?.slowResponse}
        onCancelSlowResponse={
          teamRuntime?.onCancelSlowResponse ? () => void teamRuntime.onCancelSlowResponse?.() : undefined
        }
        onRetrySlowResponse={
          teamRuntime?.onRetrySlowResponse ? () => void teamRuntime.onRetrySlowResponse?.() : undefined
        }
        onAddTeamMember={teamRuntime?.onAddTeamMember}
      />`,
  );
}

const teamRunViewPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamRunView.ts";
replaceOnce(
  teamRunViewPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import {
  getStandardTeamRunState,
  isActestraTeamProviderActive,
  subscribeActestraTeamEvents,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamRunViewPath,
  `        const snapshot = await ipcBridge.team.getRunState.invoke({ team_id });`,
  `        const snapshot = isActestraTeamProviderActive()
          ? await getStandardTeamRunState(team_id)
          : await ipcBridge.team.getRunState.invoke({ team_id });`,
);
const teamRunViewTestPath = "tests/unit/renderer/useTeamRunView.dom.test.tsx";
replaceOnce(
  teamRunViewTestPath,
  `vi.mock('@/common', () => ({`,
  `const standardTeamAuthorityMocks = vi.hoisted(() => ({
  active: vi.fn(() => false),
  getRunState: vi.fn(),
  handler: null as ((event: unknown) => void) | null,
  unsubscribe: vi.fn(),
  subscribe: vi.fn((handler: (event: unknown) => void) => {
    standardTeamAuthorityMocks.handler = handler;
    return standardTeamAuthorityMocks.unsubscribe;
  }),
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: standardTeamAuthorityMocks.active,
  getStandardTeamRunState: standardTeamAuthorityMocks.getRunState,
  subscribeActestraTeamEvents: (handler: (event: unknown) => void) => standardTeamAuthorityMocks.subscribe(handler),
}));

vi.mock('@/common', () => ({`,
);
replaceOnce(
  teamRunViewTestPath,
  `  beforeEach(() => {
    vi.clearAllMocks();
    teamEventMocks.invoke.getRunState.mockResolvedValue({`,
  `  beforeEach(() => {
    vi.clearAllMocks();
    standardTeamAuthorityMocks.active.mockReturnValue(false);
    standardTeamAuthorityMocks.getRunState.mockResolvedValue({
      session_generation: null,
      active_run: null,
      slot_work: [],
    });
    standardTeamAuthorityMocks.handler = null;
    teamEventMocks.invoke.getRunState.mockResolvedValue({`,
);
replaceOnce(
  teamRunViewTestPath,
  `  it('ack_applies_the_exact_core_run_snapshot', () => {`,
  `  it('reconciles provider-active standard Team state through Actestra Main', async () => {
    standardTeamAuthorityMocks.active.mockReturnValue(true);
    standardTeamAuthorityMocks.getRunState.mockResolvedValue({
      session_generation: 'native-session-1',
      active_run: runEvent(),
      slot_work: [slotWork('lead', { state: 'running', team_run_id: 'run-1' })],
    });

    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(result.current.state.activeRun?.team_run_id).toBe('run-1'));

    expect(standardTeamAuthorityMocks.getRunState).toHaveBeenCalledWith('team-1');
    expect(teamEventMocks.invoke.getRunState).not.toHaveBeenCalled();
  });

  it.each([
    ['runStarted', runEvent({ status: 'running' })],
    ['slotWorkChanged', { team_id: 'team-1', slot_work: slotWork('lead', { state: 'running' }) }],
  ] as const)('reconciles provider-active native %s hints through Actestra Main', async (channel, event) => {
    standardTeamAuthorityMocks.active.mockReturnValue(true);
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(standardTeamAuthorityMocks.getRunState).toHaveBeenCalledTimes(1));

    act(() => {
      const handler = teamEventMocks.handlers[channel] as (value: typeof event) => void;
      handler(event);
    });

    await waitFor(() => expect(standardTeamAuthorityMocks.getRunState).toHaveBeenCalledTimes(2));
    expect(result.current.state.activeRun).toBeUndefined();
    expect(result.current.state.slotWorkBySlot).toEqual({});
    expect(teamEventMocks.invoke.getRunState).not.toHaveBeenCalled();
  });

  it.each([
    ['team.runStarted', runEvent({ status: 'running' })],
    ['team.slotWorkChanged', { team_id: 'team-1', slot_work: slotWork('lead', { state: 'running' }) }],
  ] as const)('applies provider-active %s events from Actestra Main directly', async (type, payload) => {
    standardTeamAuthorityMocks.active.mockReturnValue(true);
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(standardTeamAuthorityMocks.handler).toBeTypeOf('function'));
    await waitFor(() => expect(standardTeamAuthorityMocks.getRunState).toHaveBeenCalledTimes(1));

    act(() => {
      standardTeamAuthorityMocks.handler?.({ type, payload });
    });

    if (type === 'team.runStarted') {
      expect(result.current.state.activeRun?.team_run_id).toBe('run-1');
    } else {
      expect(result.current.state.slotWorkBySlot.lead?.state).toBe('running');
    }
    expect(standardTeamAuthorityMocks.getRunState).toHaveBeenCalledTimes(1);
    expect(teamEventMocks.invoke.getRunState).not.toHaveBeenCalled();
  });

  it('keeps a newer provider run event over an older in-flight Main snapshot', async () => {
    standardTeamAuthorityMocks.active.mockReturnValue(true);
    let resolveSnapshot!: (snapshot: { session_generation: null; active_run: null; slot_work: [] }) => void;
    const pendingSnapshot = new Promise<{
      session_generation: null;
      active_run: null;
      slot_work: [];
    }>((resolve) => {
      resolveSnapshot = resolve;
    });
    standardTeamAuthorityMocks.getRunState.mockReturnValue(pendingSnapshot);
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(standardTeamAuthorityMocks.handler).toBeTypeOf('function'));

    act(() => {
      standardTeamAuthorityMocks.handler?.({
        type: 'team.runStarted',
        payload: runEvent({ status: 'running' }),
      });
    });
    expect(result.current.state.activeRun?.team_run_id).toBe('run-1');

    await act(async () => {
      resolveSnapshot({ session_generation: null, active_run: null, slot_work: [] });
      await pendingSnapshot;
    });

    expect(result.current.state.activeRun?.team_run_id).toBe('run-1');
  });

  it('ack_applies_the_exact_core_run_snapshot', () => {`,
);

const agentModeSelectorPath =
  "packages/desktop/src/renderer/components/agent/AgentModeSelector.tsx";
replaceOnce(
  agentModeSelectorPath,
  `  /** Optional config option loader for runtime owners such as team sessions. */
  loadConfigOptions?: AcpConfigOptionsLoader;
}`,
  `  /** Optional config option loader for runtime owners such as team sessions. */
  loadConfigOptions?: AcpConfigOptionsLoader;
  /** Keep an explicit read-only entry when this runtime exposes no mode catalog. */
  unavailableLabel?: string;
  /** Explain why the retained read-only mode entry cannot be changed. */
  unavailableDescription?: string;
}`,
);
replaceOnce(
  agentModeSelectorPath,
  `  beforeRuntimeSet,
  loadConfigOptions,
}) => {`,
  `  beforeRuntimeSet,
  loadConfigOptions,
  unavailableLabel,
  unavailableDescription,
}) => {`,
);
replaceOnce(
  agentModeSelectorPath,
  `  onModeChanged?: (mode: string) => void;`,
  `  onModeChanged?: (mode: string) => void | Promise<void>;`,
);
replaceOnce(
  agentModeSelectorPath,
  `        onModeSelect(mode);
        onModeChanged?.(mode);`,
  `        onModeSelect(mode);
        await onModeChanged?.(mode);`,
);
replaceOnce(
  agentModeSelectorPath,
  `      try {
        await setActiveMode();
        setCurrentMode(mode);
        onModeChanged?.(mode);`,
  `      try {
        if (onModeChanged) {
          await onModeChanged(mode);
        } else {
          await setActiveMode();
        }
        setCurrentMode(mode);`,
);
replaceOnce(
  agentModeSelectorPath,
  `    if (!canInteract && legacyCompactBehavior) {
      return null;
    }`,
  `    if (!canInteract && legacyCompactBehavior) {
      if (!unavailableLabel || runtimeConfig.isLoading) return null;
      const unavailableContent = (
        <span data-testid='mode-selector-unavailable' className='inline-flex'>
          <RuntimeSelectorPill
            testId={backend ? \`agent-mode-selector-\${backend}\` : 'agent-mode-selector'}
            className='sendbox-model-btn agent-mode-compact-pill agent-mode-compact-pill--readonly'
            label={compactLabelPrefix ? \`\${compactLabelPrefix} · \${unavailableLabel}\` : unavailableLabel}
            leading={
              <>
                {compactLeadingIcon && <span className='shrink-0 inline-flex items-center'>{compactLeadingIcon}</span>}
                {showLogoInCompact && <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>}
              </>
            }
            disabled
            aria-label={compactLabelPrefix ? \`\${compactLabelPrefix} · \${unavailableLabel}\` : unavailableLabel}
          />
        </span>
      );
      return unavailableDescription ? (
        <Tooltip content={unavailableDescription}>{unavailableContent}</Tooltip>
      ) : (
        unavailableContent
      );
    }`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `                loadConfigOptions={teamPermission?.loadConfigOptions}
              />`,
  `                loadConfigOptions={teamPermission?.loadConfigOptions}
                unavailableLabel={isTeamConversation ? t('agentMode.unavailable') : undefined}
                unavailableDescription={
                  isTeamConversation ? t('agentMode.unavailableDescription') : undefined
                }
              />`,
);

const teamTabsContextPath = "packages/desktop/src/renderer/pages/team/hooks/TeamTabsContext.tsx";
replaceOnce(
  teamTabsContextPath,
  `  addAssistant?: (assistant: TeamAssistantInput) => Promise<TeamAssistant>;
  membershipMutationBusy: boolean;`,
  `  addAssistant?: (assistant: TeamAssistantInput) => Promise<TeamAssistant>;
  addMemberOpenRequestId: number;
  requestAddMember: () => void;
  membershipMutationBusy: boolean;`,
);
replaceOnce(
  teamTabsContextPath,
  `  const [localAssistants, setLocalAssistants] = useState<TeamAssistant[]>(() =>
    sortTeamAssistants(externalAssistants, team_id)
  );`,
  `  const [localAssistants, setLocalAssistants] = useState<TeamAssistant[]>(() =>
    sortTeamAssistants(externalAssistants, team_id)
  );
  const [addMemberOpenRequestId, setAddMemberOpenRequestId] = useState(0);`,
);
replaceOnce(
  teamTabsContextPath,
  `  const contextValue = useMemo(
    () => ({`,
  `  const requestAddMember = useCallback(() => {
    setAddMemberOpenRequestId((requestId) => requestId + 1);
  }, []);

  const contextValue = useMemo(
    () => ({`,
);
replaceExactCount(
  teamTabsContextPath,
  `      removeAssistant,
      addAssistant,
      membershipMutationBusy,`,
  `      removeAssistant,
      addAssistant,
      addMemberOpenRequestId,
      requestAddMember,
      membershipMutationBusy,`,
  2,
);

const teamAddMemberPopoverPath =
  "packages/desktop/src/renderer/pages/team/components/memberPicker/TeamAddMemberPopover.tsx";
replaceOnce(
  teamAddMemberPopoverPath,
  `import { resolveDefaultTeamAgentModel } from '../teamCreateModelResolver';\n`,
  ``,
);
replaceOnce(
  teamAddMemberPopoverPath,
  `      const model = await resolveDefaultTeamAgentModel({
        assistant_id: assistant.id,
        assistant_backend: assistant.backend,
      });
      const input: TeamAssistantInput = {
        role: 'teammate',
        assistant_name: assistant.name,
        assistant_id: assistant.id,
        model,
      };`,
  `      const input: TeamAssistantInput = {
        role: 'teammate',
        assistant_name: assistant.name,
        assistant_id: assistant.id,
      };`,
);
replaceOnce(
  teamAddMemberPopoverPath,
  `type Props = {
  children: React.ReactElement;
  disabled?: boolean;
};

const TeamAddMemberPopover: React.FC<Props> = ({ children, disabled = false }) => {`,
  `type Props = {
  children: React.ReactElement;
  disabled?: boolean;
  openRequestId?: number;
};

const TeamAddMemberPopover: React.FC<Props> = ({ children, disabled = false, openRequestId = 0 }) => {`,
);
replaceOnce(
  teamAddMemberPopoverPath,
  `  useEffect(() => {
    if (disabled) setVisible(false);
  }, [disabled]);`,
  `  useEffect(() => {
    if (disabled) {
      setVisible(false);
      return;
    }
    if (openRequestId > 0 && addAssistant) setVisible(true);
  }, [addAssistant, disabled, openRequestId]);`,
);

const useTeamSessionPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamSession.ts";
replaceOnce(
  useTeamSessionPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import {
  addStandardTeamMember,
  getActestraTeam,
  isActestraTeamProviderActive,
  removeStandardTeamMember,
  renameStandardTeamMember,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  useTeamSessionPath,
  `export function useTeamSession(team: TTeam, warmupPhase?: TeamWarmupPhase) {`,
  `export function useTeamSession(team: TTeam, warmupPhase?: TeamWarmupPhase) {
  const providerActive = isActestraTeamProviderActive();`,
);
replaceOnce(
  useTeamSessionPath,
  `  const { mutate: mutateTeam } = useSWR(team.id ? \`team/\${team.id}\` : null, () =>
    ipcBridge.team.get.invoke({ id: team.id })
  );`,
  `  const { mutate: mutateTeam } = useSWR(
    team.id ? \`team/\${team.id}\` : null,
    providerActive
      ? () => getActestraTeam(team.id)
      : () => ipcBridge.team.get.invoke({ id: team.id })
  );`,
);
replaceOnce(
  useTeamSessionPath,
  `  const addAssistant = useCallback(
    async (assistant: TeamAssistantInput): Promise<TeamAssistant> => {
      const created = await ipcBridge.team.addAgent.invoke({ team_id: team.id, assistant });
      await mutateTeam();
      return created;
    },
    [team.id, mutateTeam]
  );`,
  `  const addAssistant = useCallback(
    async (assistant: TeamAssistantInput): Promise<TeamAssistant> => {
      const created = await (providerActive
        ? addStandardTeamMember({ team_id: team.id, assistant })
        : ipcBridge.team.addAgent.invoke({ team_id: team.id, assistant }));
      await mutateTeam();
      return created;
    },
    [team.id, mutateTeam, providerActive]
  );`,
);
replaceOnce(
  useTeamSessionPath,
  `  const renameAssistant = useCallback(
    async (slot_id: string, new_name: string) => {
      await ipcBridge.team.renameAgent.invoke({ team_id: team.id, slot_id, new_name });
      await mutateTeam();
    },
    [team.id, mutateTeam]
  );`,
  `  const renameAssistant = useCallback(
    async (slot_id: string, new_name: string) => {
      await (providerActive ? renameStandardTeamMember(team.id, slot_id, new_name) : ipcBridge.team.renameAgent.invoke({ team_id: team.id, slot_id, new_name }));
      await mutateTeam();
    },
    [team.id, mutateTeam, providerActive]
  );`,
);
replaceOnce(
  useTeamSessionPath,
  `        removeAgent: (params) => ipcBridge.team.removeAgent.invoke(params),`,
  `        removeAgent: (params) =>
          providerActive ? removeStandardTeamMember(params.team_id, params.slot_id) : ipcBridge.team.removeAgent.invoke(params),`,
);
replaceOnce(useTeamSessionPath, `    [team, mutateTeam]`, `    [team, mutateTeam, providerActive]`);
replaceOnce(
  useTeamSessionPath,
  `  useEffect(() => {
    if (warmupPhase === 'ready' || warmupPhase === 'error') {
      setMembershipMutationState(createTeamMembershipMutationState());
    }
  }, [team.id, warmupPhase]);`,
  `  const teamConversationIdentity = team.assistants
    .map((assistant) => assistant.conversation_id)
    .filter(Boolean)
    .toSorted()
    .join(',');

  useEffect(() => {
    if (warmupPhase === 'ready' || warmupPhase === 'error') {
      setMembershipMutationState(createTeamMembershipMutationState());
    }
    if (warmupPhase === 'ready') {
      for (const conversationId of teamConversationIdentity.split(',')) {
        if (conversationId) void revalidateAcpConfigOptions(conversationId);
      }
    }
  }, [teamConversationIdentity, team.id, warmupPhase]);`,
);

const useTeamSessionDomTestPath = "tests/unit/renderer/team/useTeamSessionCronCleanup.dom.test.ts";
replaceOnce(
  useTeamSessionDomTestPath,
  `  it('clears membership busy state when warmup reaches a terminal phase', () => {`,
  `  it('refreshes current agent config options when warmup becomes ready after a missed runtime event', () => {
    const { rerender } = renderHook(({ warmupPhase }) => useTeamSession(team(), warmupPhase), {
      initialProps: { warmupPhase: 'warming' as const },
    });

    expect(revalidateAcpConfigOptionsMock).not.toHaveBeenCalled();

    rerender({ warmupPhase: 'ready' });

    expect(revalidateAcpConfigOptionsMock).toHaveBeenCalledTimes(1);
    expect(revalidateAcpConfigOptionsMock).toHaveBeenCalledWith('member-conv');
  });

  it('clears membership busy state when warmup reaches a terminal phase', () => {`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `import { act, renderHook } from '@testing-library/react';`,
  `import { act, renderHook, waitFor } from '@testing-library/react';`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `import type { TTeam } from '@/common/types/team/teamTypes';`,
  `import type { TeamAssistant, TTeam } from '@/common/types/team/teamTypes';
import type { TeamAssistantInput } from '@/common/adapter/teamMapper';`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({`,
  `const standardTeamAuthorityMocks = vi.hoisted(() => ({
  providerActive: false,
  getTeam: vi.fn(),
  addMember: vi.fn(),
  renameMember: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => standardTeamAuthorityMocks.providerActive,
  getActestraTeam: standardTeamAuthorityMocks.getTeam,
  addStandardTeamMember: standardTeamAuthorityMocks.addMember,
  renameStandardTeamMember: standardTeamAuthorityMocks.renameMember,
  removeStandardTeamMember: standardTeamAuthorityMocks.removeMember,
}));

vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `    vi.clearAllMocks();
    for (const key of Object.keys(teamEventHandlers)) {`,
  `    vi.clearAllMocks();
    standardTeamAuthorityMocks.providerActive = false;
    standardTeamAuthorityMocks.getTeam.mockResolvedValue(team());
    standardTeamAuthorityMocks.addMember.mockResolvedValue(addedAssistant());
    for (const key of Object.keys(teamEventHandlers)) {`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `    vi.mocked(ipcBridge.team.get.invoke).mockResolvedValue(team());
    vi.mocked(ipcBridge.team.removeAgent.invoke).mockResolvedValue(undefined);`,
  `    vi.mocked(ipcBridge.team.get.invoke).mockResolvedValue(team());
    vi.mocked(ipcBridge.team.addAgent.invoke).mockResolvedValue(addedAssistant());
    vi.mocked(ipcBridge.team.removeAgent.invoke).mockResolvedValue(undefined);`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `  it('removes a member cron job before removing the member through the session hook', async () => {`,
  `  it('revalidates a provider-active Team through the Main/Core projection', async () => {
    const projectedTeam = team({ id: 'team-projected' });
    standardTeamAuthorityMocks.providerActive = true;
    standardTeamAuthorityMocks.getTeam.mockResolvedValue(projectedTeam);

    renderHook(() => useTeamSession(projectedTeam));

    await waitFor(() => expect(standardTeamAuthorityMocks.getTeam).toHaveBeenCalledWith('team-projected'));
    expect(ipcBridge.team.get.invoke).not.toHaveBeenCalled();
  });

  it('retains native AionUI Team reads when the Actestra provider is absent', async () => {
    const nativeTeam = team({ id: 'team-native' });
    vi.mocked(ipcBridge.team.get.invoke).mockResolvedValue(nativeTeam);

    renderHook(() => useTeamSession(nativeTeam));

    await waitFor(() => expect(ipcBridge.team.get.invoke).toHaveBeenCalledWith({ id: 'team-native' }));
    expect(standardTeamAuthorityMocks.getTeam).not.toHaveBeenCalled();
  });

  it('adds a provider-active member through the Main/Core projection', async () => {
    const projectedTeam = team({ id: 'team-add-projected' });
    standardTeamAuthorityMocks.providerActive = true;
    standardTeamAuthorityMocks.getTeam.mockResolvedValue(projectedTeam);
    const { result } = renderHook(() => useTeamSession(projectedTeam));

    await act(async () => {
      await expect(result.current.addAssistant(assistantInput())).resolves.toEqual(addedAssistant());
    });

    expect(standardTeamAuthorityMocks.addMember).toHaveBeenCalledWith({
      team_id: 'team-add-projected',
      assistant: assistantInput(),
    });
    expect(ipcBridge.team.addAgent.invoke).not.toHaveBeenCalled();
  });

  it('retains native AionUI member addition when the Actestra provider is absent', async () => {
    const nativeTeam = team({ id: 'team-add-native' });
    vi.mocked(ipcBridge.team.get.invoke).mockResolvedValue(nativeTeam);
    const { result } = renderHook(() => useTeamSession(nativeTeam));

    await act(async () => {
      await expect(result.current.addAssistant(assistantInput())).resolves.toEqual(addedAssistant());
    });

    expect(ipcBridge.team.addAgent.invoke).toHaveBeenCalledWith({
      team_id: 'team-add-native',
      assistant: assistantInput(),
    });
    expect(standardTeamAuthorityMocks.addMember).not.toHaveBeenCalled();
  });

  it('removes a member cron job before removing the member through the session hook', async () => {`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `function team(): TTeam {
  return {`,
  `function assistantInput(): TeamAssistantInput {
  return {
    role: 'teammate',
    assistant_name: 'Added member',
    assistant_id: 'assistant-added',
    model: 'gpt-5',
  };
}

function addedAssistant(): TeamAssistant {
  return {
    slot_id: 'added-slot',
    conversation_id: 'added-conv',
    role: 'teammate',
    assistant_backend: 'codex',
    assistant_name: 'Added member',
    status: 'idle',
    assistant_id: 'assistant-added',
    model: 'gpt-5',
    pending_confirmations: 0,
  };
}

function team(overrides: Partial<TTeam> = {}): TTeam {
  return {`,
);
replaceOnce(
  useTeamSessionDomTestPath,
  `    ],
  };
}`,
  `    ],
    ...overrides,
  };
}`,
);

const agentModeSelectorDomTestPath = "tests/unit/renderer/AgentModeSelector.dom.test.tsx";
replaceOnce(
  agentModeSelectorDomTestPath,
  `  it('renders setting progress at the compact trailing edge instead of using Arco button loading', async () => {`,
  `  it('retains an explicit read-only Team permission state when the runtime exposes no modes', () => {
    useAcpConfigOptionsMock.mockImplementation(() => ({
      setStatus: { state: 'idle' },
      isLoading: false,
      mode: null,
      model: null,
      thoughtLevel: null,
      reload: vi.fn(),
      setConfigOption: vi.fn(),
    }));

    render(
      <AgentModeSelector
        backend='claude'
        conversation_id='conv-1'
        compact
        compactLabelPrefix='权限'
        unavailableLabel='当前 runtime 不提供权限模式'
        unavailableDescription='该成员仍可聊天和选择模型。'
      />
    );

    const unavailable = screen.getByTestId('mode-selector-unavailable');
    const button = screen.getByTestId('agent-mode-selector-claude');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('权限 · 当前 runtime 不提供权限模式');
    expect(unavailable.closest('[data-tooltip-content]')).toHaveAttribute(
      'data-tooltip-content',
      '该成员仍可聊天和选择模型。'
    );
  });

  it('renders setting progress at the compact trailing edge instead of using Arco button loading', async () => {`,
);

const standardTeamCreateDomTestPath = "tests/unit/renderer/hooks/teamCreateModal.dom.test.tsx";
replaceOnce(
  standardTeamCreateDomTestPath,
  `const createTeamInvokeMock = vi.fn();
const resolveDefaultTeamAgentModelMock = vi.fn();
const messageErrorMock = vi.fn();`,
  `const createTeamInvokeMock = vi.fn();
const messageErrorMock = vi.fn();`,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      create: { invoke: (...args: unknown[]) => createTeamInvokeMock(...args) },
    },
  },
}));`,
  `vi.mock('@/common/adapter/actestraTeamClient', () => ({
  createStandardTeam: (...args: unknown[]) => createTeamInvokeMock(...args),
}));`,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `vi.mock('@renderer/pages/team/components/teamCreateModelResolver', () => ({
  resolveDefaultTeamAgentModel: (...args: unknown[]) => resolveDefaultTeamAgentModelMock(...args),
}));

`,
  ``,
);
replaceExactCount(
  standardTeamCreateDomTestPath,
  `    resolveDefaultTeamAgentModelMock.mockReset();
    resolveDefaultTeamAgentModelMock.mockResolvedValue(undefined);
`,
  ``,
  2,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `    expect(resolveDefaultTeamAgentModelMock).toHaveBeenCalledWith({
      assistant_id: 'bare-aionrs',
      assistant_backend: 'aionrs',
    });`,
  `    expect(payload.agents[0].model).toBeUndefined();`,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `  it('model_resolution_failure_blocks_create_and_names_assistant', async () => {
    resolveDefaultTeamAgentModelMock.mockImplementation(({ assistant_id }: { assistant_id: string }) => {
      if (assistant_id === 'remote-runner') {
        return Promise.reject(new Error('model unavailable'));
      }
      return Promise.resolve('model-ok');
    });`,
  `  it('shows a Main model-admission failure without creating an authoritative Team in renderer', async () => {
    createTeamInvokeMock.mockRejectedValueOnce(new Error('The selected Team model is unavailable'));`,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `    expect(createTeamInvokeMock).not.toHaveBeenCalled();
    expect(String(messageErrorMock.mock.calls[0][0])).toContain('Remote Runner');`,
  `    expect(createTeamInvokeMock).toHaveBeenCalledTimes(1);
    expect(String(messageErrorMock.mock.calls[0][0])).toContain('model is unavailable');`,
);
replaceOnce(
  standardTeamCreateDomTestPath,
  `    expect(createTeamInvokeMock).toHaveBeenCalledTimes(1);
    expect(String(messageErrorMock.mock.calls[0][0])).toContain('model is unavailable');`,
  `    expect(createTeamInvokeMock).toHaveBeenCalledTimes(1);
    expect(String(messageErrorMock.mock.calls[0][0])).toContain('model is unavailable');
    expect(screen.getByTestId('team-create-error')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('team-create-error')).toHaveTextContent('The selected Team model is unavailable');
    expect(screen.getByPlaceholderText('Team name')).toHaveValue('Model Failure Team');
    expect(screen.getByRole('button', { name: 'Confirm Create' })).toBeEnabled();`,
);

const standardTeamAddMemberDomTestPath =
  "tests/unit/renderer/team/TeamAddMemberPopover.dom.test.tsx";
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `const addAssistantMock = vi.fn();
const switchTabMock = vi.fn();
const resolveDefaultTeamAgentModelMock = vi.fn();
const messageErrorMock = vi.fn();`,
  `const addAssistantMock = vi.fn();
const switchTabMock = vi.fn();
const messageErrorMock = vi.fn();`,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `vi.mock('@/renderer/pages/team/components/teamCreateModelResolver', () => ({
  resolveDefaultTeamAgentModel: (...args: unknown[]) => resolveDefaultTeamAgentModelMock(...args),
}));

`,
  ``,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `    resolveDefaultTeamAgentModelMock.mockReset();
    resolveDefaultTeamAgentModelMock.mockResolvedValue('claude-sonnet-4');
`,
  ``,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `      model: 'claude-sonnet-4',`,
  `      model: undefined,`,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `    // Hold model resolution so the pending state stays observable mid-flight.
    let releaseModel: (value: string) => void = () => {};
    resolveDefaultTeamAgentModelMock.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        releaseModel = resolve;
      })
    );`,
  `    // Hold the Main-owned add operation so the pending state stays observable mid-flight.
    let releaseAdd: (value: { slot_id: string }) => void = () => {};
    addAssistantMock.mockReturnValueOnce(
      new Promise<{ slot_id: string }>((resolve) => {
        releaseAdd = resolve;
      })
    );`,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `    releaseModel('claude-sonnet-4');`,
  `    releaseAdd({ slot_id: 'slot-new' });`,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `  it('keeps the popover open and does not add when model resolution fails', async () => {
    resolveDefaultTeamAgentModelMock.mockRejectedValueOnce(new Error('no model'));`,
  `  it('keeps the popover open when Main rejects model admission', async () => {
    addAssistantMock.mockRejectedValueOnce(new Error('The selected Team model is unavailable'));`,
);
replaceOnce(
  standardTeamAddMemberDomTestPath,
  `    expect(addAssistantMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('team-add-member-option-unchecked')).toBeInTheDocument();`,
  `    expect(addAssistantMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('team-add-member-option-unchecked')).toBeInTheDocument();`,
);

const teamTabsPath = "packages/desktop/src/renderer/pages/team/components/TeamTabs.tsx";
replaceOnce(
  teamTabsPath,
  `  dragActive: boolean;
  onSwitch: (slot_id: string) => void;`,
  `  dragActive: boolean;
  reorderEnabled: boolean;
  onSwitch: (slot_id: string) => void;`,
);
replaceOnce(
  teamTabsPath,
  `  pendingCount = 0,
  dragActive,
  onSwitch,`,
  `  pendingCount = 0,
  dragActive,
  reorderEnabled,
  onSwitch,`,
);
replaceOnce(teamTabsPath, `    disabled: isLeader,`, `    disabled: isLeader || !reorderEnabled,`);
replaceOnce(
  teamTabsPath,
  `  const showDragHandle = !isLeader && !editing && ((hovered && !dragActive) || isDragging);`,
  `  const showDragHandle = reorderEnabled && !isLeader && !editing && ((hovered && !dragActive) || isDragging);`,
);
replaceOnce(
  teamTabsPath,
  `  /** warmup 失败的成员 slot：胶囊头像标红提示，引导用户移除/换模型自救。 */
  failedSlotIds?: Set<string>;
};`,
  `  /** warmup 失败的成员 slot：胶囊头像标红提示，引导用户移除/换模型自救。 */
  failedSlotIds?: Set<string>;
  /** Disable local-only drag when the provider cannot persist member order. */
  reorderEnabled?: boolean;
};`,
);
replaceOnce(
  teamTabsPath,
  `const TeamTabs: React.FC<TeamTabsProps> = ({ onTabClick, pendingCounts, warmingUp = false, failedSlotIds }) => {`,
  `const TeamTabs: React.FC<TeamTabsProps> = ({
  onTabClick,
  pendingCounts,
  warmingUp = false,
  failedSlotIds,
  reorderEnabled = true,
}) => {`,
);
replaceOnce(
  teamTabsPath,
  `  const sortableIds = useMemo(
    () => assistants.filter((assistant) => assistant.role !== 'leader').map((assistant) => assistant.slot_id),
    [assistants]
  );`,
  `  const sortableIds = useMemo(
    () =>
      reorderEnabled
        ? assistants.filter((assistant) => assistant.role !== 'leader').map((assistant) => assistant.slot_id)
        : [],
    [assistants, reorderEnabled]
  );`,
);
replaceOnce(
  teamTabsPath,
  `                    pendingCount={pendingCounts?.get(assistant.slot_id) ?? 0}
                    dragActive={dragActive}
                    onSwitch={(slot_id) => {`,
  `                    pendingCount={pendingCounts?.get(assistant.slot_id) ?? 0}
                    dragActive={dragActive}
                    reorderEnabled={reorderEnabled}
                    onSwitch={(slot_id) => {`,
);
replaceOnce(
  teamTabsPath,
  `    reorderAssistants,
    addAssistant,
    colorOf,`,
  `    reorderAssistants,
    addAssistant,
    addMemberOpenRequestId,
    colorOf,`,
);
replaceOnce(
  teamTabsPath,
  `<TeamAddMemberPopover disabled={memberOpsDisabled}>`,
  `<TeamAddMemberPopover disabled={memberOpsDisabled} openRequestId={addMemberOpenRequestId}>`,
);

const useTeamRunViewPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamRunView.ts";
replaceOnce(
  useTeamRunViewPath,
  `  const [state, setState] = useState<TeamRunViewState>(emptyState);
  const reconcileSeq = useRef(0);`,
  `  const [state, setState] = useState<TeamRunViewState>(emptyState);
  const reconcileSeq = useRef(0);
  const slowReconciledTurns = useRef(new Set<string>());`,
);
replaceOnce(
  useTeamRunViewPath,
  `  useEffect(() => {
    reconcileSeq.current += 1;
    setState(emptyState);
  }, [team_id]);`,
  `  useEffect(() => {
    reconcileSeq.current += 1;
    slowReconciledTurns.current.clear();
    setState(emptyState);
  }, [team_id]);`,
);
replaceOnce(
  useTeamRunViewPath,
  `  useEffect(() => {
    void reconcile('load');
  }, [reconcile]);

  useEffect(() => {
    const unsubs = [`,
  `  useEffect(() => {
    void reconcile('load');
  }, [reconcile]);

  useEffect(() => {
    let next: { key: string; delayMs: number } | undefined;
    for (const work of Object.values(state.slotWorkBySlot)) {
      if (
        !work?.active_turn_id ||
        work.active_turn_slow !== false ||
        typeof work.active_turn_started_at_ms !== 'number' ||
        typeof work.active_turn_slow_threshold_ms !== 'number' ||
        work.active_turn_slow_threshold_ms <= 0
      ) {
        continue;
      }
      const key = [
        team_id,
        work.active_turn_id,
        work.active_turn_started_at_ms,
        work.active_turn_slow_threshold_ms,
      ].join(':');
      if (slowReconciledTurns.current.has(key)) continue;
      const delayMs = Math.max(0, work.active_turn_started_at_ms + work.active_turn_slow_threshold_ms - Date.now());
      if (!next || delayMs < next.delayMs) next = { key, delayMs };
    }
    if (!next) return;

    const timer = setTimeout(() => {
      slowReconciledTurns.current.add(next.key);
      void reconcile('active_turn_slow.threshold');
    }, next.delayMs);
    return () => clearTimeout(timer);
  }, [reconcile, state.slotWorkBySlot, team_id]);

  useEffect(() => {
    const applyNativeRunHint = (event: ITeamRunEvent): void => {
      if (event.team_id !== team_id) return;
      if (isActestraTeamProviderActive()) {
        void reconcile('native.runHint');
        return;
      }
      applyRunEvent(event);
    };
    const applyNativeSlotWorkHint = (event: ITeamSlotWorkChangedEvent): void => {
      if (event.team_id !== team_id) return;
      if (isActestraTeamProviderActive()) {
        void reconcile('native.slotWorkHint');
        return;
      }
      applySlotWork(event);
    };
    const unsubs = [`,
);

replaceOnce(
  useTeamRunViewPath,
  `      ipcBridge.team.runAccepted.on(applyRunEvent),
      ipcBridge.team.runStarted.on(applyRunEvent),
      ipcBridge.team.runUpdated.on(applyRunEvent),
      ipcBridge.team.runCompleted.on(applyRunEvent),
      ipcBridge.team.runCancelled.on(applyRunEvent),
      ipcBridge.team.runFailed.on(applyRunEvent),`,
  `      subscribeActestraTeamEvents((event) => {
        switch (event.type) {
          case 'team.runAccepted':
          case 'team.runStarted':
          case 'team.runUpdated':
          case 'team.runCompleted':
          case 'team.runCancelled':
          case 'team.runFailed':
            reconcileSeq.current += 1;
            applyRunEvent(event.payload as unknown as ITeamRunEvent, 'actestra.provider');
            return;
          case 'team.slotWorkChanged':
            reconcileSeq.current += 1;
            applySlotWork(event.payload as unknown as ITeamSlotWorkChangedEvent);
            return;
          default:
            return;
        }
      }),
      ipcBridge.team.runAccepted.on(applyNativeRunHint),
      ipcBridge.team.runStarted.on(applyNativeRunHint),
      ipcBridge.team.runUpdated.on(applyNativeRunHint),
      ipcBridge.team.runCompleted.on(applyNativeRunHint),
      ipcBridge.team.runCancelled.on(applyNativeRunHint),
      ipcBridge.team.runFailed.on(applyNativeRunHint),`,
);
replaceOnce(
  useTeamRunViewPath,
  `      ipcBridge.team.slotWorkChanged.on(applySlotWork),`,
  `      ipcBridge.team.slotWorkChanged.on(applyNativeSlotWorkHint),`,
);

replaceOnce(
  teamPagePath,
  `  onTeamRunAck: ReturnType<typeof useTeamRunView>['applyAck'];
  onRunStateStale: ReturnType<typeof useTeamRunView>['reconcile'];
}> = ({`,
  `  onTeamRunAck: ReturnType<typeof useTeamRunView>['applyAck'];
  onRunStateStale: ReturnType<typeof useTeamRunView>['reconcile'];
  onRequestAddMember: () => void;
}> = ({`,
);
replaceOnce(
  teamPagePath,
  `  teamRunView,
  onTeamRunAck,
  onRunStateStale,
}) => {`,
  `  teamRunView,
  onTeamRunAck,
  onRunStateStale,
  onRequestAddMember,
}) => {`,
);
replaceOnce(
  teamPagePath,
  `            onTeamRunAck={onTeamRunAck}
            onRunStateStale={() => onRunStateStale('pause.stale')}
          />`,
  `            onTeamRunAck={onTeamRunAck}
            onRunStateStale={() => onRunStateStale('pause.stale')}
            onRequestAddMember={onRequestAddMember}
          />`,
);
replaceOnce(
  teamPagePath,
  `  const { assistants, activeSlotId, switchTab, colorOf, colorOfConversation } = useTeamTabs();`,
  `  const { assistants, activeSlotId, switchTab, requestAddMember, colorOf, colorOfConversation } = useTeamTabs();`,
);
replaceExactCount(
  teamPagePath,
  `                      onTeamRunAck={teamRun.applyAck}
                      onRunStateStale={teamRun.reconcile}
                    />`,
  `                      onTeamRunAck={teamRun.applyAck}
                      onRunStateStale={teamRun.reconcile}
                      onRequestAddMember={requestAddMember}
                    />`,
  1,
);
replaceOnce(
  teamPagePath,
  `                          onTeamRunAck={teamRun.applyAck}
                          onRunStateStale={teamRun.reconcile}
                        />`,
  `                          onTeamRunAck={teamRun.applyAck}
                          onRunStateStale={teamRun.reconcile}
                          onRequestAddMember={requestAddMember}
                        />`,
);

const nativeTeamPageTestPath = "tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx";
replaceOnce(
  nativeTeamPageTestPath,
  `vi.mock('@/renderer/pages/team/components/TeamChatView', () => ({
  __esModule: true,
  default: ({ conversation: chatConversation }: { conversation: TChatConversation }) => (
    <div data-testid={\`team-chat-view-\${chatConversation.id}\`} />
  ),
}));`,
  `vi.mock('@/renderer/pages/team/components/TeamChatView', () => ({
  __esModule: true,
  default: ({ conversation: chatConversation }: { conversation: TChatConversation }) => (
    <div data-testid={\`team-chat-view-\${chatConversation.id}\`} />
  ),
}));

vi.mock('@/renderer/pages/team/components/ActestraTeamWorkspace', () => ({
  __esModule: true,
  default: ({ team: projectedTeam }: { team: TTeam }) => (
    <div data-testid='actestra-team-plan-control'>{projectedTeam.name}</div>
  ),
}));`,
);
replaceOnce(
  nativeTeamPageTestPath,
  `    await waitFor(() => expect(screen.getByTestId('team-tab-add-member')).not.toBeDisabled());
  });
});`,
  `    await waitFor(() => expect(screen.getByTestId('team-tab-add-member')).not.toBeDisabled());
  });

  it('keeps native Team chat and switches to Actestra plan controls by the Team projection in one session', async () => {
    Object.defineProperty(window, 'actestraTeam', { configurable: true, value: { onEvent: vi.fn(() => () => {}) } });
    getConversationOrNullMock.mockImplementation(async (conversationId: string) =>
      conversation({ id: conversationId, name: conversationId })
    );
    const view = render(
      <MemoryRouter>
        <TeamPage team={{ ...team(), experience: 'standard' }} />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('team-tabs-slot')).toBeInTheDocument();
    expect(await screen.findByTestId('team-chat-view-member-conv')).toBeInTheDocument();
    expect(screen.queryByTestId('actestra-team-plan-control')).toBeNull();

    view.rerender(
      <MemoryRouter>
        <TeamPage
          team={{
            ...team(),
            id: 'team-orchestrated',
            name: 'Actestra projected Team',
            experience: 'orchestrated',
            workspace: 'workspace-approved',
            workspace_mode: 'isolated',
          }}
        />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('actestra-team-plan-control')).toHaveTextContent('Actestra projected Team');
    expect(screen.queryByTestId('team-tabs-slot')).toBeNull();
    delete window.actestraTeam;
  });
});`,
);

const teamE2eHelperPath = "tests/e2e/helpers/teamHelpers.ts";
replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx",
  `      unmountOnExit={false}`,
  `      unmountOnExit={true}`,
);
replaceOnce(
  teamE2eHelperPath,
  `type TeamRecord = { id: string; name: string; agents: TeamAgent[] };`,
  `type TeamRecord = { id: string; name: string; agents: TeamAgent[] };

export async function chooseTeamExperience(
  page: Page,
  experience: 'standard' | 'orchestrated',
): Promise<void> {
  const choice = page.locator(\`[data-testid="team-create-kind-\${experience}"]\`);
  await expect(choice).toBeVisible({ timeout: 5_000 });
  await choice.click();
  await expect(choice).toBeHidden({ timeout: 5_000 });
}`,
);
replaceOnce(
  teamE2eHelperPath,
  `  await createBtn.click();

  const modal = page.locator('.arco-modal').last();`,
  `  await createBtn.click();
  await chooseTeamExperience(page, 'standard');

  const modal = page.locator('.arco-modal').last();`,
);
replaceOnce(
  teamE2eHelperPath,
  `  const nameInput = modal.getByRole('textbox').first();`,
  `  const nameInput = modal.locator('[data-testid="team-create-name-input"]');`,
);
replaceOnce(
  teamE2eHelperPath,
  `async function pickLeaderOption(page: Page, leaderType?: string): Promise<Locator | null> {
  const options = page.locator('.team-create-modal [data-testid^="team-create-agent-option-"]');
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});`,
  `async function pickLeaderOption(page: Page, leaderType?: string): Promise<Locator | null> {
  const options = page.locator('[data-testid^="team-create-agent-option-"]:visible');
  if (!(await options.first().isVisible().catch(() => false))) {
    const mobileAddMember = page.locator('[data-testid="team-create-add-member-btn"]:visible');
    if (await mobileAddMember.isVisible().catch(() => false)) {
      await mobileAddMember.click();
    }
  }
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});`,
);
replaceOnce(
  teamE2eHelperPath,
  `  const option = await pickLeaderOption(page, leaderType);
  if (!option) {
    await closeModal(page, modal);
    throw new Error(\`No assistant option matched leader type "\${leaderType ?? 'any'}" — skip this test\`);
  }`,
  `  const option = await pickLeaderOption(page, leaderType);
  if (!option) {
    const diagnostics = await collectTeamCreateDiagnostics(page);
    await closeModal(page, modal);
    throw new Error(
      'No assistant option matched leader type "' +
        (leaderType ?? 'any') +
        '" — diagnostics=' +
        JSON.stringify(diagnostics),
    );
  }`,
);
replaceOnce(
  teamE2eHelperPath,
  `async function pickLeaderOption(page: Page, leaderType?: string): Promise<Locator | null> {
  const options = page.locator('[data-testid^="team-create-agent-option-"]:visible');`,
  `async function assertVisibleAssistantAvatarsLoad(page: Page): Promise<void> {
  const avatars = page.locator(
    '[data-testid^="team-create-agent-option-"]:visible [data-testid="assistant-avatar"] img',
  );
  try {
    await expect(avatars.first()).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    const diagnostics = await collectTeamCreateDiagnostics(page);
    throw new Error('No visible assistant avatar image — diagnostics=' + JSON.stringify(diagnostics), {
      cause: error,
    });
  }
  await expect
    .poll(
      async () =>
        avatars.evaluateAll((images) =>
          images
            .filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0)
            .map((image) => ({
              alt: (image as HTMLImageElement).alt,
              complete: (image as HTMLImageElement).complete,
              naturalWidth: (image as HTMLImageElement).naturalWidth,
              src: (image as HTMLImageElement).src,
            })),
        ),
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toEqual([]);
}

async function collectTeamCreateDiagnostics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const describe = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        className: element.className,
        display: style.display,
        height: rect.height,
        testId: element.dataset.testid,
        text: element.textContent?.trim().slice(0, 300),
        visibility: style.visibility,
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        width: rect.width,
      };
    };
    const options = [...document.querySelectorAll<HTMLElement>('[data-testid^="team-create-agent-option-"]')].map(
      (option) => ({
        ...describe(option),
        ariaDisabled: option.getAttribute('aria-disabled'),
      }),
    );
    const images = [...document.querySelectorAll<HTMLImageElement>('[data-testid="assistant-avatar"] img')].map(
      (image) => ({
        alt: image.alt,
        complete: image.complete,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        src: image.src,
        visible: describe(image)?.visible,
      }),
    );
    const modal = document.querySelector('.team-create-modal');
    const portal = document.querySelector('[data-testid="team-create-assistant-pane"]');
    return {
      addMember: describe(document.querySelector('[data-testid="team-create-add-member-btn"]')),
      backendPort: (window as Window & { __backendPort?: number }).__backendPort,
      desktopLayout: describe(document.querySelector('[data-testid="team-create-layout"]')),
      devicePixelRatio: window.devicePixelRatio,
      images,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      mobileLayout: describe(document.querySelector('[data-testid="team-create-layout-mobile"]')),
      modal: describe(modal),
      modalHtml: modal?.outerHTML.slice(0, 20_000),
      options,
      portal: describe(portal),
      portalHtml: portal && !modal?.contains(portal) ? portal.outerHTML.slice(0, 20_000) : null,
    };
  });
}

async function pickLeaderOption(page: Page, leaderType?: string): Promise<Locator | null> {
  const options = page.locator('[data-testid^="team-create-agent-option-"]');`,
);
replaceOnce(
  teamE2eHelperPath,
  `  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});

  if (!leaderType) {`,
  `  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});
  await assertVisibleAssistantAvatarsLoad(page);

  if (!leaderType) {`,
);
replaceOnce(
  "tests/e2e/helpers/index.ts",
  `export { createTeam, ensureTeam, deleteTeam, cleanupTeamsByName } from './teamHelpers';`,
  `export {
  chooseTeamExperience,
  createTeam,
  ensureTeam,
  deleteTeam,
  cleanupTeamsByName,
} from './teamHelpers';`,
);

const teamCreateE2ePath = "tests/e2e/cases/teams/team-create.e2e.ts";
replaceOnce(
  teamCreateE2ePath,
  `import { TEAM_SUPPORTED_BACKENDS, cleanupTeamsByName } from '../../helpers';`,
  `import { TEAM_SUPPORTED_BACKENDS, chooseTeamExperience, cleanupTeamsByName } from '../../helpers';`,
);
replaceExactCount(
  teamCreateE2ePath,
  `    await createBtn.click();`,
  `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');`,
  2,
);
replaceOnce(
  teamCreateE2ePath,
  `  await createBtn.click();

  // Wait for modal to appear`,
  `  await createBtn.click();
  await chooseTeamExperience(page, 'standard');

  // Wait for modal to appear`,
);
replaceExactCount(
  teamCreateE2ePath,
  `    // Verify Modal is visible with "Create Team" title
    const modalTitle = page.locator('.arco-modal h3').filter({ hasText: /Create Team|创建团队/ });
    await expect(modalTitle).toBeVisible({ timeout: 5000 });`,
  `    // Verify the retained native Team creation layout is visible.
    await expect(page.locator('[data-testid="team-create-layout"]')).toBeVisible({ timeout: 5000 });`,
  1,
);
replaceOnce(
  teamCreateE2ePath,
  `    // Wait for modal to appear
    const modalTitle = page.locator('.arco-modal h3').filter({ hasText: /Create Team|创建团队/ });
    await expect(modalTitle).toBeVisible({ timeout: 5000 });`,
  `    // Wait for the retained native Team creation layout.
    await expect(page.locator('[data-testid="team-create-layout"]')).toBeVisible({ timeout: 5000 });`,
);
replaceOnce(
  teamCreateE2ePath,
  `  // Wait for modal to appear
  const modalTitle = page.locator('.arco-modal h3').filter({ hasText: /Create Team|创建团队/ });
  await expect(modalTitle).toBeVisible({ timeout: 5000 });`,
  `  // Wait for the retained native Team creation layout.
  await expect(page.locator('[data-testid="team-create-layout"]')).toBeVisible({ timeout: 5000 });`,
);
replaceExactCount(
  teamCreateE2ePath,
  `const nameInput = modal.getByRole('textbox').first();`,
  `const nameInput = modal.locator('[data-testid="team-create-name-input"]');`,
  3,
);
replaceOnce(
  teamCreateE2ePath,
  `    expect(hasOptions || hasNoAssistantsMsg).toBeTruthy();

    // Verify Create button exists (disabled until agent is selected and name is filled)`,
  `    expect(hasOptions || hasNoAssistantsMsg).toBeTruthy();

    if (hasOptions) {
      const assistantImages = modal.locator('[data-testid="team-create-assistant-pane"] img');
      const imageCount = await assistantImages.count();
      for (let index = 0; index < imageCount; index++) {
        const image = assistantImages.nth(index);
        await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
    }

    // Verify Create button exists (disabled until agent is selected and name is filled)`,
);

const teamCreateUiE2ePath = "tests/e2e/cases/teams/team-create-ui.e2e.ts";
replaceOnce(
  teamCreateUiE2ePath,
  `import { TEAM_SUPPORTED_BACKENDS, cleanupTeamsByName } from '../../helpers';`,
  `import { TEAM_SUPPORTED_BACKENDS, chooseTeamExperience, cleanupTeamsByName } from '../../helpers';`,
);
replaceOnce(
  teamCreateUiE2ePath,
  `    await createBtn.click();

    // Step 3: Verify modal opened`,
  `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');

    // Step 3: Verify modal opened`,
);

const teamCreateMobileE2ePath = "tests/e2e/cases/teams/team-create-mobile.e2e.ts";
replaceOnce(
  teamCreateMobileE2ePath,
  `import { TEAM_SUPPORTED_BACKENDS, cleanupTeamsByName } from '../../helpers';`,
  `import { TEAM_SUPPORTED_BACKENDS, chooseTeamExperience, cleanupTeamsByName } from '../../helpers';`,
);
replaceOnce(
  teamCreateMobileE2ePath,
  `    await createBtn.click();

    await expect(`,
  `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');

    await expect(`,
);

const teamUiDetailsE2ePath = "tests/e2e/cases/teams/team-ui-details.e2e.ts";
replaceOnce(
  teamUiDetailsE2ePath,
  `import { cleanupTeamsByName, createTeam } from '../../helpers';`,
  `import { chooseTeamExperience, cleanupTeamsByName, createTeam } from '../../helpers';`,
);
replaceOnce(
  teamUiDetailsE2ePath,
  `    await createBtn.click();

    const modal = page.locator('.arco-modal').last();`,
  `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');

    const modal = page.locator('.arco-modal').last();`,
);

const teamWhitelistE2ePath = "tests/e2e/cases/teams/team-whitelist.e2e.ts";
replaceOnce(
  teamWhitelistE2ePath,
  `import { httpDelete, httpGet, httpPost, navigateTo } from '../../helpers';`,
  `import { chooseTeamExperience, httpDelete, httpGet, httpPost, navigateTo } from '../../helpers';`,
);
replaceExactCount(
  teamWhitelistE2ePath,
  `    await createBtn.click();`,
  `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');`,
  2,
);
replaceOnce(
  teamWhitelistE2ePath,
  `      await createBtn.click();
    await chooseTeamExperience(page, 'standard');`,
  `      await createBtn.click();
      await chooseTeamExperience(page, 'standard');`,
);

const teamNameValidationE2ePath = "tests/e2e/cases/teams/team-name-validation.e2e.ts";
replaceOnce(
  teamNameValidationE2ePath,
  `import { test, expect } from '../../fixtures';`,
  `import { test, expect } from '../../fixtures';
import { chooseTeamExperience } from '../../helpers';`,
);
replaceOnce(
  teamNameValidationE2ePath,
  `  const createBtn = page.locator('.h-20px.w-20px.rd-4px').first();
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();

  const modal = page
    .locator('.arco-modal')
    .filter({ hasText: /Create Team|创建团队/ })
    .first();`,
  `  const createBtn = page.locator('[data-testid="team-create-btn"]').first();
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();
  await chooseTeamExperience(page, 'standard');

  const modal = page.locator('.team-create-modal');`,
);
replaceOnce(
  teamNameValidationE2ePath,
  `  const nameInput = modal.locator('input').first();`,
  `  const nameInput = modal.locator('[data-testid="team-create-name-input"]');`,
);

const teamWorkspaceMigrationE2ePath = "tests/e2e/cases/teams/team-workspace-migration.e2e.ts";
replaceOnce(
  teamWorkspaceMigrationE2ePath,
  `import { invokeBridge, TEAM_SUPPORTED_BACKENDS } from '../../helpers';`,
  `import { chooseTeamExperience, invokeBridge, TEAM_SUPPORTED_BACKENDS } from '../../helpers';`,
);
replaceOnce(
  teamWorkspaceMigrationE2ePath,
  `    const createBtn = page.locator('.h-20px.w-20px.rd-4px').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();`,
  `    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await chooseTeamExperience(page, 'standard');`,
);
replaceOnce(
  teamWorkspaceMigrationE2ePath,
  `    const nameInput = modal.locator('input').first();`,
  `    const nameInput = modal.locator('[data-testid="team-create-name-input"]');`,
);
replaceOnce(
  teamWorkspaceMigrationE2ePath,
  `    const agentCard = modal.locator('[data-testid^="team-create-agent-card-"]').first();
    if (!(await agentCard.isVisible().catch(() => false))) {
      test.skip(true, 'No supported agents available');
      return;
    }
    await agentCard.click();
    await expect(modal.locator('[data-testid^="team-create-agent-selected-badge-"]').first()).toBeVisible({`,
  `    const agentOption = modal
      .locator('[data-testid^="team-create-agent-option-"]:not(.cursor-not-allowed)')
      .first();
    if (!(await agentOption.isVisible().catch(() => false))) {
      test.skip(true, 'No supported agents available');
      return;
    }
    await agentOption.click();
    await expect(modal.locator('[data-testid^="team-create-member-draft-"]').first()).toBeVisible({`,
);

for (const workspaceE2ePath of [
  "tests/e2e/features/workspaces/workspace-files.e2e.ts",
  "tests/e2e/features/workspaces/workspace-snapshot.e2e.ts",
]) {
  replaceOnce(
    workspaceE2ePath,
    `import { cleanupTeamsByName, TEAM_SUPPORTED_BACKENDS } from '../../helpers';`,
    `import { chooseTeamExperience, cleanupTeamsByName, TEAM_SUPPORTED_BACKENDS } from '../../helpers';`,
  );
  replaceOnce(
    workspaceE2ePath,
    `    await createBtn.click();

    const modal = page.locator('.team-create-modal');`,
    `    await createBtn.click();
    await chooseTeamExperience(page, 'standard');

    const modal = page.locator('.team-create-modal');`,
  );
  replaceOnce(
    workspaceE2ePath,
    `    const agentCard = modal.locator('[data-testid^="team-create-agent-card-"]').first();
    if (!(await agentCard.isVisible().catch(() => false))) {
      test.skip(true, 'No supported agents available');
      return;
    }
    await agentCard.click();`,
    `    const agentOption = modal
      .locator('[data-testid^="team-create-agent-option-"]:not(.cursor-not-allowed)')
      .first();
    if (!(await agentOption.isVisible().catch(() => false))) {
      test.skip(true, 'No supported agents available');
      return;
    }
    await agentOption.click();`,
  );
}
replaceOnce(
  "tests/e2e/features/workspaces/workspace-files.e2e.ts",
  `    const nameInput = modal.locator('input').first();`,
  `    const nameInput = modal.locator('[data-testid="team-create-name-input"]');`,
);
replaceOnce(
  "tests/e2e/features/workspaces/workspace-snapshot.e2e.ts",
  `    await modal.locator('input').first().fill(TEAM_NAME);`,
  `    await modal.locator('[data-testid="team-create-name-input"]').fill(TEAM_NAME);`,
);
replaceOnce(
  "tests/e2e/features/workspaces/workspace-snapshot.e2e.ts",
  `    const changesTab = panel.locator('.arco-tabs-header-title').filter({ hasText: /Changes|更改/ });`,
  `    const changesTab = panel.locator('.arco-tabs-header-title').filter({ hasText: /Changes|更改|变更/ });`,
);
for (const relativePath of [
  "tests/e2e/cases/teams/team-communication.e2e.ts",
  "tests/e2e/cases/teams/team-member-messaging.e2e.ts",
  "tests/e2e/cases/teams/team-tab-context.e2e.ts",
]) {
  replaceOnce(
    relativePath,
    `    const chatInput = page.locator('textarea').first();`,
    `    const chatInput = page.locator('[data-role="leader"] textarea').first();`,
  );
}

write(
  "tests/e2e/cases/teams/team-member-messaging.e2e.ts",
  `/**
 * E2E: recover a Claude-led Standard Team, let Claude add a Codex CLI member,
 * and address that member by the authoritative slot projected by AionCore.
 */
import { test, expect } from '../../fixtures';
import {
  cleanupTeamsByName,
  ensureTeam,
  invokeBridge,
  TEAM_SUPPORTED_BACKENDS,
} from '../../helpers';

const TEAM_NAME = 'E2E Claude member messaging';

type TeamMemberProjection = {
  slot_id: string;
  assistant_backend?: string;
  assistant_name?: string;
  role?: string;
};

type TeamProjection = {
  experience?: string;
  assistants?: TeamMemberProjection[];
  agents?: TeamMemberProjection[];
};

const membersOf = (team: TeamProjection): TeamMemberProjection[] => team.assistants ?? team.agents ?? [];

test.describe('Team Member Messaging', () => {
  test('recovers Claude warmup and messages the Main-projected Codex CLI member', async ({ page }) => {
    test.setTimeout(300_000);

    if (!TEAM_SUPPORTED_BACKENDS.has('claude')) {
      test.skip(true, 'Claude CLI is not installed in this isolated acceptance environment');
      return;
    }

    await cleanupTeamsByName(page, TEAM_NAME);

    const sessionRoute = '**/api/teams/*/session';
    let rejectWarmup = true;
    let injectedWarmupFailures = 0;
    let teamId: string | null = null;
    await page.route('**/api/teams/*/session', async (route) => {
      if (route.request().method() === 'POST' && rejectWarmup) {
        injectedWarmupFailures += 1;
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'E2E_WARMUP_TIMEOUT', message: 'Injected recoverable warmup failure' },
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      teamId = await ensureTeam(page, TEAM_NAME, 'claude');
      await page.waitForFunction(() => window.location.hash.startsWith('#/team/'), undefined, {
        timeout: 10_000,
      });

      const warmupError = page.locator('[data-testid="team-warmup-overlay"][data-phase="error"]');
      await expect(warmupError).toBeVisible({ timeout: 30_000 });
      expect(injectedWarmupFailures).toBeGreaterThan(0);
      rejectWarmup = false;
      const retry = page.locator("[data-testid='team-warmup-retry']");
      await expect(retry).toBeVisible();
      await page.screenshot({ path: 'tests/e2e/results/team-member-msg-01-warmup-error.png' });

      await retry.click();
      await expect(page.locator('[data-testid="team-warmup-overlay"]')).toBeHidden({ timeout: 60_000 });
      await page.screenshot({ path: 'tests/e2e/results/team-member-msg-02-warmup-recovered.png' });

      const readTeam = () =>
        invokeBridge<TeamProjection>(page, 'team.get', { id: teamId }, 20_000);
      const before = await readTeam();
      expect(before.experience ?? 'standard').toBe('standard');
      const beforeSlotIds = new Set(membersOf(before).map((member) => member.slot_id));
      expect(membersOf(before).some((member) => /claude/i.test(
        [member.assistant_backend, member.assistant_name].filter(Boolean).join(' '),
      ))).toBe(true);

      const chatInput = page.locator('[data-role="leader"] textarea').first();
      await expect(chatInput).toBeVisible({ timeout: 10_000 });
      await chatInput.fill('Add one Codex CLI teammate to this Team.');
      await chatInput.press('Enter');
      await page.screenshot({ path: 'tests/e2e/results/team-member-msg-03-add-sent.png' });

      await expect
        .poll(
          async () => membersOf(await readTeam()).filter((member) => !beforeSlotIds.has(member.slot_id)).length,
          { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
        )
        .toBe(1);

      const after = await readTeam();
      const addedMember = membersOf(after).find((member) => !beforeSlotIds.has(member.slot_id));
      expect(addedMember?.slot_id).toBeTruthy();
      if (!addedMember?.slot_id) {
        throw new Error('AionCore did not project the newly added Team member slot');
      }
      expect(
        [addedMember.assistant_backend, addedMember.assistant_name].filter(Boolean).join(' '),
      ).toMatch(/codex/i);

      const memberTab = page.locator(\`[data-testid="team-tab-\${addedMember.slot_id}"]\`);
      await expect(memberTab).toBeVisible({ timeout: 30_000 });
      await memberTab.click();
      await expect(memberTab).toHaveAttribute('data-active', 'true');
      await page.screenshot({ path: 'tests/e2e/results/team-member-msg-04-projected-tab.png' });

      const memberInput = page.locator(\`[data-slot-id="\${addedMember.slot_id}"] textarea\`).first();
      await expect(memberInput).toBeVisible({ timeout: 30_000 });
      const directMessage = \`Direct message to projected Codex member \${Date.now()}\`;
      await memberInput.fill(directMessage);
      await memberInput.press('Enter');
      await expect(page.getByText(directMessage).first()).toBeVisible({ timeout: 30_000 });
      await expect(memberInput).toHaveValue('');
      await page.screenshot({ path: 'tests/e2e/results/team-member-msg-05-direct-sent.png' });
    } finally {
      await page.unroute(sessionRoute).catch(() => {});
      await cleanupTeamsByName(page, TEAM_NAME).catch(() => {});
    }
  });
});
`,
);

const presetLeaderE2ePath = "tests/e2e/specs/team-create-preset-leader.e2e.ts";
replaceOnce(
  presetLeaderE2ePath,
  `import { invokeBridge, navigateTo } from '../helpers';`,
  `import { chooseTeamExperience, invokeBridge, navigateTo } from '../helpers';`,
);
replaceOnce(
  presetLeaderE2ePath,
  `      await createBtn.click();

      const modal = page.locator('.team-create-modal');`,
  `      await createBtn.click();
      await chooseTeamExperience(page, 'standard');

      const modal = page.locator('.team-create-modal');`,
);

const teamSessionModeE2ePath = "tests/e2e/cases/teams/team-session-mode.e2e.ts";
replaceOnce(
  teamSessionModeE2ePath,
  `const ACP_BACKENDS = ['claude', 'codex'] as const;`,
  `const ACP_BACKENDS = ['codex', 'claude'] as const;`,
);
replaceOnce(
  teamSessionModeE2ePath,
  "    test.setTimeout(60_000);",
  "    test.setTimeout(120_000);",
);
replaceOnce(
  teamSessionModeE2ePath,
  "    const modeSelector = page.locator(MODE_SELECTOR).first();",
  "    const modeSelector = page.locator(`${MODE_SELECTOR}:visible`).first();",
);
replaceOnce(
  teamSessionModeE2ePath,
  `    const modeSelectorVisible = await modeSelector
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!modeSelectorVisible) {
      // Mode selector only appears when an ACP session has modes available.
      // If the backend is not initialised (no active session), skip gracefully.
      test.skip(true, 'Mode selector not visible — ACP session may not have modes configured');
      return;
    }`,
  `    const unavailableMode = page.locator('[data-testid="mode-selector-unavailable"]:visible').first();
    await expect(modeSelector.or(unavailableMode)).toBeVisible({ timeout: 15_000 });
    if (await unavailableMode.isVisible()) {
      await expect(unavailableMode.locator('button')).toBeDisabled();
      await expect(unavailableMode).toContainText(/Unavailable|暂不可用/u);
      await page.screenshot({ path: 'tests/e2e/results/team-session-mode-02-unavailable.png' });
      return;
    }`,
);
replaceOnce(
  teamSessionModeE2ePath,
  `    await page.waitForURL(/\\/team\\//, { timeout: 10_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-session-mode-01.png' });`,
  `    await page.waitForURL(/\\/team\\//, { timeout: 10_000 });
    await expect(page.locator('.team-create-modal')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('[data-testid="team-warmup-overlay"]')).toBeHidden({ timeout: 60_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-session-mode-01.png' });`,
);
replaceOnce(
  teamSessionModeE2ePath,
  `    // propagateMode calls team.set-session-mode (best-effort fire-and-forget), so we
    // poll briefly rather than requiring an instant match.`,
  `    // propagateMode awaits the Main/Core standard-Team setter and acknowledges only
    // the observed postcondition; poll briefly for the subsequent renderer query.`,
);

replaceExactCount(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `createTeam(page, TEAM_NAME)`,
  `createTeam(page, TEAM_NAME, 'codex')`,
  2,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `createTeam(page, RENAME_ORIG)`,
  `createTeam(page, RENAME_ORIG, 'claude')`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `createTeam(page, PIN_A)`,
  `createTeam(page, PIN_A, 'claude')`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `createTeam(page, PIN_B)`,
  `createTeam(page, PIN_B, 'claude')`,
);
replaceExactCount(
  "tests/e2e/cases/teams/team-delete.e2e.ts",
  `createTeam(page, teamName)`,
  `createTeam(page, teamName, 'claude')`,
  2,
);
replaceOnce(
  "tests/e2e/cases/teams/team-delete.e2e.ts",
  `  test('delete team via sider menu navigates away from team page', async ({ page }) => {
    const teamName = 'E2E Delete Team';`,
  `  test('delete team via sider menu navigates away from team page', async ({ page }) => {
    test.setTimeout(120_000);
    const teamName = 'E2E Delete Team';`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-delete.e2e.ts",
  `    let teamId: string;
    try {
      teamId = await createTeam(page, teamName, 'claude');
    } catch {
      test.skip(true, 'No supported backend available — skipping delete test');
      return;
    }`,
  `    const teamId = await createTeam(page, teamName, 'claude');`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-delete.e2e.ts",
  `  test('deleted team is removed from sidebar', async ({ page }) => {
    const teamName = 'E2E Delete Sidebar Team';`,
  `  test('deleted team is removed from sidebar', async ({ page }) => {
    test.setTimeout(120_000);
    const teamName = 'E2E Delete Sidebar Team';`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-delete.e2e.ts",
  `    let teamId: string;
    try {
      teamId = await createTeam(page, teamName, 'claude');
    } catch {
      test.skip(true, 'No supported backend available — skipping delete sidebar test');
      return;
    }`,
  `    const teamId = await createTeam(page, teamName, 'claude');`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `  menuKey: string`,
  `  menuPattern: RegExp`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `.filter({ hasText: new RegExp(menuKey, 'i') })`,
  `.filter({ hasText: menuPattern })`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `  test('重命名 team', async ({ page }) => {`,
  `  test('重命名 team', async ({ page }) => {
    test.setTimeout(120_000);`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `clickTeamMenuItem(page, RENAME_ORIG, 'rename')`,
  `clickTeamMenuItem(page, RENAME_ORIG, /重命名|Rename/iu)`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `  test('pin/unpin team 改变排序', async ({ page }) => {`,
  `  test('pin/unpin team 改变排序', async ({ page }) => {
    test.setTimeout(180_000);`,
);
replaceExactCount(
  "tests/e2e/cases/teams/team-rename-pin.e2e.ts",
  `clickTeamMenuItem(page, PIN_B, 'pin')`,
  `clickTeamMenuItem(page, PIN_B, /置顶|取消置顶|Pin|Unpin/iu)`,
  2,
);
replaceExactCount(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `    let teamId: string;
    try {
      teamId = await createTeam(page, TEAM_NAME, 'codex');
    } catch {
      console.log('[E2E] createTeam unavailable — skipping member-ops rename test');
      test.skip();
      return;
    }`,
  `    const teamId = await createTeam(page, TEAM_NAME, 'codex');`,
  1,
);
replaceExactCount(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `    let teamId: string;
    try {
      teamId = await createTeam(page, TEAM_NAME, 'codex');
    } catch {
      console.log('[E2E] createTeam unavailable — skipping member-ops remove test');
      test.skip();
      return;
    }`,
  `    const teamId = await createTeam(page, TEAM_NAME, 'codex');`,
  1,
);
replaceOnce(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `    if (!memberAssistantId) {
      console.log('[E2E] No assistant found for claude backend — skipping member remove flow.');
      test.skip();
      return;
    }`,
  `    expect(memberAssistantId).toBeTruthy();
    if (!memberAssistantId) throw new Error('Claude assistant is unavailable in the configured catalog');`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `        assistant_id: memberAssistantId,
        model: 'claude',`,
  `        assistant_id: memberAssistantId,`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `    if (!addResult?.slot_id) {
      console.log('[E2E] team.add-agent failed — agent backend may not be installed. Skipping.');
      test.skip();
      return;
    }`,
  `    expect(addResult?.slot_id).toBeTruthy();
    if (!addResult?.slot_id) throw new Error('Main/Core did not return a standard Team member slot');`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `cleanupTeamsByName, createTeam, findAssistantIdForBackend, invokeBridge, navigateTo`,
  `cleanupTeamsByName, createTeam, findAssistantIdForBackend, navigateTo`,
);
replaceOnce(
  "tests/e2e/cases/teams/team-member-ops.e2e.ts",
  `    // Add a member deterministically via IPC bridge (setup, not under test)
    const memberName = \`E2E-rm-\${Date.now()}\`;
    const addResult = await invokeBridge<{ slot_id: string } | null>(page, 'team.add-agent', {
      team_id: teamId,
      agent: {
        name: memberName,
        role: 'teammate',
        assistant_id: memberAssistantId,
      },
    }).catch(() => null);

    expect(addResult?.slot_id).toBeTruthy();
    if (!addResult?.slot_id) throw new Error('Main/Core did not return a standard Team member slot');`,
  `    // Set up the removable member through the same provider-active Main/Core
    // contract used by the native UI. The generic invokeBridge helper maps this
    // legacy key straight to AionCore HTTP, so it cannot prove Actestra authority.
    const memberName = \`E2E-rm-\${Date.now()}\`;
    const addResponse = await page.evaluate(
      async ({ targetTeamId, targetMemberName, targetAssistantId }) =>
        window.actestraTeam?.request({
          contractVersion: 1,
          method: 'POST',
          path: '/api/teams/' + encodeURIComponent(targetTeamId) + '/agents',
          body: {
            experience: 'standard',
            assistant: {
              name: targetMemberName,
              role: 'teammate',
              assistant_id: targetAssistantId,
              requested_model: null,
            },
          },
        }),
      {
        targetTeamId: teamId,
        targetMemberName: memberName,
        targetAssistantId: memberAssistantId,
      }
    );
    expect(addResponse).toMatchObject({
      status: 200,
      data: { experience: 'standard', assistant: { slot_id: expect.any(String) } },
    });
    const addResult =
      addResponse?.status === 200 ? (addResponse.data as { assistant?: { slot_id?: string } }).assistant : undefined;
    expect(addResult?.slot_id).toBeTruthy();
    if (!addResult?.slot_id) throw new Error('Main/Core did not return a standard Team member slot');`,
);

writeNew(
  "tests/e2e/cases/teams/team-experience-choice.e2e.ts",
  `import { test, expect } from '../../fixtures';
import { chooseTeamExperience, cleanupTeamsByName, createTeam, navigateTo } from '../../helpers';

test.describe('Team experience chooser', () => {
  test('keeps native Team creation and Actestra collaboration creation reachable in one Electron session', async ({ page }) => {
    await navigateTo(page, '#/team');
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });

    await createBtn.click();
    await expect(page.locator('[data-testid="team-create-kind-standard"]')).toBeVisible();
    await expect(page.locator('[data-testid="team-create-kind-orchestrated"]')).toBeVisible();
    await chooseTeamExperience(page, 'standard');
    await expect(page.locator('[data-testid="team-create-layout"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="actestra-team-create-modal"]')).toHaveCount(0);
    await page.locator('.arco-modal:visible button[aria-label="Close"]').click();
    await expect(page.locator('.arco-modal:visible')).toHaveCount(0, { timeout: 5_000 });

    await createBtn.click();
    await chooseTeamExperience(page, 'orchestrated');
    await expect(page.locator('[data-testid="actestra-team-create-modal"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="team-create-layout"]')).toBeHidden();
    await page.locator('.arco-modal:visible button[aria-label="Close"]').click();
    await expect(page.locator('.arco-modal:visible')).toHaveCount(0, { timeout: 5_000 });
  });

  test('keeps the Main/Core standard provider readable before and after Claude Team creation', async ({ page }) => {
    const teamName = 'E2E Standard provider authority';
    const request = (method: 'GET' | 'DELETE', path: string) =>
      page.evaluate(
        async ({ requestMethod, requestPath }) =>
          window.actestraTeam?.request({
            contractVersion: 1,
            method: requestMethod,
            path: requestPath,
            body: undefined,
          }),
        { requestMethod: method, requestPath: path },
      );

    await cleanupTeamsByName(page, teamName);
    const before = await request('GET', '/api/teams?user_id=actestra-local-user');
    expect(before?.status).toBe(200);
    expect(before?.data).toEqual(expect.any(Array));

    let teamId = '';
    try {
      teamId = await createTeam(page, teamName, 'claude');
      await expect(page.locator('.team-create-modal')).toBeHidden({ timeout: 10_000 });

      const listed = await request('GET', '/api/teams?user_id=actestra-local-user');
      expect(listed).toMatchObject({
        status: 200,
        data: expect.arrayContaining([
          expect.objectContaining({ id: teamId, experience: 'standard', name: teamName }),
        ]),
      });
      const projected = await request('GET', '/api/teams/' + encodeURIComponent(teamId));
      expect(projected).toMatchObject({
        status: 200,
        data: { id: teamId, experience: 'standard', name: teamName },
      });
      await expect(page.locator('[data-testid="team-provider-unavailable"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="team-tab-bar"]')).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupTeamsByName(page, teamName);
    }
  });
});
  `,
);

writeNew(
  "tests/e2e/cases/teams/team-mixed-cli-members.e2e.ts",
  `import { test, expect } from '../../fixtures';
import { chooseTeamExperience, cleanupTeamsByName, invokeBridge, navigateTo } from '../../helpers';

const TEAM_NAME = 'E2E Mixed CLI Team';
const MEMBER_LABELS = ['Claude Code', 'Codex CLI'] as const;

test.describe('Standard Team mixed CLI members', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupTeamsByName(page, TEAM_NAME);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTeamsByName(page, TEAM_NAME);
  });

  test('creates one native Team with configured Claude and Codex members and preserves native views', async ({ page }) => {
    test.setTimeout(120_000);
    await navigateTo(page, '#/team');

    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await chooseTeamExperience(page, 'standard');

    const modal = page.locator('.team-create-modal');
    await expect(modal.locator('[data-testid="team-create-layout"]')).toBeVisible({ timeout: 5_000 });
    await modal.locator('[data-testid="team-create-name-input"]').fill(TEAM_NAME);

    for (const label of MEMBER_LABELS) {
      const option = modal
        .locator('[data-testid^="team-create-agent-option-"]:not(.cursor-not-allowed)')
        .filter({ hasText: label })
        .first();
      await expect(option, label + ' must remain directly selectable in Standard Team').toBeVisible({ timeout: 5_000 });
      await option.click();
    }

    const drafts = modal.locator('[data-testid^="team-create-member-draft-"]');
    await expect(drafts).toHaveCount(MEMBER_LABELS.length);
    for (const label of MEMBER_LABELS) {
      await expect(drafts.filter({ hasText: label })).toHaveCount(1);
    }

    const confirm = modal.locator('.arco-btn-primary');
    await expect(confirm).toBeEnabled({ timeout: 5_000 });
    await confirm.click();
    await page.waitForURL(/\\/team\\/[^/?#]+/, { timeout: 30_000 });

    const tabBar = page.locator('[data-testid="team-tab-bar"]');
    await expect(tabBar).toBeVisible({ timeout: 15_000 });
    const tabs = tabBar.locator('[data-testid^="team-tab-"][data-team-tab-role]');
    await expect(tabs).toHaveCount(MEMBER_LABELS.length);
    for (const label of MEMBER_LABELS) {
      await expect(tabs.filter({ hasText: label })).toHaveCount(1);
    }

    const singleToggle = page.locator('[data-testid="team-view-toggle-single"]');
    const parallelToggle = page.locator('[data-testid="team-view-toggle-parallel"]');
    await expect(singleToggle).toBeVisible();
    await expect(parallelToggle).toBeVisible();
    await singleToggle.click();
    await expect(singleToggle).toHaveAttribute('data-selected', 'true');

    for (const label of MEMBER_LABELS) {
      const tab = tabs.filter({ hasText: label });
      await tab.click();
      await expect(tab).toHaveAttribute('data-active', 'true');
    }

    await parallelToggle.click();
    await expect(parallelToggle).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-slot-id]')).toHaveCount(MEMBER_LABELS.length);

    const hash = await page.evaluate(() => window.location.hash);
    const teamId = hash.match(/#\\/team\\/([^/?#]+)/)?.[1];
    expect(teamId).toBeTruthy();
    const team = await invokeBridge<{
      experience?: string;
      assistants?: Array<{ assistant_name: string }>;
      agents?: Array<{ assistant_name: string }>;
    }>(page, 'team.get', { id: teamId });
    expect(team.experience ?? 'standard').toBe('standard');
    expect((team.assistants ?? team.agents ?? []).map((member) => member.assistant_name).sort()).toEqual(
      [...MEMBER_LABELS].sort(),
    );

    await page.screenshot({ path: 'tests/e2e/results/team-mixed-cli-members.png' });
  });
});
  `,
);

const e2eFixturesPath = "tests/e2e/fixtures.ts";
const configureChromiumPath = "packages/desktop/src/process/utils/configureChromium.ts";
replaceOnce(
  configureChromiumPath,
  `const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';
const explicitUserDataDir =
  process.env.ACTESTRA_USER_DATA_DIR ??
  (isActestraE2ETest ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined);`,
  `const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';

function requireActestraE2EAbsoluteDirectory(
  value: string | undefined,
  environmentName: string,
): string {
  value = value?.trim();
  if (!value || !path.isAbsolute(value)) {
    throw new Error(environmentName + ' must be an absolute directory during Actestra E2E');
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new Error(environmentName + ' cannot be a filesystem root during Actestra E2E');
  }
  return resolved;
}

function isStrictlyInsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

const actestraE2EIsolationRoot = isActestraE2ETest
  ? requireActestraE2EAbsoluteDirectory(
      process.env.ACTESTRA_E2E_ISOLATION_ROOT,
      'ACTESTRA_E2E_ISOLATION_ROOT',
    )
  : null;
const actestraE2EHomeDir = isActestraE2ETest
  ? requireActestraE2EAbsoluteDirectory(
      process.env.ACTESTRA_E2E_HOME_DIR,
      'ACTESTRA_E2E_HOME_DIR',
    )
  : null;
const actestraE2ETempDir = isActestraE2ETest
  ? requireActestraE2EAbsoluteDirectory(
      process.env.ACTESTRA_E2E_TEMP_DIR,
      'ACTESTRA_E2E_TEMP_DIR',
    )
  : null;
const explicitUserDataDir =
  process.env.ACTESTRA_USER_DATA_DIR ??
  (isActestraE2ETest ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined);

if (isActestraE2ETest) {
  const actestraE2EUserDataDir = requireActestraE2EAbsoluteDirectory(
    process.env.ACTESTRA_USER_DATA_DIR,
    'ACTESTRA_USER_DATA_DIR',
  );
  if (
    !actestraE2EIsolationRoot ||
    !actestraE2EHomeDir ||
    !actestraE2ETempDir ||
    ![
      actestraE2EUserDataDir,
      actestraE2EHomeDir,
      actestraE2ETempDir,
    ].every((directory) =>
      isStrictlyInsideDirectory(actestraE2EIsolationRoot, directory),
    )
  ) {
    throw new Error('Actestra E2E runtime paths must share one isolated root');
  }
  for (const directory of [
    actestraE2EIsolationRoot,
    actestraE2EUserDataDir,
    actestraE2EHomeDir,
    actestraE2ETempDir,
  ]) {
    ensureActestraPrivateDirectory(directory);
  }
  const realIsolationRoot = fs.realpathSync(actestraE2EIsolationRoot);
  if (
    ![
      actestraE2EUserDataDir,
      actestraE2EHomeDir,
      actestraE2ETempDir,
    ].every((directory) =>
      isStrictlyInsideDirectory(realIsolationRoot, fs.realpathSync(directory)),
    )
  ) {
    throw new Error('Actestra E2E runtime paths escaped their real isolated root');
  }
  app.setPath('home', actestraE2EHomeDir);
  app.setPath('temp', actestraE2ETempDir);
}`,
);
replaceOnce(
  e2eFixturesPath,
  `const e2eStateSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-state-'));
const e2eStateFile = path.join(e2eStateSandboxDir, 'extension-states.json');
// Disposable userData root so AionCore migrates a fresh DB per run instead of
// touching the developer's real database (a shared DB that fails migration
// blocks the whole app from booting). Consumed by configureChromium.ts.
const e2eUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-userdata-'));`,
  `const e2eIsolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-e2e-'));
const e2eStateSandboxDir = path.join(e2eIsolationRoot, 'state');
const e2eUserDataDir = path.join(e2eIsolationRoot, 'user-data');
const e2eHomeDir = path.join(e2eIsolationRoot, 'home');
const e2eTmpDir = path.join(e2eIsolationRoot, 'tmp');
for (const directory of [e2eStateSandboxDir, e2eUserDataDir, e2eHomeDir, e2eTmpDir]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const e2eStateFile = path.join(e2eStateSandboxDir, 'extension-states.json');
// Electron profile state, AionCore runtime/data, HOME, and temporary files all
// remain beneath one disposable root for every real Team journey.`,
);
replaceOnce(
  e2eFixturesPath,
  `  const commonEnv = {
    ...process.env,`,
  `  const inheritedEnv = { ...process.env };
  for (const credentialName of [
    'ANTHROPIC_API_KEY',
    'CODEX_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
  ]) {
    delete inheritedEnv[credentialName];
  }
  const commonEnv = {
    ...inheritedEnv,`,
);
replaceOnce(
  e2eFixturesPath,
  `async function launchApp(): Promise<ElectronApplication> {`,
  `type E2EIsolationSnapshot = {
  userData: string;
  appHome: string;
  appTemp: string;
  dataDir: string;
  envHome: string;
  envTemp: string;
};

function isInsideE2EIsolationRoot(value: string): boolean {
  if (!value) return false;
  const relative = path.relative(e2eIsolationRoot, path.resolve(value));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function verifyE2EIsolation(electronApp: ElectronApplication): Promise<void> {
  try {
    const snapshot = await electronApp.evaluate(({ app: electronMainApp }): E2EIsolationSnapshot => ({
      userData: electronMainApp.getPath('userData'),
      appHome: electronMainApp.getPath('home'),
      appTemp: electronMainApp.getPath('temp'),
      dataDir: process.env.DATA_DIR ?? '',
      envHome: process.env.HOME ?? process.env.USERPROFILE ?? '',
      envTemp: process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '',
    }));
    for (const [label, value] of Object.entries(snapshot)) {
      if (!isInsideE2EIsolationRoot(value)) {
        throw new Error('E2E ' + label + ' escaped the isolated root: ' + value);
      }
    }
    console.log('[E2E] Verified isolated runtime paths: ' + JSON.stringify(snapshot));
  } catch (error) {
    await electronApp.close().catch(() => {});
    throw error;
  }
}

async function launchApp(): Promise<ElectronApplication> {`,
);
replaceOnce(
  e2eFixturesPath,
  `    return electronApp;`,
  `    await verifyE2EIsolation(electronApp);
    return electronApp;`,
);
replaceOnce(
  e2eFixturesPath,
  `
  return electronApp;`,
  `
  await verifyE2EIsolation(electronApp);
  return electronApp;`,
);
replaceOnce(
  e2eFixturesPath,
  `    AIONUI_E2E_TEST: '1',
    AIONUI_E2E_USER_DATA_DIR: process.env.AIONUI_E2E_USER_DATA_DIR || e2eUserDataDir,
    AIONUI_CDP_PORT: '0',`,
  `    AIONUI_E2E_TEST: '1',
    AIONUI_E2E_USER_DATA_DIR: e2eUserDataDir,
    ACTESTRA_E2E_TEST: '1',
    ACTESTRA_USER_DATA_DIR: e2eUserDataDir,
    ACTESTRA_E2E_ISOLATION_ROOT: e2eIsolationRoot,
    ACTESTRA_E2E_HOME_DIR: e2eHomeDir,
    ACTESTRA_E2E_TEMP_DIR: e2eTmpDir,
    HOME: e2eHomeDir,
    USERPROFILE: e2eHomeDir,
    TMPDIR: e2eTmpDir,
    TEMP: e2eTmpDir,
    TMP: e2eTmpDir,
    DATA_DIR: e2eUserDataDir,
    LOGS_DIR: path.join(e2eUserDataDir, 'logs'),
    XDG_CONFIG_HOME: path.join(e2eHomeDir, '.config'),
    XDG_CACHE_HOME: path.join(e2eHomeDir, '.cache'),
    XDG_DATA_HOME: path.join(e2eHomeDir, '.local', 'share'),
    AIONUI_CDP_PORT: '0',`,
);
replaceOnce(
  e2eFixturesPath,
  `type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
};`,
  `type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
  restartElectronApp: () => Promise<{ electronApp: ElectronApplication; page: Page }>;
};`,
);
replaceOnce(
  e2eFixturesPath,
  `type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
  restartElectronApp: () => Promise<{ electronApp: ElectronApplication; page: Page }>;
};`,
  `type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
  restartElectronApp: () => Promise<{ electronApp: ElectronApplication; page: Page }>;
};

type E2EWorkerFixtures = {
  e2eCleanup: void;
};`,
);
replaceOnce(
  e2eFixturesPath,
  `export const test = base.extend<Fixtures>({`,
  `let cleanupPromise: Promise<void> | null = null;

async function closeE2EResources(): Promise<void> {
  if (cleanupPromise !== null) return cleanupPromise;
  cleanupPromise = (async () => {
    const activeApp = app;
    app = null;
    mainPage = null;
    if (activeApp) {
      await activeApp
        .evaluate(async ({ app: electronApp }) => {
          electronApp.exit(0);
        })
        .catch(() => {});
      await activeApp.close().catch(() => {});
    }
    fs.rmSync(e2eIsolationRoot, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

export const test = base.extend<Fixtures, E2EWorkerFixtures>({
  e2eCleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      try {
        await use();
      } finally {
        await closeE2EResources();
      }
    },
    { scope: 'worker', auto: true },
  ],`,
);
replaceOnce(
  e2eFixturesPath,
  `  page: async ({ electronApp }, use, testInfo: TestInfo) => {`,
  `  // eslint-disable-next-line no-empty-pattern
  restartElectronApp: async ({}, use) => {
    await use(async () => {
      const previousApp = app;
      app = null;
      mainPage = null;
      if (previousApp) {
        await previousApp
          .evaluate(async ({ app: electronApp }) => {
            electronApp.exit(0);
          })
          .catch(() => {});
        await previousApp.close().catch(() => {});
      }
      app = await launchApp();
      mainPage = await resolveMainWindow(app);
      return { electronApp: app, page: mainPage };
    });
  },

  page: async ({ electronApp }, use, testInfo: TestInfo) => {`,
);
replaceOnce(
  e2eFixturesPath,
  `  // Async cleanup before the worker process exits
  process.on('beforeExit', async () => {
    if (app) {
      try {
        await app.evaluate(async ({ app: electronApp }) => {
          electronApp.exit(0);
        });
      } catch {
        // ignore: app may already be closed
      }
      await app.close().catch(() => {});
      app = null;
      mainPage = null;
    }
    fs.rmSync(e2eStateSandboxDir, { recursive: true, force: true });
    fs.rmSync(e2eUserDataDir, { recursive: true, force: true });
  });`,
  `  // Async cleanup before the worker process exits
  process.on('beforeExit', async () => {
    await closeE2EResources();
  });`,
);
replaceOnce(
  e2eFixturesPath,
  `      fs.rmSync(e2eStateSandboxDir, { recursive: true, force: true });
      fs.rmSync(e2eUserDataDir, { recursive: true, force: true });`,
  `      fs.rmSync(e2eIsolationRoot, { recursive: true, force: true });`,
);

writeNew(
  "tests/e2e/cases/teams/team-orchestrated-create.e2e.ts",
  `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../../fixtures';
import { chooseTeamExperience, navigateTo } from '../../helpers';

test.describe('Actestra collaborative Team creation', () => {
  test('persists one Main-owned orchestrated Team without exposing its Workspace path', async ({
    electronApp,
    page,
    restartElectronApp,
  }) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-team-ui-e2e-'));
    const teamName = 'E2E Actestra collaborative Team';
    try {
      await electronApp.evaluate(async ({ dialog }, selectedRoot) => {
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths: [selectedRoot] });
      }, workspaceRoot);

      await navigateTo(page, '#/team');
      const createBtn = page.locator('[data-testid="team-create-btn"]').first();
      await expect(createBtn).toBeVisible({ timeout: 10_000 });
      await createBtn.click();
      await chooseTeamExperience(page, 'orchestrated');

      const modal = page.locator('[data-testid="actestra-team-create-modal"]');
      await expect(modal).toBeVisible({ timeout: 5_000 });
      await modal.locator('[data-testid="actestra-team-name-input"]').fill(teamName);
      await modal
        .locator('[data-testid="actestra-team-description-input"]')
        .fill('Coordinate one bounded General and Goose delivery.');
      await expect(modal.locator('[data-testid="actestra-team-member-row"]')).toHaveCount(2);
      await modal.locator('[data-testid="actestra-team-member-add"]').click();
      await expect(modal.locator('[data-testid="actestra-team-member-row"]')).toHaveCount(3);
      await modal.locator('[data-testid="actestra-team-member-remove"]').click();
      await expect(modal.locator('[data-testid="actestra-team-member-row"]')).toHaveCount(2);

      await modal.locator('[data-testid="actestra-team-workspace-grant"]').click();
      await expect(modal).toContainText(path.basename(workspaceRoot), { timeout: 10_000 });
      const submit = page.locator('[data-testid="actestra-team-create-submit"]');
      await expect(submit).toBeEnabled({ timeout: 10_000 });
      await submit.click();
      await page.waitForFunction(
        () => window.location.hash.startsWith('#/team/team-') && window.location.hash.length === 76,
        undefined,
        { timeout: 15_000 },
      );
      await expect(page.locator('[data-testid="actestra-team-workspace"]')).toBeVisible({
        timeout: 10_000,
      });

      const teamId = await page.evaluate(() => window.location.hash.split('/').at(-1) ?? '');
      const firstProjection = await page.evaluate(async (id) => {
        return window.actestraTeam?.request({
          contractVersion: 1,
          method: 'GET',
          path: '/api/teams/' + encodeURIComponent(id),
          body: undefined,
        });
      }, teamId);
      expect(firstProjection).toMatchObject({
        status: 200,
        data: { id: teamId, experience: 'orchestrated', name: teamName },
      });
      expect(JSON.stringify(firstProjection)).not.toContain(workspaceRoot);

      await page
        .locator('[data-testid="actestra-team-task-input"]')
        .fill('Prepare one bounded plan.');
      await page.locator('[data-testid="actestra-team-run-submit"]').click();
      await expect(page.locator('[data-testid="actestra-team-submit-error"]')).toContainText(
        /planner|规划器|不可用/iu,
        { timeout: 10_000 },
      );
      await expect(page.locator('[data-testid^="actestra-team-node-"]')).toHaveCount(0);

      const restarted = await restartElectronApp();
      await navigateTo(restarted.page, '#/team/' + teamId);
      await expect(
        restarted.page.locator('[data-testid="actestra-team-workspace"]'),
      ).toBeVisible({ timeout: 15_000 });
      const restoredProjection = await restarted.page.evaluate(async (id) => {
        return window.actestraTeam?.request({
          contractVersion: 1,
          method: 'GET',
          path: '/api/teams/' + encodeURIComponent(id),
          body: undefined,
        });
      }, teamId);
      expect(restoredProjection).toMatchObject({
        status: 200,
        data: { id: teamId, experience: 'orchestrated', name: teamName },
      });
      expect(JSON.stringify(restoredProjection)).not.toContain(workspaceRoot);
      await restarted.page.evaluate(async (id) => {
        await window.actestraTeam?.request({
          contractVersion: 1,
          method: 'DELETE',
          path: '/api/teams/' + encodeURIComponent(id),
          body: undefined,
        });
      }, teamId);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
  `,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/en-US/team.json",
  `    "sessionStopped": "The team session has stopped.",
    "retryStart": "Retry start"`,
  `    "sessionStopped": "The team session has stopped.",
    "retryStart": "Retry start",
    "slowResponse": "This assistant has not produced a reply or tool call yet.",
    "cancelResponse": "Cancel response",
    "retryRequest": "Retry request",
    "cancelResponseFailed": "Failed to cancel this response. Please try again.",
    "retryRequestFailed": "Failed to retry this request. The previous response was cancelled.",
    "retryUnavailable": "The original request is unavailable. Enter it again in the message box.",
    "slowRecoveryUnavailable": "This response can no longer be recovered. Refresh the Team state and try again."`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/zh-CN/team.json",
  `    "sessionStopped": "团队会话已停止。",
    "retryStart": "重试启动"`,
  `    "sessionStopped": "团队会话已停止。",
    "retryStart": "重试启动",
    "slowResponse": "该成员尚未产生回复或工具调用。",
    "cancelResponse": "取消本次回复",
    "retryRequest": "重试本次请求",
    "cancelResponseFailed": "取消本次回复失败，请重试。",
    "retryRequestFailed": "重试请求失败；上一次回复已取消。",
    "retryUnavailable": "找不到原始请求，请在消息框中重新输入。",
    "slowRecoveryUnavailable": "该回复已无法恢复，请刷新 Team 状态后重试。"`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/en-US/team.json",
  `  "reorderMember": "Drag to reorder member"
}`,
  `  "reorderMember": "Drag to reorder member",
  "experience": {
    "chooseTitle": "Choose Team type",
    "standardTitle": "Standard Team",
    "standardDescription": "Choose configured Claude Code, Codex CLI, Gemini CLI, or other team-ready assistants with the full native AionUI Team experience.",
    "orchestratedTitle": "Actestra Collaborative Team",
    "orchestratedDescription": "Use General and Goose with plans, dependencies, approvals, Artifacts, and recovery managed by Actestra Core.",
    "providerUnavailable": "Actestra Collaborative Teams are temporarily unavailable. Standard Teams remain available.",
    "loadFailed": "This Team could not be loaded from its authoritative provider.",
    "unavailableTitle": "Team experience unavailable",
    "unavailableDescription": "This Team has an unknown or unsupported experience type. Its data was not opened.",
    "invalidProjection": "This Team has an invalid authority projection.",
    "authorityConflict": "Two providers returned the same Team identity, so this Team was not opened."
  },
  "actestra": {
    "createTitle": "Create Actestra Collaborative Team",
    "createSubtitle": "Set up General and Goose roles in one approved workspace.",
    "createAction": "Create Team",
    "createInvalid": "Complete the Team name, workspace, and member settings.",
    "createFailed": "Actestra could not create this Team.",
    "createFailedNextStep": "Keep these settings, review the workspace grant, and retry.",
    "coreAuthorityTitle": "Actestra Core",
    "coreAuthorityDescription": "Plans, approvals, execution, Artifacts, and recovery stay under Actestra control.",
    "namePlaceholder": "Name this Team",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "What should this Team collaborate on?",
    "workspaceLabel": "Workspace",
    "workspacePlaceholder": "Choose an approved workspace",
    "workspaceUnavailable": "Workspace access is unavailable",
    "workspaceEmpty": "Grant a workspace in Actestra before creating this Team.",
    "chooseWorkspaceAction": "Choose and authorize a workspace",
    "workspaceGrantFailed": "Actestra could not authorize that workspace.",
    "providerLabel": "Model provider",
    "providerPlaceholder": "Choose a configured provider",
    "modelLabel": "Model",
    "modelPlaceholder": "Choose a healthy model",
    "generalWorkerLabel": "General Worker",
    "gooseWorkerLabel": "Goose coding Worker",
    "generalDefaultName": "General",
    "gooseDefaultName": "Goose",
    "leader": "Team leader",
    "leaderGeneral": "General",
    "leaderGoose": "Goose",
    "membersConfig": "Members and roles",
    "membersHint": "{{count}} of 5 members · keep at least one General and one Goose",
    "addMember": "Add member",
    "removeMember": "Remove member",
    "capabilityLabel": "Worker capability",
    "memberNameLabel": "Member name",
    "typeLabel": "Actestra Team",
    "authorityCaption": "{{workspace}} · Actestra Core authority",
    "cancelWholeTeam": "Cancel Team",
    "members": "Members and roles",
    "authoritySourceTitle": "Authority source",
    "authoritySourceDescription": "Actestra Core owns Team identity, plan, approvals, attempts, Artifacts, and recovery.",
    "currentExecutorTitle": "Current executor",
    "noCurrentExecutor": "None",
    "groupChat": "Team group chat",
    "groupChatDescription": "Give the Team one bounded goal. General and Goose updates stay linked to the same authoritative run.",
    "noRun": "No Team run yet. Enter a task below to start planning.",
    "recoveredRevision": "Actestra Core · recovered revision {{revision}}",
    "taskPlaceholder": "Describe the Team goal, expected result, and constraints…",
    "taskPrivacy": "Text only · no renderer paths, models, credentials, or Worker IDs",
    "runTeam": "Run Team",
    "planTitle": "Plan and Worker state",
    "revision": "revision {{revision}}",
    "authorityUnavailable": "Team authority is temporarily unavailable.",
    "dependsOn": "Depends on {{count}} earlier node(s)",
    "runStatus": {
      "accepted": "Accepted",
      "running": "Running",
      "paused": "Paused",
      "blocked": "Blocked",
      "cancelling": "Cancelling",
      "completed": "Completed",
      "cancelled": "Cancelled",
      "failed": "Failed"
    },
    "assistantStatus": {
      "pending": "Pending",
      "idle": "Idle",
      "active": "Active",
      "completed": "Completed",
      "failed": "Failed",
      "dormant": "Dormant"
    },
    "nodeState": {
      "queued": "Queued",
      "ready": "Ready",
      "running": "Running",
      "blocked": "Blocked",
      "paused": "Paused",
      "handoff-required": "Handoff required",
      "revision-requested": "Changes requested",
      "completed": "Completed",
      "failed": "Failed",
      "cancelled": "Cancelled"
    },
    "capability": {
      "general": "General work",
      "coding": "Coding",
      "feedback": "User feedback"
    },
    "blocked": {
      "dependency": "This node is waiting for an earlier node to complete.",
      "humanFeedback": "This node is waiting for your feedback.",
      "protectedApproval": "Approval is required before the protected operation can continue.",
      "attemptFailed": "The previous attempt failed; retry the Worker to continue.",
      "cancelled": "This node was cancelled by the Team authority.",
      "paused": "This node is paused; resume it or choose another valid action.",
      "handoff": "This node needs a handoff before work can continue.",
      "interrupted": "This node was interrupted during recovery and needs a valid retry.",
      "revisionRequested": "Changes were requested. Continue review when the revised result is ready.",
      "unknown": "This node is blocked for an unavailable reason; refresh the Team state."
    },
    "artifactLabel": "Artifact · {{label}}",
    "handoffPlaceholder": "Describe the reviewed result that will become the manual handoff Artifact.",
    "handoffComplete": "Complete handoff",
    "feedbackContinue": "Continue",
    "feedbackRevise": "Request changes",
    "resultTitle": "Aggregated result",
    "planEmpty": "Plan, dependencies, blocked reasons, controls, and Artifacts will appear here.",
    "plannerUnavailable": "The supervised Team planner is unavailable.",
    "plannerUnavailableNextStep": "Check the admitted planner and retry this task.",
    "workerRuntimeUnavailable": "The required General and Goose Worker runtime is unavailable.",
    "workerRuntimeUnavailableNextStep": "Configure both Worker runtimes in Actestra, then refresh this Team.",
    "plannerInvalid": "The supervised Team planner returned an invalid plan.",
    "plannerInvalidNextStep": "Review the Team goal and planner configuration, then retry without changing the Team identity.",
    "plannerTimeout": "The supervised Team planner timed out.",
    "plannerTimeoutNextStep": "Confirm the planner is responsive, then retry this task.",
    "invalidRequest": "This Team task body has an invalid format.",
    "invalidRequestNextStep": "Remove control characters and leading or trailing blank lines, then submit the task again.",
    "submitFailed": "Actestra Core could not start this Team task.",
    "submitFailedNextStep": "Review the Team state, then retry without changing the authoritative Team identity.",
    "controlFailed": "The Team control failed.",
    "controlFailedNextStep": "Refresh the Team state, then retry only an action shown as valid.",
    "feedbackFailed": "The Team feedback failed.",
    "feedbackFailedNextStep": "Refresh the Team state, then submit feedback again if it is still requested.",
    "cancelFailed": "The Team could not be cancelled.",
    "cancelFailedNextStep": "Refresh the Team state and confirm whether cancellation completed before retrying.",
    "renameFailed": "The Team name could not be saved.",
    "renameFailedNextStep": "Refresh the Team state, then try the rename again.",
    "role": { "leader": "Leader", "teammate": "Teammate" },
    "action": {
      "approve": "Approve",
      "deny": "Deny",
      "pause": "Pause",
      "resume": "Resume",
      "cancel": "Cancel",
      "retry": "Retry",
      "replace": "Replace",
      "handoff": "Handoff",
      "revise": "Continue review"
    }
  }
}`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/zh-CN/team.json",
  `  "reorderMember": "拖动以调整成员顺序"
}`,
  `  "reorderMember": "拖动以调整成员顺序",
  "experience": {
    "chooseTitle": "选择团队类型",
    "standardTitle": "标准 Team",
    "standardDescription": "直接选择已配置的 Claude Code、Codex CLI、Gemini CLI 或其他可组队助手，使用完整的 AionUI 原生 Team 协作体验。",
    "orchestratedTitle": "Actestra 协作 Team",
    "orchestratedDescription": "固定使用 General 与 Goose，由 Actestra Core 管理计划、依赖、审批、Artifact 与恢复。",
    "providerUnavailable": "Actestra 协作 Team 暂时不可用，标准 Team 仍可正常使用。",
    "loadFailed": "无法从该 Team 的权威 provider 加载数据。",
    "unavailableTitle": "此 Team 体验不可用",
    "unavailableDescription": "该 Team 的体验类型未知或不受支持，数据未被打开。",
    "invalidProjection": "该 Team 的权威投影无效。",
    "authorityConflict": "两个 provider 返回了相同的 Team 身份，因此该 Team 未被打开。"
  },
  "actestra": {
    "createTitle": "创建 Actestra 协作 Team",
    "createSubtitle": "在一个已授权工作空间中配置 General 与 Goose 的协作角色。",
    "createAction": "创建 Team",
    "createInvalid": "请补全 Team 名称、工作空间和成员设置。",
    "createFailed": "Actestra 无法创建这个 Team。",
    "createFailedNextStep": "已保留当前设置，请检查工作空间授权后重试。",
    "coreAuthorityTitle": "Actestra Core",
    "coreAuthorityDescription": "计划、审批、执行、Artifact 与恢复均由 Actestra 管理。",
    "namePlaceholder": "给这个 Team 命名",
    "descriptionLabel": "说明",
    "descriptionPlaceholder": "这个 Team 要协作完成什么？",
    "workspaceLabel": "工作空间",
    "workspacePlaceholder": "选择已授权的工作空间",
    "workspaceUnavailable": "工作空间访问暂不可用",
    "workspaceEmpty": "请先在 Actestra 中授权一个工作空间。",
    "chooseWorkspaceAction": "选择并授权工作空间",
    "workspaceGrantFailed": "Actestra 无法授权该工作空间。",
    "providerLabel": "模型 Provider",
    "providerPlaceholder": "选择已配置的 Provider",
    "modelLabel": "模型",
    "modelPlaceholder": "选择健康的模型",
    "generalWorkerLabel": "General Worker",
    "gooseWorkerLabel": "Goose 编码 Worker",
    "generalDefaultName": "General",
    "gooseDefaultName": "Goose",
    "leader": "Team Leader",
    "leaderGeneral": "General",
    "leaderGoose": "Goose",
    "membersConfig": "成员与角色",
    "membersHint": "当前 {{count}} / 5 名成员 · 至少保留一个 General 与一个 Goose",
    "addMember": "添加成员",
    "removeMember": "移除成员",
    "capabilityLabel": "Worker 能力",
    "memberNameLabel": "成员名称",
    "typeLabel": "Actestra Team",
    "authorityCaption": "{{workspace}} · Actestra Core 权威",
    "cancelWholeTeam": "取消整个 Team",
    "members": "成员与角色",
    "authoritySourceTitle": "权威来源",
    "authoritySourceDescription": "Team 身份、计划、审批、attempt、Artifact 与恢复均由 Actestra Core 管理。",
    "currentExecutorTitle": "当前执行者",
    "noCurrentExecutor": "无",
    "groupChat": "Team 群聊",
    "groupChatDescription": "给 Team 一个边界清晰的目标；General 与 Goose 的更新会归属于同一个权威 run。",
    "noRun": "尚未运行 Team，请在下方输入任务开始规划。",
    "recoveredRevision": "Actestra Core · 已恢复 revision {{revision}}",
    "taskPlaceholder": "描述 Team 目标、预期结果与约束…",
    "taskPrivacy": "仅文本 · renderer 不接收路径、模型、凭据或 Worker ID",
    "runTeam": "运行 Team",
    "planTitle": "计划与 Worker 状态",
    "revision": "revision {{revision}}",
    "authorityUnavailable": "Team 权威状态暂不可用。",
    "dependsOn": "依赖前序 {{count}} 个节点",
    "runStatus": {
      "accepted": "已接受",
      "running": "运行中",
      "paused": "已暂停",
      "blocked": "已阻塞",
      "cancelling": "取消中",
      "completed": "已完成",
      "cancelled": "已取消",
      "failed": "失败"
    },
    "assistantStatus": {
      "pending": "等待中",
      "idle": "空闲",
      "active": "工作中",
      "completed": "已完成",
      "failed": "失败",
      "dormant": "休眠"
    },
    "nodeState": {
      "queued": "排队中",
      "ready": "可执行",
      "running": "运行中",
      "blocked": "已阻塞",
      "paused": "已暂停",
      "handoff-required": "需要转交",
      "revision-requested": "已要求修改",
      "completed": "已完成",
      "failed": "失败",
      "cancelled": "已取消"
    },
    "capability": {
      "general": "通用工作",
      "coding": "编码",
      "feedback": "用户反馈"
    },
    "blocked": {
      "dependency": "该节点正在等待前置节点完成。",
      "humanFeedback": "该节点正在等待你的反馈。",
      "protectedApproval": "受保护操作继续前需要审批。",
      "attemptFailed": "上一次尝试失败，请重试 Worker 以继续。",
      "cancelled": "该节点已被 Team 权威取消。",
      "paused": "该节点已暂停，请恢复或选择其他有效操作。",
      "handoff": "该节点需要完成交接后才能继续。",
      "interrupted": "该节点在恢复过程中被中断，需要执行有效重试。",
      "revisionRequested": "已要求修改；修订后的结果准备好后，请继续审阅。",
      "unknown": "该节点因未知原因阻塞，请刷新 Team 状态。"
    },
    "artifactLabel": "Artifact · {{label}}",
    "handoffPlaceholder": "填写已审核的结果，Main 会将其保存为人工交接 Artifact。",
    "handoffComplete": "完成交接",
    "feedbackContinue": "继续",
    "feedbackRevise": "要求修改",
    "resultTitle": "聚合结果",
    "planEmpty": "计划、依赖、阻塞原因、控制项与 Artifact 会显示在这里。",
    "plannerUnavailable": "受监督 Team planner 暂不可用。",
    "plannerUnavailableNextStep": "请检查已准入的 planner，然后重试此任务。",
    "workerRuntimeUnavailable": "所需的 General 与 Goose Worker runtime 暂不可用。",
    "workerRuntimeUnavailableNextStep": "请先在 Actestra 中配置两个 Worker runtime，然后刷新此 Team。",
    "plannerInvalid": "受监督 Team planner 返回了无效计划。",
    "plannerInvalidNextStep": "请检查 Team 目标与 planner 配置，然后在不更改 Team 身份的情况下重试。",
    "plannerTimeout": "受监督 Team planner 响应超时。",
    "plannerTimeoutNextStep": "请确认 planner 可正常响应，然后重试此任务。",
    "invalidRequest": "此 Team 任务正文格式无效。",
    "invalidRequestNextStep": "请移除控制字符与首尾空白行，然后重新提交任务。",
    "submitFailed": "Actestra Core 无法启动此 Team 任务。",
    "submitFailedNextStep": "请检查 Team 状态后重试；权威 Team 身份不会被更改。",
    "controlFailed": "Team 控制操作失败。",
    "controlFailedNextStep": "请刷新 Team 状态，然后仅重试仍显示为有效的操作。",
    "feedbackFailed": "Team 反馈提交失败。",
    "feedbackFailedNextStep": "请刷新 Team 状态；如果仍需要反馈，再次提交。",
    "cancelFailed": "无法取消该 Team。",
    "cancelFailedNextStep": "请刷新 Team 状态，确认取消结果后再重试。",
    "renameFailed": "Team 名称保存失败。",
    "renameFailedNextStep": "请刷新 Team 状态，然后再次尝试重命名。",
    "role": { "leader": "Leader", "teammate": "成员" },
    "action": {
      "approve": "批准",
      "deny": "拒绝",
      "pause": "暂停",
      "resume": "恢复",
      "cancel": "取消",
      "retry": "重试",
      "replace": "替换",
      "handoff": "转交",
      "revise": "继续审阅"
    }
  }
}`,
);

writeNew(
  "tests/unit/renderer/team/TeamSlowResponse.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ITeamSlotWork } from '@/common/types/team/teamTypes';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import {
  buildTeamSendRuntime,
  buildTeamWorkStatusText,
} from '@/renderer/pages/team/components/teamSendRuntime';
import type { TeamRunViewState } from '@/renderer/pages/team/hooks/useTeamRunView';

vi.mock('@arco-design/web-react', () => ({
  Spin: () => <span data-testid='spinner' />,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const slowWork: ITeamSlotWork = {
  slot_id: 'gemini-lead',
  role: 'lead',
  state: 'running',
  queued_foreground_count: 0,
  queued_background_count: 0,
  active_turn_id: 'turn-gemini',
  active_turn_started_at_ms: Date.now() - 120_000,
  active_turn_elapsed_ms: 120_000,
  active_turn_slow: false,
  active_turn_slow_threshold_ms: 30_000,
  blocked_reason: null,
  team_run_id: 'run-gemini',
};

const slowRunView: TeamRunViewState = {
  activeRun: {
    team_id: 'team-gemini',
    team_run_id: 'run-gemini',
    source: 'user_message',
    has_user_intervention: false,
    target_slot_id: 'gemini-lead',
    target_role: 'lead',
    status: 'running',
    queued_intent_count: 0,
    starting_batch_count: 0,
    running_batch_count: 1,
    active_enqueue_lease_count: 0,
    slot_work: [slowWork],
  },
  childTurnsBySlot: {},
  slotWorkBySlot: { 'gemini-lead': slowWork },
  sessionStopped: false,
};

describe('Standard Team slow-response recovery', () => {
  it('derives the slow state from authoritative timing when the provider flag remains false', () => {
    const runtime = buildTeamSendRuntime({ slot_id: 'gemini-lead', runView: slowRunView });
    const status = buildTeamWorkStatusText(slowWork, {
      processing: () => 'processing',
      processingWithQueued: () => 'processing with queue',
      slowResponse: () => 'Gemini CLI has not produced a reply or tool call yet.',
      runtimeStarting: () => 'runtime starting',
      runtimeFailed: () => 'runtime failed',
      removing: () => 'removing',
      sessionStopped: () => 'session stopped',
    });

    expect(runtime.slowResponse).toBe(true);
    expect(status).toBe('Gemini CLI has not produced a reply or tool call yet.');
  });

  it('renders explicit cancel, retry, and manual add-member recovery actions', () => {
    const onCancelSlowResponse = vi.fn();
    const onRetrySlowResponse = vi.fn();
    const onAddTeamMember = vi.fn();

    render(
      <ThoughtDisplay
        running
        slowResponse
        statusText='Gemini CLI has not produced a reply or tool call yet.'
        onCancelSlowResponse={onCancelSlowResponse}
        onRetrySlowResponse={onRetrySlowResponse}
        onAddTeamMember={onAddTeamMember}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(onCancelSlowResponse).toHaveBeenCalledOnce();
    expect(onRetrySlowResponse).toHaveBeenCalledOnce();
    expect(onAddTeamMember).toHaveBeenCalledOnce();
  });
});
  `,
);

writeNew(
  "tests/unit/renderer/team/TeamSlowResponseWiring.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITeamRunAck, ITeamSlotWork } from '@/common/types/team/teamTypes';
import type { TeamRunViewState } from '@/renderer/pages/team/hooks/useTeamRunView';

const acpChatMock = vi.fn(() => <div data-testid='mock-acp-chat' />);
const cancelChildTurnMock = vi.fn();
const sendMessageToAgentMock = vi.fn();
const sendStandardTeamMemberMessageMock = vi.fn();
const cancelStandardTeamMemberWorkMock = vi.fn();
const getConversationMessagesMock = vi.fn();
const messageErrorMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      attachAgent: { invoke: vi.fn() },
      pauseSlotWork: { invoke: vi.fn() },
      cancelChildTurn: { invoke: (...args: unknown[]) => cancelChildTurnMock(...args) },
      sendMessageToAgent: { invoke: (...args: unknown[]) => sendMessageToAgentMock(...args) },
    },
    database: {
      getConversationMessages: { invoke: (...args: unknown[]) => getConversationMessagesMock(...args) },
    },
  },
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => true,
  sendStandardTeamMemberMessage: (...args: unknown[]) => sendStandardTeamMemberMessageMock(...args),
  cancelStandardTeamMemberWork: (...args: unknown[]) => cancelStandardTeamMemberWorkMock(...args),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { error: (...args: unknown[]) => messageErrorMock(...args) },
    Spin: () => <span data-testid='spinner' />,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: { name: 'Gemini', backend: 'gemini' } }),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/AcpChat', () => ({
  __esModule: true,
  default: (props: unknown) => acpChatMock(props),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-aionrs-chat' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/legacy/LegacyReadOnlyConversation', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-legacy-conversation' />,
}));

import TeamChatView from '@/renderer/pages/team/components/TeamChatView';

const slowWork: ITeamSlotWork = {
  slot_id: 'gemini-slot',
  role: 'teammate',
  state: 'running',
  queued_foreground_count: 0,
  queued_background_count: 0,
  active_turn_id: 'turn-gemini',
  active_turn_started_at_ms: Date.now() - 120_000,
  active_turn_elapsed_ms: 120_000,
  active_turn_slow: false,
  active_turn_slow_threshold_ms: 30_000,
  blocked_reason: null,
  team_run_id: 'run-gemini',
};

const runView: TeamRunViewState = {
  activeRun: {
    team_id: 'team-gemini',
    team_run_id: 'run-gemini',
    source: 'user_message',
    has_user_intervention: false,
    target_slot_id: 'gemini-slot',
    target_role: 'teammate',
    status: 'running',
    queued_intent_count: 0,
    starting_batch_count: 0,
    running_batch_count: 1,
    active_enqueue_lease_count: 0,
    slot_work: [slowWork],
  },
  childTurnsBySlot: {},
  slotWorkBySlot: { 'gemini-slot': slowWork },
  sessionStopped: false,
};

const retryAck: ITeamRunAck = {
  enqueue_status: 'accepted',
  message_id: 'message-retry',
  run: runView.activeRun!,
};

const renderSlowTeamChat = (props?: {
  onRequestAddMember?: () => void;
  onTeamRunAck?: (ack: ITeamRunAck) => void;
  onRunStateStale?: () => Promise<boolean>;
}) => {
  return render(
    <TeamChatView
      team_id='team-gemini'
      slot_id='gemini-slot'
      assistant_name='Gemini'
      assistant_backend='gemini'
      conversation={{
        id: 'conversation-gemini',
        type: 'acp',
        name: 'Gemini teammate',
        created_at: Date.now(),
        updated_at: Date.now(),
        extra: { workspace: '/tmp' },
      }}
      teamRunView={runView}
      onRequestAddMember={props?.onRequestAddMember}
      onTeamRunAck={props?.onTeamRunAck}
      onRunStateStale={props?.onRunStateStale}
    />
  );
};

const latestTeamRuntime = async () => {
  await screen.findByTestId('mock-acp-chat');
  return (acpChatMock.mock.calls.at(-1)?.[0] as { teamRuntime?: Record<string, unknown> }).teamRuntime!;
};

describe('Standard Team slow-response bridge wiring', () => {
  beforeEach(() => {
    acpChatMock.mockClear();
    cancelChildTurnMock.mockReset();
    sendMessageToAgentMock.mockReset();
    sendStandardTeamMemberMessageMock.mockReset();
    cancelStandardTeamMemberWorkMock.mockReset();
    getConversationMessagesMock.mockReset();
    messageErrorMock.mockReset();
    window.localStorage.clear();
    cancelChildTurnMock.mockResolvedValue(undefined);
    sendMessageToAgentMock.mockResolvedValue(retryAck);
    sendStandardTeamMemberMessageMock.mockResolvedValue(retryAck);
    cancelStandardTeamMemberWorkMock.mockResolvedValue(undefined);
  });

  it('routes provider-active member messages through Actestra Main and never the native direct IPC', async () => {
    renderSlowTeamChat();
    await screen.findByTestId('mock-acp-chat');
    const props = acpChatMock.mock.calls.at(-1)?.[0] as {
      teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;
    };

    await act(async () => {
      await props.teamSendMessage?.({ input: 'Review this file.', files: ['/tmp/workspace/brief.txt'] });
    });

    expect(sendStandardTeamMemberMessageMock).toHaveBeenCalledWith({
      teamId: 'team-gemini',
      slotId: 'gemini-slot',
      content: 'Review this file.',
      files: ['/tmp/workspace/brief.txt'],
      requestNonce: expect.stringMatching(/^team-request-[a-f0-9]{64}$/),
    });
    expect(sendMessageToAgentMock).not.toHaveBeenCalled();
  });

  it('reuses the persisted request nonce after a failed bridge response and renderer remount', async () => {
    sendStandardTeamMemberMessageMock.mockRejectedValueOnce(new Error('bridge response lost'));
    const first = renderSlowTeamChat();
    await screen.findByTestId('mock-acp-chat');
    const firstProps = acpChatMock.mock.calls.at(-1)?.[0] as {
      teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;
    };
    await act(async () => {
      await expect(
        firstProps.teamSendMessage?.({ input: 'Persist this request.', files: [] })
      ).rejects.toThrow('bridge response lost');
    });
    const firstRequest = sendStandardTeamMemberMessageMock.mock.calls[0]?.[0] as {
      requestNonce?: string;
    };
    expect(firstRequest.requestNonce).toMatch(/^team-request-[a-f0-9]{64}$/);

    first.unmount();
    renderSlowTeamChat();
    await screen.findByTestId('mock-acp-chat');
    const secondProps = acpChatMock.mock.calls.at(-1)?.[0] as {
      teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;
    };
    await act(async () => {
      await secondProps.teamSendMessage?.({ input: 'Persist this request.', files: [] });
    });
    expect(sendStandardTeamMemberMessageMock).toHaveBeenCalledTimes(2);
    expect(sendStandardTeamMemberMessageMock.mock.calls[1]?.[0]).toMatchObject({
      requestNonce: firstRequest.requestNonce,
    });
  });

  it('projects an explicit no-reply-or-tool-call status and a real child-turn cancel action', async () => {
    renderSlowTeamChat();
    const runtime = await latestTeamRuntime();

    expect(runtime).toEqual(
      expect.objectContaining({
        slowResponse: true,
        statusText: 'This assistant has not produced a reply or tool call yet.',
      })
    );

    await act(async () => {
      await (runtime.onCancelSlowResponse as () => Promise<void>)();
    });
    expect(cancelStandardTeamMemberWorkMock).toHaveBeenCalledWith({
      teamId: 'team-gemini',
      runId: 'run-gemini',
      slotId: 'gemini-slot',
      reason: 'slow_response',
    });
    expect(cancelChildTurnMock).not.toHaveBeenCalled();
  });

  it('recovers the last persisted user request after renderer reload, cancels, then resubmits it', async () => {
    getConversationMessagesMock.mockResolvedValue({
      items: [
        {
          id: 'assistant-message',
          conversation_id: 'conversation-gemini',
          type: 'text',
          position: 'left',
          content: { content: 'Earlier answer' },
        },
        {
          id: 'user-message',
          conversation_id: 'conversation-gemini',
          type: 'text',
          position: 'right',
          content: { content: 'Review this workspace and summarize the result.' },
        },
      ],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });
    const onTeamRunAck = vi.fn();
    renderSlowTeamChat({ onTeamRunAck });
    const runtime = await latestTeamRuntime();

    await act(async () => {
      await (runtime.onRetrySlowResponse as () => Promise<void>)();
    });

    expect(getConversationMessagesMock).toHaveBeenCalledWith({
      conversation_id: 'conversation-gemini',
      limit: 50,
      content_mode: 'full',
    });
    expect(cancelStandardTeamMemberWorkMock).toHaveBeenCalledOnce();
    expect(sendStandardTeamMemberMessageMock).toHaveBeenCalledWith({
      teamId: 'team-gemini',
      slotId: 'gemini-slot',
      content: 'Review this workspace and summarize the result.',
      files: [],
      requestNonce: expect.stringMatching(/^team-request-[a-f0-9]{64}$/),
    });
    expect(cancelStandardTeamMemberWorkMock.mock.invocationCallOrder[0]).toBeLessThan(
      sendStandardTeamMemberMessageMock.mock.invocationCallOrder[0]!
    );
    expect(cancelChildTurnMock).not.toHaveBeenCalled();
    expect(sendMessageToAgentMock).not.toHaveBeenCalled();
    expect(onTeamRunAck).toHaveBeenCalledWith(retryAck);
  });

  it('does not cancel or resubmit when the persisted original request is unavailable', async () => {
    getConversationMessagesMock.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });
    renderSlowTeamChat();
    const runtime = await latestTeamRuntime();

    await act(async () => {
      await (runtime.onRetrySlowResponse as () => Promise<void>)();
    });

    expect(cancelChildTurnMock).not.toHaveBeenCalled();
    expect(sendMessageToAgentMock).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith(
      'The original request is unavailable. Enter it again in the message box.'
    );
  });

  it('shows an explicit failure and reconciles after cancellation succeeds but resubmission fails', async () => {
    getConversationMessagesMock.mockResolvedValue({
      items: [
        {
          id: 'user-message',
          conversation_id: 'conversation-gemini',
          type: 'text',
          position: 'right',
          content: { content: 'Retry this request.' },
        },
      ],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });
    sendStandardTeamMemberMessageMock.mockRejectedValueOnce(new Error('runtime unavailable'));
    const onRunStateStale = vi.fn().mockResolvedValue(true);
    renderSlowTeamChat({ onRunStateStale });
    const runtime = await latestTeamRuntime();

    await act(async () => {
      await (runtime.onRetrySlowResponse as () => Promise<void>)();
    });

    expect(cancelStandardTeamMemberWorkMock).toHaveBeenCalledOnce();
    expect(sendStandardTeamMemberMessageMock).toHaveBeenCalledOnce();
    expect(cancelChildTurnMock).not.toHaveBeenCalled();
    expect(sendMessageToAgentMock).not.toHaveBeenCalled();
    expect(onRunStateStale).toHaveBeenCalledOnce();
    expect(messageErrorMock).toHaveBeenCalledWith(
      'Failed to retry this request. The previous response was cancelled.'
    );
  });

  it('opens the native controlled add-member picker instead of querying the DOM', async () => {
    const onRequestAddMember = vi.fn();
    renderSlowTeamChat({ onRequestAddMember });
    const runtime = await latestTeamRuntime();

    (runtime.onAddTeamMember as () => void)();

    expect(onRequestAddMember).toHaveBeenCalledOnce();
  });
});
  `,
);

writeNew(
  "tests/unit/renderer/team/TeamAddMemberRequest.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamAssistant } from '@/common/types/team/teamTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@/renderer/pages/team/components/AgentStatusBadge', () => ({
  default: ({ testId }: { testId: string }) => <span data-testid={testId} />,
}));

vi.mock('@/renderer/pages/team/components/TeamAgentIdentity', () => ({
  default: ({ assistant_name }: { assistant_name: string }) => <span>{assistant_name}</span>,
}));

vi.mock('@/renderer/pages/team/components/memberPicker/TeamAddMemberPopover', () => ({
  default: ({ children, openRequestId }: { children: React.ReactNode; openRequestId?: number }) => (
    <div data-testid='mock-add-member-popover' data-open-request-id={openRequestId ?? 0}>{children}</div>
  ),
}));

import TeamTabs from '@/renderer/pages/team/components/TeamTabs';
import { TeamTabsProvider, useTeamTabs } from '@/renderer/pages/team/hooks/TeamTabsContext';

const assistants: TeamAssistant[] = [
  {
    slot_id: 'lead-slot',
    conversation_id: 'lead-conv',
    role: 'leader',
    assistant_backend: 'claude',
    assistant_name: 'Lead',
    status: 'idle',
  },
];

const SlowRecoveryRequest: React.FC = () => {
  const { requestAddMember } = useTeamTabs();
  return <button onClick={requestAddMember}>recover with another member</button>;
};

describe('Team add-member open request', () => {
  beforeEach(() => localStorage.clear());

  it('routes a recovery request through TeamTabs context into the controlled native popover', () => {
    render(
      <TeamTabsProvider
        assistants={assistants}
        statusMap={new Map()}
        defaultActiveSlotId='lead-slot'
        team_id='team-1'
        addAssistant={vi.fn()}
      >
        <SlowRecoveryRequest />
        <TeamTabs />
      </TeamTabsProvider>
    );

    expect(screen.getByTestId('mock-add-member-popover')).toHaveAttribute('data-open-request-id', '0');
    fireEvent.click(screen.getByRole('button', { name: 'recover with another member' }));
    expect(screen.getByTestId('mock-add-member-popover')).toHaveAttribute('data-open-request-id', '1');
  });
});
  `,
);

writeNew(
  "tests/unit/renderer/team/useTeamRunViewSlowReconcile.dom.test.tsx",
  `// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITeamRunStateResponse } from '@/common/types/team/teamTypes';

const { getRunStateMock } = vi.hoisted(() => ({ getRunStateMock: vi.fn() }));

vi.mock('@/common', () => {
  const emitter = () => ({ on: vi.fn(() => () => undefined) });
  return {
    ipcBridge: {
      team: {
        getRunState: { invoke: (...args: unknown[]) => getRunStateMock(...args) },
        runAccepted: emitter(),
        runStarted: emitter(),
        runUpdated: emitter(),
        runCompleted: emitter(),
        runCancelled: emitter(),
        runFailed: emitter(),
        childTurnStarted: emitter(),
        childTurnCompleted: emitter(),
        childTurnCancelled: emitter(),
        slotWorkChanged: emitter(),
        listChanged: emitter(),
        sessionChanged: emitter(),
        agentSpawned: emitter(),
        agentRemoved: emitter(),
        agentRenamed: emitter(),
        sessionStatusChanged: emitter(),
      },
      realtime: { reconnected: emitter() },
    },
  };
});

import { useTeamRunView } from '@/renderer/pages/team/hooks/useTeamRunView';

describe('useTeamRunView slow-turn reconcile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_030_000);
    const snapshot: ITeamRunStateResponse = {
      session_generation: 'generation-1',
      active_run: null,
      slot_work: [
        {
          slot_id: 'gemini-slot',
          role: 'teammate',
          state: 'running',
          queued_foreground_count: 0,
          queued_background_count: 0,
          active_turn_id: 'turn-gemini',
          active_turn_started_at_ms: Date.now() - 29_000,
          active_turn_elapsed_ms: 29_000,
          active_turn_slow: false,
          active_turn_slow_threshold_ms: 30_000,
          blocked_reason: null,
          team_run_id: 'run-gemini',
        },
      ],
    };
    getRunStateMock.mockReset();
    getRunStateMock.mockResolvedValue(snapshot);
  });

  afterEach(() => vi.useRealTimers());

  it('does one bounded authoritative reconcile when the active turn reaches its slow threshold', async () => {
    renderHook(() => useTeamRunView('team-gemini'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRunStateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRunStateMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(getRunStateMock).toHaveBeenCalledTimes(2);
  });
});
  `,
);

writeNew(
  "tests/unit/actestra/teamNativeWiring.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Actestra AionUI-native Team wiring', () => {
  it('keeps native Team HTTP and events reachable while Actestra uses its direct preload provider', () => {
    const http = read('packages/desktop/src/common/adapter/httpBridge.ts');
    const preload = read('packages/desktop/src/preload/main.ts');
    const client = read('packages/desktop/src/common/adapter/actestraTeamClient.ts');
    expect(http).not.toContain("ACTESTRA_TEAM_PATH = '/api/teams'");
    expect(http).not.toContain('requestActestraTeam');
    expect(http).not.toContain('teamEmitter');
    expect(client).toContain('window.actestraTeam!.request');
    expect(client).toContain('listActestraTeams');
    expect(client).toContain('getActestraTeam');
    expect(client).toContain('listActestraTeamModelOptions');
    expect(client).toContain('getActestraTeamModelSelection');
    expect(client).toContain('updateActestraTeamModelSelection');
    expect(client).toContain("'/model-selection'");
    expect(client).not.toContain('api_key');
    expect(client).not.toContain('base_url');
    expect(preload).toContain("contextBridge.exposeInMainWorld('actestraTeam'");
    expect(preload).toContain('ACTESTRA_TEAM_REQUEST_CHANNEL');
    expect(preload).toContain('ACTESTRA_TEAM_EVENT_CHANNEL');
    expect(preload).not.toContain('workspacePath: request');
    expect(preload).not.toContain('workerId: request');
  });

  it('keeps Team authority, recovery, IPC, and close ordering while runtime admission stays bound to each persisted Team selection', () => {
    const index = read('packages/desktop/src/index.ts');
    const main = read('packages/desktop/src/process/services/actestraShadowBridge.ts');
    const composition = read('packages/desktop/src/process/services/actestraTeamComposition.ts');
    expect(index).not.toContain('admitLocalClaudeProductRuntime');
    expect(index).toContain('startTrustedActestraNativeTeamPlanner');
    expect(index).toContain('resolveAionCoreMainModelBinding');
    expect(index).toContain('startTrustedActestraGeneralWorkRuntime');
    expect(index).toContain('startTrustedActestraCodingJourneyRuntime');
    expect(index).not.toContain('modelBinding: null');
    expect(index).toContain('configureActestraTeamRuntime({ planner });');
    expect(index).toContain('configureActestraTeamWorkerRuntimeAdmission({');
    expect(index).toContain('projectAionCoreTeamModelCatalog');
    expect(index.indexOf('await startTrustedActestraNativeTeamPlanner()')).toBeLessThan(
      index.indexOf("await initializeActestraPersistenceUtility(app.getPath('userData'))")
    );
    expect(index.indexOf('configureActestraTeamRuntime({ planner });')).toBeLessThan(
      index.indexOf("await initializeActestraPersistenceUtility(app.getPath('userData'))")
    );
    expect(index.indexOf('configureActestraTeamWorkerRuntimeAdmission({')).toBeLessThan(
      index.indexOf("await initializeActestraPersistenceUtility(app.getPath('userData'))")
    );
    expect(index).toContain('configureActestraTeamRuntime(null);');
    expect(index).toContain('ACTESTRA_AIONUI_TEAM_PLANNER_UNAVAILABLE');
    expect(index).toContain('ACTESTRA_AIONUI_TEAM_WORKER_RUNTIME_READY');
    expect(index).not.toContain('startActestraNativeTeamPlannerForTest');
    expect(main).toContain('new ActestraTeamComposition');
    expect(main).toContain('await teamComposition.recoverStandardAuthority()');
    expect(main).toContain('registerRecoveredTeamBridge');
    expect(composition).toContain('new TeamPlanAdmissionService');
    expect(composition).toContain('const admission =');
    expect(composition).toContain('this.#planner === null');
    expect(composition).toContain('new TeamOrchestratorService');
    expect(composition).toContain('new TeamJourneyWorkerRouter');
    expect(composition).toContain('readonly #teamRuntimes = new Map');
    expect(composition).toContain('pending.selectionKey === selectionKey');
    expect(composition).toContain('await this.#closeTeamRuntime(teamKey, existing)');
    expect(composition).toContain("'Actestra Team runtime replacement failed'");
    expect(composition).toContain('workerRuntimeAdmission:');
    expect(composition).toContain('ACTESTRA_AIONUI_TEAM_RECOVERY_READY');
    expect(composition).toContain("window.webContents.once('did-finish-load'");
    expect(composition).toContain('this.#recoverWorkerRuns()');
    expect(composition).toContain('orchestrator.recover(this.options.now(), team.teamId)');
    expect(main).toContain('createGeneralWorkJourney(trustedRuntime.general)');
    expect(main).toContain('modelCatalog: teamWorkerRuntimeAdmission?.modelCatalog ?? null');
    expect(main).toContain("? 'model-writing-artifact'");
    expect(main).not.toContain('sessionTimeoutMs: trustedRuntime.coding.sessionTimeoutMs');
    expect(composition).toContain('new TeamWorkspaceGrantContext({ persistence: this.options.persistence })');
    expect(composition).not.toContain('options.runtime!.workspaceContext');
    expect(composition).toContain('new AionUiStandardTeamCreationService');
    expect(composition).toContain('new LoopbackAionUiStandardTeamBackend');
    expect(composition).toContain('return this.#service.recoverStandardTeamMessageDeliveries()');
    expect(composition).toContain('new AionCoreProbeProcessGuard({ dataDirectory: getDataPath() })');
    expect(composition).toContain('standardTeamCreation:');
    expect(composition).toContain('registerAionUiTeamBridgeIpc');
    expect(composition.indexOf('this.#service.close()')).toBeLessThan(
      composition.indexOf('await this.#standardBackend.close()')
    );
    expect(composition.indexOf('await this.#standardBackend.close()')).toBeLessThan(
      composition.indexOf('await orchestrator.close()')
    );
    expect(composition.indexOf('this.#service.close()')).toBeLessThan(
      composition.indexOf('await orchestrator.close()')
    );
    expect(composition.indexOf('await orchestrator.close()')).toBeLessThan(
      composition.indexOf('this.#planner?.close()')
    );
  });

  it('keeps Workspace selection in the registered main window and projects no path', () => {
    const composition = read('packages/desktop/src/process/services/actestraTeamComposition.ts');
    const client = read('packages/desktop/src/common/adapter/actestraTeamClient.ts');
    const bridge = read('packages/desktop/src/actestra/compatibility/aionui/teamBridge.ts');
    expect(composition).toContain('workspaceSelection: { select: () => this.#selectWorkspace() }');
    expect(composition).toContain('const window = this.#window;');
    expect(composition).toContain('window === null || window.isDestroyed()');
    expect(composition).toContain('dialog.showOpenDialog(window');
    expect(composition).toContain("properties: ['openDirectory', 'createDirectory']");
    expect(composition).toContain('const rootPath = await realpath(selectedPath);');
    expect(composition).toContain('rootPath === path.parse(rootPath).root');
    expect(client).toContain("'/api/teams/workspace-options/select'");
    expect(client).not.toContain('selectActestraTeamWorkspace(rootPath');
    expect(bridge).toContain('assertNoBody(request.body);');
    expect(bridge).toContain('kind: "select-workspace"');
  });

  it('keeps both Team creation directions reachable without replacing the native flow', () => {
    const page = read('packages/desktop/src/renderer/pages/team/TeamPage.tsx');
    const teamIndex = read('packages/desktop/src/renderer/pages/team/index.tsx');
    const create = read('packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx');
    const chooser = read('packages/desktop/src/renderer/pages/team/components/TeamCreateExperienceChooser.tsx');
    const sider = read('packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx');
    const teamList = read('packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts');
    const teamSession = read('packages/desktop/src/renderer/pages/team/hooks/useTeamSession.ts');
    const addMember = read('packages/desktop/src/renderer/pages/team/components/memberPicker/TeamAddMemberPopover.tsx');
    const client = read('packages/desktop/src/common/adapter/actestraTeamClient.ts');
    const mapper = read('packages/desktop/src/common/adapter/teamMapper.ts');
    const rendererHtml = read('packages/desktop/src/renderer/index.html');
    const actestraCreate = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx');
    const workspace = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx');
    expect(chooser).toContain("data-testid='team-create-kind-standard'");
    expect(chooser).toContain("data-testid='team-create-kind-orchestrated'");
    expect(chooser).toContain("role='menuitem'");
    expect(sider).toContain('<TeamCreateExperienceChooser');
    expect(sider).toContain('<TeamCreateModal');
    expect(sider).toContain('<ActestraTeamCreateModal');
    expect(sider).toContain("data-testid='actestra-team-provider-unavailable'");
    expect(teamList).toContain('teamProviderUnavailable');
    expect(teamList).not.toContain('return standard;');
    expect(create).toContain('TeamAssistantPicker');
    expect(create).toContain('WorkspaceFolderSelect');
    expect(create).toContain('createStandardTeam');
    expect(create).not.toContain('resolveDefaultTeamAgentModel');
    expect(addMember).not.toContain('resolveDefaultTeamAgentModel');
    expect(teamSession).toContain('addStandardTeamMember');
    expect(client).toContain('export async function renameStandardTeamMember');
    expect(client).toContain('export async function removeStandardTeamMember');
    expect(teamSession).toContain('providerActive ? renameStandardTeamMember(team.id, slot_id, new_name)');
    expect(teamSession).toContain('providerActive ? removeStandardTeamMember(params.team_id, params.slot_id)');
    expect(client).toContain('export async function renameStandardTeam');
    expect(client).toContain('export async function removeStandardTeam');
    expect(teamList).toContain('providerActive ? removeStandardTeam(params.id) : ipcBridge.team.remove.invoke(params)');
    expect(sider).toContain('else if (isActestraTeamProviderActive()) {');
    expect(sider).toContain('The Team state changed. Refresh the Team list and try again.');
    expect(sider).toContain('await renameStandardTeam');
    expect(page).toContain('await standardTeamRename');
    expect(page).not.toContain('isActestraTeamProviderActive()');
    expect(teamIndex).toContain('standardTeamRename={isActestraTeamProviderActive() ? renameStandardTeam : undefined}');
    expect(client).toContain('requested_model: agent.model?.trim() || null');
    expect(create).toContain('unmountOnExit={true}');
    expect(create).not.toContain('unmountOnExit={false}');
    expect(create).not.toContain('ActestraTeamCreateModal');
    expect(rendererHtml).toContain("img-src 'self' data: blob: http://127.0.0.1:*");
    expect(mapper).toContain("rawExperience === undefined || rawExperience === 'standard'");
    expect(mapper).toContain("experience_error: 'team.experience.invalidProjection'");
    expect(page).toContain("resolveTeamExperience(team) === 'orchestrated'");
    expect(page).toContain('<ActestraTeamWorkspace team={team} />');
    expect(page).toContain('<NativeTeamPage team={team} standardTeamRename={standardTeamRename} />');
    expect(page).toContain("data-testid='team-experience-unavailable'");
    expect(page).toContain("t(team.experience_error ?? 'team.experience.unavailableDescription')");
    expect(page).toContain('TeamTabsProvider');
    expect(page).toContain('TeamChatView');
    expect(page).toContain('TeamWarmupOverlay');
    expect(actestraCreate).toContain('listActestraTeamWorkspaceOptions');
    expect(actestraCreate).toContain('selectActestraTeamWorkspace');
    expect(actestraCreate).toContain("data-testid='actestra-team-workspace-grant'");
    expect(actestraCreate).toContain('createActestraTeam');
    expect(actestraCreate).toContain('unmountOnExit={true}');
    expect(actestraCreate).not.toContain('unmountOnExit={false}');
    expect(actestraCreate).not.toContain("data-testid='actestra-team-workspace-input'");
    expect(actestraCreate).toContain("data-testid='actestra-team-description-input'");
    expect(actestraCreate).toContain("data-testid='actestra-team-member-row'");
    expect(actestraCreate).toContain(
      "member.capability === 'general' ? 'actestra-general-worker' : 'actestra-goose-worker'"
    );
    expect(actestraCreate).toContain("workspace_mode: 'isolated'");
    for (const marker of [
      "data-testid='actestra-team-workspace'",
      "data-testid='actestra-team-current-executor'",
      "data-testid='actestra-team-blocked-reason'",
      "data-testid='actestra-team-result'",
      "data-testid='actestra-team-run-submit'",
    ])
      expect(workspace).toContain(marker);
    for (const control of ['pause', 'resume', 'cancel', 'retry', 'replace', 'handoff', 'approve', 'deny']) {
      expect(workspace).toContain(control);
    }
    expect(workspace).not.toContain('auditRecordId');
    expect(workspace).not.toContain('workerId');
    expect(workspace).not.toContain('repositoryRoot');
  });

  it('routes every retained native Team creation journey through an explicit standard-Team choice', () => {
    for (const relativePath of [
      'tests/e2e/cases/teams/team-name-validation.e2e.ts',
      'tests/e2e/cases/teams/team-workspace-migration.e2e.ts',
      'tests/e2e/features/workspaces/workspace-files.e2e.ts',
      'tests/e2e/features/workspaces/workspace-snapshot.e2e.ts',
      'tests/e2e/specs/team-create-preset-leader.e2e.ts',
    ]) {
      const journey = read(relativePath);
      expect(journey, relativePath).toContain('chooseTeamExperience');
      expect(journey, relativePath).toContain("chooseTeamExperience(page, 'standard')");
    }
    const helper = read('tests/e2e/helpers/teamHelpers.ts');
    expect(helper).toContain('team-create-name-input');
    expect(helper).toContain('team-create-add-member-btn');
    expect(helper).toContain('team-create-agent-option-');
    const providerJourney = read('tests/e2e/cases/teams/team-experience-choice.e2e.ts');
    expect(providerJourney).toContain('keeps the Main/Core standard provider readable');
    expect(providerJourney).toContain("createTeam(page, teamName, 'claude')");
    expect(providerJourney).toContain('/api/teams?user_id=actestra-local-user');
    expect(providerJourney).toContain('team-provider-unavailable');
    expect(providerJourney).toContain('team-tab-bar');
  });

  it('launches real Team journeys in an isolated Actestra profile', () => {
    const fixtures = read('tests/e2e/fixtures.ts');
    const chromiumConfig = read('packages/desktop/src/process/utils/configureChromium.ts');
    expect(fixtures).toContain("const e2eIsolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-e2e-'))");
    expect(fixtures).toContain('AIONUI_E2E_USER_DATA_DIR: e2eUserDataDir');
    expect(fixtures).toContain("ACTESTRA_E2E_TEST: '1'");
    expect(fixtures).toContain('ACTESTRA_USER_DATA_DIR: e2eUserDataDir');
    expect(fixtures).toContain('ACTESTRA_E2E_ISOLATION_ROOT: e2eIsolationRoot');
    expect(fixtures).toContain('ACTESTRA_E2E_HOME_DIR: e2eHomeDir');
    expect(fixtures).toContain('ACTESTRA_E2E_TEMP_DIR: e2eTmpDir');
    expect(fixtures).toContain('HOME: e2eHomeDir');
    expect(fixtures).toContain('USERPROFILE: e2eHomeDir');
    expect(fixtures).toContain('TMPDIR: e2eTmpDir');
    expect(fixtures).toContain('TEMP: e2eTmpDir');
    expect(fixtures).toContain('TMP: e2eTmpDir');
    expect(fixtures).toContain('DATA_DIR: e2eUserDataDir');
    expect(fixtures).toContain("LOGS_DIR: path.join(e2eUserDataDir, 'logs')");
    expect(fixtures).toContain('async function verifyE2EIsolation(');
    expect(fixtures).toContain("electronMainApp.getPath('userData')");
    expect(fixtures).toContain("electronMainApp.getPath('home')");
    expect(fixtures).toContain("electronMainApp.getPath('temp')");
    expect(fixtures.split('await verifyE2EIsolation(electronApp)').length - 1).toBe(2);
    expect(fixtures).toContain('fs.rmSync(e2eIsolationRoot, { recursive: true, force: true })');
    expect(fixtures).not.toContain('const e2eUserDataDir = fs.mkdtempSync');
    expect(fixtures).toContain('type E2EWorkerFixtures = {');
    expect(fixtures).toContain('e2eCleanup: void;');
    expect(fixtures).toContain('base.extend<Fixtures, E2EWorkerFixtures>');
    expect(fixtures).toContain('e2eCleanup: [');
    expect(fixtures).toContain("{ scope: 'worker', auto: true }");
    expect(fixtures).toContain('await closeE2EResources();');
    expect(chromiumConfig).toContain('process.env.ACTESTRA_E2E_ISOLATION_ROOT');
    expect(chromiumConfig).toContain('process.env.ACTESTRA_E2E_HOME_DIR');
    expect(chromiumConfig).toContain('process.env.ACTESTRA_E2E_TEMP_DIR');
    expect(chromiumConfig).toContain("app.setPath('home', actestraE2EHomeDir)");
    expect(chromiumConfig).toContain("app.setPath('temp', actestraE2ETempDir)");
    expect(chromiumConfig.indexOf("app.setPath('home', actestraE2EHomeDir)")).toBeLessThan(
      chromiumConfig.indexOf("app.getPath('appData')")
    );
  });

  it('accepts Gemini Team recovery and new members by the Main-projected slot identity', () => {
    const journey = read('tests/e2e/cases/teams/team-member-messaging.e2e.ts');
    expect(journey).toContain("page.route('**/api/teams/*/session'");
    expect(journey).toContain("data-testid='team-warmup-retry'");
    expect(journey).toContain("invokeBridge<TeamProjection>(page, 'team.get'");
    expect(journey).toContain('team-tab-\${addedMember.slot_id}');
    expect(journey).toContain('cleanupTeamsByName');
    expect(journey).not.toContain('E2E-msg-member-');
  });

  it('ships English and Chinese Team experience copy without inline fallback UI text', () => {
    const english = JSON.parse(read('packages/desktop/src/renderer/services/i18n/locales/en-US/team.json'));
    const chinese = JSON.parse(read('packages/desktop/src/renderer/services/i18n/locales/zh-CN/team.json'));
    const create = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx');
    const workspace = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx');
    expect(english.experience).toMatchObject({
      standardTitle: 'Standard Team',
      orchestratedTitle: 'Actestra Collaborative Team',
      unavailableTitle: 'Team experience unavailable',
      invalidProjection: 'This Team has an invalid authority projection.',
    });
    expect(chinese.experience).toMatchObject({
      standardTitle: '标准 Team',
      orchestratedTitle: 'Actestra 协作 Team',
      unavailableTitle: '此 Team 体验不可用',
      invalidProjection: '该 Team 的权威投影无效。',
    });
    expect(english.experience.standardDescription).toContain('Claude Code');
    expect(english.experience.standardDescription).toContain('Codex CLI');
    expect(english.experience.standardDescription).toContain('Gemini CLI');
    expect(chinese.experience.standardDescription).toContain('Claude Code');
    expect(chinese.experience.standardDescription).toContain('Codex CLI');
    expect(chinese.experience.standardDescription).toContain('Gemini CLI');
    expect(english.actestra).toMatchObject({
      createTitle: 'Create Actestra Collaborative Team',
      workspaceLabel: 'Workspace',
      planTitle: 'Plan and Worker state',
    });
    expect(chinese.actestra).toMatchObject({
      createTitle: '创建 Actestra 协作 Team',
      workspaceLabel: '工作空间',
      planTitle: '计划与 Worker 状态',
    });
    for (const source of [create, workspace]) {
      expect(source).not.toContain('defaultValue:');
    }
    expect(create).not.toContain("placeholder='Launch workspace'");
    expect(create).not.toContain('>General Worker<');
    expect(create).not.toContain('>Goose coding Worker<');
    expect(workspace).not.toContain('>Plan and Worker state<');
    expect(workspace).not.toContain('>Authority source<');
  });
});
`,
);

writeNew(
  "tests/unit/renderer/team/TeamCreateExperienceChooser.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSiderSection from '@/renderer/components/layout/Sider/TeamSiderSection';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refreshTeams: vi.fn(),
  removeTeam: vi.fn(),
  globalMutate: vi.fn(),
  state: { teamProviderUnavailable: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: mocks.globalMutate }),
}));
vi.mock('@renderer/pages/team/hooks/useTeamList', () => ({
  useTeamList: () => ({
    teams: [],
    mutate: mocks.refreshTeams,
    removeTeam: mocks.removeTeam,
    teamProviderUnavailable: mocks.state.teamProviderUnavailable,
  }),
}));
vi.mock('@renderer/pages/team/hooks/useSiderTeamBadges', () => ({
  useSiderTeamBadges: () => new Map(),
}));
vi.mock('@/renderer/components/layout/Sider/useSiderTeamRunning', () => ({
  useSiderTeamRunning: () => () => false,
}));
vi.mock('@renderer/pages/team/components/TeamCreateExperienceChooser', () => ({
  default: ({ visible, onVisibleChange, onChoose, anchor }: {
    visible: boolean;
    onVisibleChange: (visible: boolean) => void;
    onChoose: (experience: 'standard' | 'orchestrated') => void;
    anchor: React.ReactElement;
  }) => (
    <>
      {anchor}
      {visible && (
        <div data-testid='team-create-experience-chooser'>
          <button data-testid='team-create-kind-standard' onClick={() => onChoose('standard')}>standard</button>
          <button data-testid='team-create-kind-orchestrated' onClick={() => onChoose('orchestrated')}>orchestrated</button>
          <button data-testid='team-create-chooser-close' onClick={() => onVisibleChange(false)}>close</button>
        </div>
      )}
    </>
  ),
}));
vi.mock('@renderer/pages/team/components/TeamCreateModal', () => ({
  default: ({ visible }: { visible: boolean }) => visible ? <div data-testid='standard-team-create-modal' /> : null,
}));
vi.mock('@renderer/pages/team/components/ActestraTeamCreateModal', () => ({
  default: ({ visible }: { visible: boolean }) => visible ? <div data-testid='orchestrated-team-create-modal' /> : null,
}));
vi.mock('@arco-design/web-react', () => {
  const Modal = Object.assign(({ children }: { children?: React.ReactNode }) => <>{children}</>, { confirm: vi.fn() });
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Message: { success: vi.fn(), error: vi.fn() },
    Modal,
    Spin: () => <span />,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@icon-park/react', () => ({
  DeleteOne: () => <span />,
  EditOne: () => <span />,
  Peoples: () => <span />,
  Plus: () => <span />,
  Pushpin: () => <span />,
  Right: () => <span />,
}));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({ cleanupSiderTooltips: vi.fn() }));
vi.mock('@renderer/utils/ui/focus', () => ({ blurActiveElement: vi.fn() }));
vi.mock('@/renderer/components/layout/Sider/SiderItem', () => ({ default: () => null }));

function renderSider() {
  return render(
    <TeamSiderSection
      collapsed={false}
      pathname='/'
      siderTooltipProps={{}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.state.teamProviderUnavailable = false;
});

describe('Team create experience chooser', () => {
  it('opens from the Team plus and routes standard to the preserved native modal', () => {
    renderSider();
    fireEvent.click(screen.getByTestId('team-create-btn'));
    expect(screen.getByTestId('team-create-experience-chooser')).toBeTruthy();
    fireEvent.click(screen.getByTestId('team-create-kind-standard'));
    expect(screen.getByTestId('standard-team-create-modal')).toBeTruthy();
    expect(screen.queryByTestId('orchestrated-team-create-modal')).toBeNull();
  });

  it('routes the explicit orchestrated choice to the Actestra modal', () => {
    renderSider();
    fireEvent.click(screen.getByTestId('team-create-btn'));
    fireEvent.click(screen.getByTestId('team-create-kind-orchestrated'));
    expect(screen.getByTestId('orchestrated-team-create-modal')).toBeTruthy();
    expect(screen.queryByTestId('standard-team-create-modal')).toBeNull();
  });

  it('returns focus to the Team plus when the chooser closes', async () => {
    renderSider();
    const trigger = screen.getByTestId('team-create-btn');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('team-create-chooser-close'));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps standard Team entry visible while explaining an unavailable Actestra provider', () => {
    mocks.state.teamProviderUnavailable = true;
    renderSider();
    expect(screen.getByTestId('actestra-team-provider-unavailable')).toHaveTextContent(
      'team.experience.providerUnavailable',
    );
  });
});
  `,
);

const teamExperienceChooserDomTestPath =
  "tests/unit/renderer/team/TeamCreateExperienceChooser.dom.test.tsx";
replaceOnce(
  teamExperienceChooserDomTestPath,
  `vi.mock('@renderer/pages/team/components/TeamCreateModal', () => ({
  default: ({ visible }: { visible: boolean }) => visible ? <div data-testid='standard-team-create-modal' /> : null,
}));`,
  `vi.mock('@renderer/pages/team/components/TeamCreateModal', () => ({
  default: ({ visible, onCreated }: { visible: boolean; onCreated: (team: unknown) => void }) => visible ? (
    <div data-testid='standard-team-create-modal'>
      <button
        data-testid='standard-team-create-complete'
        onClick={() => onCreated({ id: 'standard-team', name: 'Standard Team', experience: 'standard' })}
      >
        complete
      </button>
    </div>
  ) : null,
}));`,
);
replaceOnce(
  teamExperienceChooserDomTestPath,
  `  it('keeps standard Team entry visible while explaining an unavailable Actestra provider', () => {`,
  `  it('projects the Main-returned Team into the sidebar cache before navigation', () => {
    renderSider();
    fireEvent.click(screen.getByTestId('team-create-btn'));
    fireEvent.click(screen.getByTestId('team-create-kind-standard'));
    fireEvent.click(screen.getByTestId('standard-team-create-complete'));

    expect(mocks.refreshTeams).toHaveBeenCalledTimes(1);
    const [updateCache, options] = mocks.refreshTeams.mock.calls[0] as [
      (current?: Array<{ id: string }>) => Array<{ id: string }>,
      { revalidate: boolean },
    ];
    expect(updateCache([])).toEqual([
      expect.objectContaining({ id: 'standard-team', experience: 'standard' }),
    ]);
    expect(options).toEqual({ revalidate: true });
    expect(mocks.refreshTeams.mock.invocationCallOrder[0]).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]);
  });

  it('keeps standard Team entry visible while explaining an unavailable Actestra provider', () => {`,
);

writeNew(
  "tests/unit/renderer/team/ActestraTeamCreateModal.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActestraTeamCreateModal from '@/renderer/pages/team/components/ActestraTeamCreateModal';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  selectWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn(),
  onCreated: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  createActestraTeam: mocks.create,
  listActestraTeamModelOptions: vi.fn(),
  listActestraTeamWorkspaceOptions: vi.fn(),
  selectActestraTeamWorkspace: mocks.selectWorkspace,
}));
vi.mock('swr', () => ({
  default: () => ({
    data: {
      workspace_options: [{ workspace_id: 'workspace-approved', display_name: 'Approved workspace' }],
      providers: [{ provider_id: 'provider-explicit', name: 'Explicit provider', model_ids: ['model-explicit'] }],
    },
    error: undefined,
    isLoading: false,
    mutate: mocks.refreshWorkspaces,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'team.actestra.generalDefaultName': 'General',
      'team.actestra.gooseDefaultName': 'Goose',
      'team.actestra.createFailed': 'Actestra could not create this Team.',
      'team.actestra.createFailedNextStep': 'Keep these settings, review the workspace grant, and retry.',
    } as Record<string, string>)[key] ?? key,
  }),
}));
vi.mock('@renderer/components/base/AionModal', () => ({
  default: ({ visible, children, footer }: {
    visible: boolean;
    children: React.ReactNode;
    footer?: { render: () => React.ReactNode };
  }) => visible ? <div data-testid='aion-modal'>{children}{footer?.render()}</div> : null,
}));
vi.mock('@arco-design/web-react', () => {
  const Input = Object.assign(
    ({ onChange, ...props }: { onChange?: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) => (
      <input {...props} onChange={(event) => onChange?.(event.target.value)} />
    ),
    {
      TextArea: ({ onChange, ...props }: { onChange?: (value: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'>) => (
        <textarea {...props} onChange={(event) => onChange?.(event.target.value)} />
      ),
    },
  );
  const Select = Object.assign(
    ({ onChange, children, ...props }: { onChange?: (value: string) => void; children: React.ReactNode } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'>) => (
      <select {...props} onChange={(event) => onChange?.(event.target.value)}>{children}</select>
    ),
    { Option: ({ children, ...props }: React.OptionHTMLAttributes<HTMLOptionElement>) => <option {...props}>{children}</option> },
  );
  const Radio = Object.assign(
    ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    { Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
  );
  return {
    Button: ({ children, onClick, disabled, loading: _loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => <button {...props} disabled={disabled} onClick={onClick}>{children}</button>,
    Input,
    Message: { warning: vi.fn(), error: vi.fn() },
    Radio,
    Select,
  };
});

function renderModal() {
  return render(
    <ActestraTeamCreateModal
      visible
      onClose={mocks.onClose}
      onCreated={mocks.onCreated}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 'team-created' });
  mocks.selectWorkspace.mockResolvedValue({
    workspace_id: 'workspace-selected',
    display_name: 'Selected workspace',
  });
  mocks.refreshWorkspaces.mockResolvedValue(undefined);
});

describe('Actestra Team create modal', () => {
  it('keeps General and Goose while supporting two to five explicit members', () => {
    renderModal();
    expect(screen.getAllByTestId('actestra-team-member-row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('actestra-team-member-add'));
    expect(screen.getAllByTestId('actestra-team-member-row')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('actestra-team-member-add'));
    fireEvent.click(screen.getByTestId('actestra-team-member-add'));
    expect(screen.getAllByTestId('actestra-team-member-row')).toHaveLength(5);
    expect(screen.getByTestId('actestra-team-member-add')).toBeDisabled();
    fireEvent.click(screen.getAllByTestId('actestra-team-member-remove')[0]!);
    expect(screen.getAllByTestId('actestra-team-member-row')).toHaveLength(4);
  });

  it('requests Main-owned workspace selection without renderer path input', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('actestra-team-workspace-grant'));
    await waitFor(() => expect(mocks.selectWorkspace).toHaveBeenCalledOnce());
    expect(mocks.selectWorkspace).toHaveBeenCalledWith();
    expect(mocks.refreshWorkspaces).toHaveBeenCalledOnce();
  });

  it('keeps Provider and model Select triggers outside native label activation', () => {
    renderModal();
    const provider = screen.getByTestId('actestra-team-provider-select');
    const model = screen.getByTestId('actestra-team-model-select');
    expect(provider.closest('label')).toBeNull();
    expect(model.closest('label')).toBeNull();
    expect(provider).toHaveAttribute('aria-labelledby', 'actestra-team-provider-label');
    expect(model).toHaveAttribute('aria-labelledby', 'actestra-team-model-label');
  });

  it('submits description, approved workspace reference, finite model IDs, and member intent', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('actestra-team-name-input'), { target: { value: 'Release Team' } });
    fireEvent.change(screen.getByTestId('actestra-team-description-input'), { target: { value: 'Prepare a bounded release.' } });
    fireEvent.change(screen.getByTestId('actestra-team-workspace-select'), { target: { value: 'workspace-approved' } });
    fireEvent.change(screen.getByTestId('actestra-team-provider-select'), { target: { value: 'provider-explicit' } });
    fireEvent.change(screen.getByTestId('actestra-team-model-select'), { target: { value: 'model-explicit' } });
    fireEvent.click(screen.getByTestId('actestra-team-member-add'));
    fireEvent.change(screen.getAllByTestId('actestra-team-member-name')[2]!, { target: { value: 'Research' } });
    fireEvent.click(screen.getByTestId('actestra-team-create-submit'));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const input = mocks.create.mock.calls[0]![0];
    expect(input).toMatchObject({
      name: 'Release Team',
      description: 'Prepare a bounded release.',
      workspace: 'workspace-approved',
      workspace_mode: 'isolated',
      modelSelection: { providerId: 'provider-explicit', modelId: 'model-explicit' },
    });
    expect(input.agents).toHaveLength(3);
    expect(input.agents.map((agent: { assistant_id: string }) => agent.assistant_id)).toEqual([
      'actestra-general-worker',
      'actestra-goose-worker',
      'actestra-general-worker',
    ]);
    expect(JSON.stringify(input)).not.toContain('team-member-');
  });

  it('keeps the form and hides raw bridge detail when authoritative creation fails', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Backend POST /api/teams/private-team failed'));
    renderModal();
    fireEvent.change(screen.getByTestId('actestra-team-name-input'), { target: { value: 'Release Team' } });
    fireEvent.change(screen.getByTestId('actestra-team-description-input'), { target: { value: 'Prepare a bounded release.' } });
    fireEvent.change(screen.getByTestId('actestra-team-workspace-select'), { target: { value: 'workspace-approved' } });
    fireEvent.change(screen.getByTestId('actestra-team-provider-select'), { target: { value: 'provider-explicit' } });
    fireEvent.change(screen.getByTestId('actestra-team-model-select'), { target: { value: 'model-explicit' } });
    fireEvent.click(screen.getByTestId('actestra-team-create-submit'));

    const failure = await screen.findByTestId('actestra-team-create-error');
    expect(failure).toHaveTextContent('Actestra could not create this Team.');
    expect(failure).toHaveTextContent('Keep these settings, review the workspace grant, and retry.');
    expect(document.body.textContent).not.toContain('Backend POST /api/teams/private-team');
    expect(screen.getByTestId('actestra-team-name-input')).toHaveValue('Release Team');
    expect(mocks.onCreated).not.toHaveBeenCalled();
  });
});
  `,
);

// Bound to the migration constant rather than a third literal: every schema addition otherwise has to
// remember to bump this downstream expectation, and the test is about the utility IPC carrying the
// authoritative version, not about which number that happens to be.
replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `import { PersistenceUtilityService } from '@/actestra/utility/persistence/persistenceUtilityService';`,
  `import { PersistenceUtilityService } from '@/actestra/utility/persistence/persistenceUtilityService';
import { CURRENT_CORE_SCHEMA_VERSION } from '@/actestra/utility/persistence/sqliteMigrations';`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `    expect(client.schemaVersion).toBe(14);`,
  `    expect(client.schemaVersion).toBe(CURRENT_CORE_SCHEMA_VERSION);`,
);

writeNew(
  "tests/unit/renderer/team/TeamExperienceRouting.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import type { TTeam } from '@/common/types/team/teamTypes';
import TeamIndex from '@/renderer/pages/team';

const mocks = vi.hoisted(() => ({
  providerActive: true,
  getNative: vi.fn(),
  getProjected: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: { team: { get: { invoke: mocks.getNative } } },
}));
vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => mocks.providerActive,
  getActestraTeam: mocks.getProjected,
  renameStandardTeam: vi.fn(),
  isActestraTeamUnavailableError: (error: unknown) =>
    error instanceof Error && error.message.includes('Actestra provider unavailable'),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/renderer/pages/team/TeamPage', () => ({
  default: ({ team }: { team: TTeam }) => (
    <div data-testid='resolved-team' data-experience={team.experience}>{team.name}</div>
  ),
}));

const standard = {
  id: 'team-standard',
  experience: 'standard',
  user_id: 'user',
  name: 'Native Team',
  workspace: '/native',
  workspace_mode: 'shared',
  leader_assistant_id: 'assistant-native',
  assistants: [],
  created_at: 1,
  updated_at: 1,
} satisfies TTeam;

const orchestrated = {
  ...standard,
  id: 'team-orchestrated',
  experience: 'orchestrated',
  name: 'Actestra Team',
  workspace: 'workspace-approved',
  workspace_mode: 'isolated',
} satisfies TTeam;

function renderTeam(teamId: string) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[\`/team/\${teamId}\`]}>
        <Routes><Route path='/team/:id' element={<TeamIndex />} /></Routes>
      </MemoryRouter>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerActive = true;
});

describe('per-Team experience routing', () => {
  it('opens a standard Team from the single Main/Core projection while the provider is active', async () => {
    mocks.getProjected.mockResolvedValue(standard);
    renderTeam(standard.id);
    expect(await screen.findByTestId('resolved-team')).toHaveAttribute('data-experience', 'standard');
    expect(mocks.getProjected).toHaveBeenCalledWith(standard.id);
    expect(mocks.getNative).not.toHaveBeenCalled();
  });

  it('opens an orchestrated Team from its Main/Core projection', async () => {
    mocks.getProjected.mockResolvedValue(orchestrated);
    renderTeam(orchestrated.id);
    expect(await screen.findByTestId('resolved-team')).toHaveAttribute('data-experience', 'orchestrated');
    expect(mocks.getProjected).toHaveBeenCalledWith(orchestrated.id);
    expect(mocks.getNative).not.toHaveBeenCalled();
  });

  it('uses the preserved native provider only when the Actestra provider is absent', async () => {
    mocks.providerActive = false;
    mocks.getNative.mockResolvedValue(standard);
    renderTeam(standard.id);
    expect(await screen.findByTestId('resolved-team')).toHaveAttribute('data-experience', 'standard');
    expect(mocks.getNative).toHaveBeenCalledWith({ id: standard.id });
    expect(mocks.getProjected).not.toHaveBeenCalled();
  });

  it('fails closed when the Main/Core projection fails', async () => {
    mocks.getProjected.mockRejectedValue(new Error('Main/Core Team projection failed'));
    renderTeam(orchestrated.id);
    await waitFor(() => expect(screen.getByTestId('team-provider-unavailable')).toHaveTextContent(
      'team.experience.loadFailed',
    ));
    expect(screen.queryByTestId('resolved-team')).toBeNull();
  });

  it('explains an Actestra provider failure instead of rendering an empty page', async () => {
    mocks.getProjected.mockRejectedValue(new Error('Actestra provider unavailable'));
    renderTeam(orchestrated.id);
    await waitFor(() => expect(screen.getByTestId('team-provider-unavailable')).toHaveTextContent(
      'team.experience.providerUnavailable',
    ));
    expect(screen.queryByTestId('resolved-team')).toBeNull();
  });
});
  `,
);

writeNew(
  "tests/unit/renderer/team/ActestraTeamWorkspace.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AionUiTeamEvent, NativeAionUiTeamRunState } from '@/actestra/compatibility/aionui/teamBridge';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import ActestraTeamWorkspace from '@/renderer/pages/team/components/ActestraTeamWorkspace';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  submit: vi.fn(),
  control: vi.fn(),
  approval: vi.fn(),
  completeHandoff: vi.fn(),
  feedback: vi.fn(),
  cancel: vi.fn(),
  rename: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  viewArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  applyArtifact: vi.fn(),
}));

let teamEventHandler: ((event: AionUiTeamEvent) => void) | null = null;

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  getActestraTeamRunState: mocks.getState,
  submitActestraTeamTask: mocks.submit,
  controlActestraTeamNode: mocks.control,
  decideActestraTeamApproval: mocks.approval,
  completeActestraTeamHandoff: mocks.completeHandoff,
  resolveActestraTeamFeedback: mocks.feedback,
  cancelActestraTeamRun: mocks.cancel,
  renameActestraTeam: mocks.rename,
  subscribeActestraTeamEvents: mocks.subscribe,
}));

// The Artifact card drives apply through the coding journey bridge, which is the same Main-owned
// path the non-Team surface uses. The Team surface adds no second authority, so the Team test only
// has to prove the card is reachable and bound to the projected conversation.
vi.mock('@/common/adapter/actestraCodingJourneyClient', () => ({
  viewActestraCodingJourneyArtifact: mocks.viewArtifact,
  downloadActestraCodingJourneyArtifact: mocks.downloadArtifact,
  applyActestraCodingJourneyArtifact: mocks.applyArtifact,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'team.actestra.recoveredRevision') return 'Actestra Core · recovered revision ' + String(options?.revision);
      if (key === 'team.actestra.dependsOn') return 'Depends on ' + String(options?.count) + ' earlier node(s)';
      if (key === 'team.actestra.artifactLabel') return 'Artifact · ' + String(options?.label);
      if (key === 'team.actestra.action.approve') return 'Approve';
      if (key === 'team.actestra.handoffComplete') return 'Complete handoff';
      if (key === 'team.actestra.blocked.protectedApproval') return 'Approval is required before Goose can continue.';
      if (key === 'team.actestra.runStatus.running') return 'Running';
      if (key === 'team.actestra.runStatus.blocked') return 'Blocked';
      if (key === 'team.actestra.assistantStatus.active') return 'Active';
      if (key === 'team.actestra.nodeState.blocked') return 'Blocked';
      if (key === 'team.actestra.capability.coding') return 'Coding';
      if (key === 'team.actestra.plannerUnavailable') return 'The supervised Team planner is unavailable.';
      if (key === 'team.actestra.plannerUnavailableNextStep') return 'Check the admitted planner and retry this task.';
      if (key === 'team.actestra.workerRuntimeUnavailable') return 'The required General and Goose Worker runtime is unavailable.';
      if (key === 'team.actestra.workerRuntimeUnavailableNextStep') return 'Configure both Worker runtimes in Actestra, then refresh this Team.';
      if (key === 'team.actestra.plannerInvalid') return 'The supervised Team planner returned an invalid plan.';
      if (key === 'team.actestra.plannerInvalidNextStep') return 'Review the Team goal and planner configuration, then retry without changing the Team identity.';
      if (key === 'team.actestra.plannerTimeout') return 'The supervised Team planner timed out.';
      if (key === 'team.actestra.plannerTimeoutNextStep') return 'Confirm the planner is responsive, then retry this task.';
      if (key === 'team.actestra.invalidRequest') return 'This Team task body has an invalid format.';
      if (key === 'team.actestra.invalidRequestNextStep') return 'Remove control characters and leading or trailing blank lines, then submit the task again.';
      if (key === 'team.actestra.controlFailed') return 'The Team control failed.';
      if (key === 'team.actestra.controlFailedNextStep') return 'Refresh the Team state, then retry only an action shown as valid.';
      if (key === 'team.actestra.cancelFailed') return 'The Team could not be cancelled.';
      if (key === 'team.actestra.cancelFailedNextStep') return 'Refresh the Team state and confirm whether cancellation completed before retrying.';
      if (key === 'team.actestra.renameFailed') return 'The Team name could not be saved.';
      if (key === 'team.actestra.renameFailedNextStep') return 'Refresh the Team state, then try the rename again.';
      return key;
    },
  }),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  __esModule: true,
  default: ({ children, headerExtra, onRenameTitle, tabsSlot, title }: {
    children: React.ReactNode;
    headerExtra?: React.ReactNode;
    onRenameTitle?: (name: string) => Promise<boolean>;
    tabsSlot?: React.ReactNode;
    title?: React.ReactNode;
  }) => (
    <section data-testid='native-team-chat-layout'>
      <div data-testid='native-team-title'>{title}</div>
      <button
        data-testid='native-team-rename'
        onClick={() => void onRenameTitle?.('Renamed collaborative Team')}
      >
        rename
      </button>
      <div data-testid='native-team-tabs-slot'>{tabsSlot}</div>
      <div data-testid='native-team-header-extra'>{headerExtra}</div>
      {children}
    </section>
  ),
}));

vi.mock('@/renderer/pages/team/components/TeamTabs', () => ({
  __esModule: true,
  default: ({ reorderEnabled }: { reorderEnabled?: boolean }) => (
    <div data-testid='team-tab-bar' data-reorder-enabled={String(reorderEnabled ?? true)} />
  ),
}));

vi.mock('@/renderer/pages/team/components/TeamViewToggle', () => ({
  __esModule: true,
  default: () => <div data-testid='team-view-toggle' />,
}));

vi.mock('@/renderer/pages/team/hooks/TeamTabsContext', () => ({
  TeamTabsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTeamTabs: () => ({ activeSlotId: 'team-member-' + '2'.repeat(64) }),
}));

vi.mock('@/renderer/pages/team/hooks/useTeamViewMode', () => ({
  useTeamViewMode: () => ['parallel', vi.fn()],
}));

const team = {
  id: 'team-' + '1'.repeat(64),
  user_id: 'actestra-local-user',
  name: 'Launch Team',
  workspace: 'workspace-project',
  workspace_mode: 'isolated',
  leader_assistant_id: 'team-member-' + '2'.repeat(64),
  assistants: [
    { slot_id: 'team-member-' + '2'.repeat(64), conversation_id: 'actestra-team-conversation-general', role: 'leader', assistant_backend: 'general', assistant_name: 'General', status: 'active', assistant_id: 'actestra-general-worker', model: 'default', pending_confirmations: 0 },
    { slot_id: 'team-member-' + '3'.repeat(64), conversation_id: 'actestra-team-conversation-goose', role: 'teammate', assistant_backend: 'goose', assistant_name: 'Goose', status: 'active', assistant_id: 'actestra-goose-worker', model: 'default', pending_confirmations: 1 },
  ],
  session_mode: 'plan',
  created_at: 1,
  updated_at: 2,
} as TTeam;

const runState = {
  session_generation: 'schema-15-revision-7',
  submission: {
    availability: 'available',
    blocked_reason: null,
    next_action: 'submit-task',
    authority_source: 'actestra-main-runtime',
  },
  active_run: {
    team_id: team.id,
    team_run_id: 'team-run-' + '4'.repeat(64),
    source: 'system_lifecycle',
    has_user_intervention: true,
    target_slot_id: team.assistants[0]!.slot_id,
    target_role: 'lead',
    status: 'running',
    queued_intent_count: 0,
    starting_batch_count: 0,
    running_batch_count: 1,
    active_enqueue_lease_count: 1,
    slot_work: [],
    actestra: {
      authority: 'Actestra Core',
      authority_source: 'schema-15-team-run',
      revision: 7,
      core_status: 'blocked',
      status_explanation: 'Goose is waiting for protected approval.',
      nodes: [
        {
          action_id: 'team-action-coding',
          slot_id: team.assistants[1]!.slot_id,
          title: 'Implement the isolated change',
          capability: 'coding',
          state: 'blocked',
          depends_on_action_ids: ['team-action-research'],
          blocked_reason: 'protected-approval',
          blocked_explanation: 'Approve the protected write before Goose continues.',
          current_executor: 'Goose',
          next_actions: ['approve', 'deny', 'cancel'],
          artifacts: [
            {
              artifact_id: 'artifact-' + '5'.repeat(64),
              kind: 'file',
              label: 'Patch preview',
              delivery: {
                native_conversation_id: 'actestra-coding-' + '8'.repeat(32),
                delivery_state: 'conflict',
                base_commit: 'a'.repeat(40),
                changed_file_count: 3,
                failure_code: 'patch-conflict',
              },
            },
          ],
        },
      ],
      result: null,
    },
  },
  slot_work: [],
  activities: [
    {
      id: 'team-message-' + '6'.repeat(64),
      author: 'You',
      content: 'Prepare the recovered Team result.',
      tone: 'user',
      occurred_at: 1,
    },
    {
      id: 'team-activity-' + '7'.repeat(64),
      author: 'Goose',
      content: 'Goose recovered its persisted coding summary.',
      tone: 'worker',
      occurred_at: 2,
    },
  ],
} satisfies NativeAionUiTeamRunState;

function renderWorkspace() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ActestraTeamWorkspace team={team} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  teamEventHandler = null;
  mocks.subscribe.mockImplementation((handler: (event: AionUiTeamEvent) => void) => {
    teamEventHandler = handler;
    return () => {
      if (teamEventHandler === handler) teamEventHandler = null;
    };
  });
  mocks.getState.mockResolvedValue(runState);
  mocks.approval.mockResolvedValue(runState);
  mocks.completeHandoff.mockResolvedValue(runState);
  mocks.rename.mockResolvedValue(undefined);
});

describe('Actestra Team workspace', () => {
  it('embeds collaboration controls in the native AionUI Team shell instead of a standalone page', async () => {
    renderWorkspace();

    expect(await screen.findByTestId('native-team-chat-layout')).toBeTruthy();
    expect(screen.getByTestId('native-team-tabs-slot')).toContainElement(
      screen.getByTestId('team-tab-bar'),
    );
    expect(screen.getByTestId('team-tab-bar')).toHaveAttribute('data-reorder-enabled', 'false');
    expect(screen.getByTestId('native-team-header-extra')).toContainElement(
      screen.getByTestId('team-view-toggle'),
    );
    expect(screen.getByTestId('actestra-team-workspace')).toBeTruthy();
  });

  it('keeps native title editing while routing the rename through the Actestra provider', async () => {
    renderWorkspace();

    expect(await screen.findByTestId('native-team-title')).toHaveTextContent('Launch Team');
    fireEvent.click(screen.getByTestId('native-team-rename'));
    await waitFor(() =>
      expect(mocks.rename).toHaveBeenCalledWith(team.id, 'Renamed collaborative Team'),
    );
    expect(screen.getByTestId('native-team-title')).toHaveTextContent(
      'Renamed collaborative Team',
    );
  });

  it('shows authority, executor, dependency, blocked reason, actions, and Artifact references', async () => {
    renderWorkspace();
    expect(await screen.findByText('Launch Team')).toBeTruthy();
    expect(screen.getByText('Actestra Core · recovered revision 7')).toBeTruthy();
    expect(screen.getByTestId('actestra-team-current-executor').textContent).toContain('Goose');
    expect(screen.getByTestId('actestra-team-blocked-reason').textContent).toContain('Approval is required before Goose can continue.');
    expect(screen.getByText('Depends on 1 earlier node(s)')).toBeTruthy();
    expect(screen.getByText('Patch preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('renders a delivered coding Artifact with the same apply card the non-Team surface uses', async () => {
    renderWorkspace();
    expect(await screen.findByTestId('actestra-team-artifacts')).toBeTruthy();
    expect(screen.getByTestId('actestra-coding-artifact-state').textContent).toContain('Conflict');
    expect(screen.getByTestId('actestra-coding-artifact-card-artifact-' + '5'.repeat(64))).toBeTruthy();
    expect(screen.getByText(/3 changed file\\(s\\)/)).toBeTruthy();
    expect(screen.getByText(/patch-conflict/)).toBeTruthy();
  });

  it('drives Team apply through the Main-owned coding journey bridge and never a Team-side write', async () => {
    mocks.applyArtifact.mockResolvedValue({ status: 'ok', artifactApply: { approvalId: 'approval-artifact-apply' } });
    renderWorkspace();
    fireEvent.click(await screen.findByTestId('actestra-coding-artifact-apply'));
    await waitFor(() => expect(mocks.applyArtifact).toHaveBeenCalledTimes(1));
    expect(mocks.applyArtifact.mock.calls[0]![0]).toEqual({
      contractVersion: 1,
      nativeConversationId: 'actestra-coding-' + '8'.repeat(32),
      artifactId: 'artifact-' + '5'.repeat(64),
    });
    expect(mocks.control).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.getState).toHaveBeenCalledTimes(2));
  });

  it('localizes the Main-owned blocked reason instead of rendering raw explanation text', async () => {
    renderWorkspace();
    const blocked = await screen.findByTestId('actestra-team-blocked-reason');
    expect(blocked).toHaveTextContent('Approval is required before Goose can continue.');
    expect(blocked).not.toHaveTextContent('Approve the protected write before Goose continues.');
  });

  it('localizes run, member, node, and capability tokens from the Main projection', async () => {
    renderWorkspace();
    expect(await screen.findByTestId('actestra-team-run-status')).toHaveTextContent('Blocked');
    expect(runState.active_run.status).toBe('running');
    expect(screen.getAllByTestId('actestra-team-member-status').every((item) => item.textContent === 'Active')).toBe(true);
    expect(screen.getByTestId('actestra-team-node-status')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('actestra-team-node-capability')).toHaveTextContent('Coding');
  });

  it('routes approval through the fixed Actestra Team control client', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approval).toHaveBeenCalledWith({
      teamId: team.id,
      runId: runState.active_run!.team_run_id,
      slotId: team.assistants[1]!.slot_id,
      decision: 'approved',
    }));
  });

  it('submits a bounded manual handoff result through Main instead of forging an Artifact identity', async () => {
    mocks.getState.mockResolvedValue({
      ...runState,
      active_run: {
        ...runState.active_run!,
        actestra: {
          ...runState.active_run!.actestra,
          nodes: [
            {
              ...runState.active_run!.actestra.nodes[0]!,
              state: 'handoff-required',
              blocked_reason: 'handoff',
              next_actions: [],
              artifacts: [],
            },
          ],
        },
      },
    } satisfies NativeAionUiTeamRunState);
    renderWorkspace();
    const input = await screen.findByTestId('actestra-team-handoff-input');
    fireEvent.change(input, { target: { value: 'The reviewed manual coding result is complete.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete handoff' }));
    await waitFor(() => expect(mocks.completeHandoff).toHaveBeenCalledWith({
      teamId: team.id,
      runId: runState.active_run!.team_run_id,
      slotId: team.assistants[1]!.slot_id,
      content: 'The reviewed manual coding result is complete.',
    }));
    expect(mocks.completeHandoff.mock.calls[0]![0]).not.toHaveProperty('artifactId');
    expect(mocks.completeHandoff.mock.calls[0]![0]).not.toHaveProperty('taskId');
  });

  it('shows a bounded inline control failure without rendering private bridge details', async () => {
    mocks.approval.mockRejectedValue(new BackendHttpError({
      method: 'POST',
      path: '/api/teams/private-runtime/approval',
      status: 409,
      body: { success: false, error: 'private approval evidence', code: 'team-conflict' },
    }));
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const failure = await screen.findByTestId('actestra-team-action-error');
    expect(failure).toHaveTextContent('The Team control failed.');
    expect(failure).toHaveTextContent('Refresh the Team state, then retry only an action shown as valid.');
    expect(failure.textContent).not.toContain('private approval evidence');
    expect(failure.textContent).not.toContain('/api/teams/private-runtime');
  });

  it('shows bounded whole-Team cancellation and rename failures', async () => {
    mocks.cancel.mockRejectedValue(new Error('private cancellation process detail'));
    mocks.rename.mockRejectedValue(new Error('private persistence path'));
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'team.actestra.cancelWholeTeam' }));
    let failure = await screen.findByTestId('actestra-team-action-error');
    expect(failure).toHaveTextContent('The Team could not be cancelled.');
    expect(failure).toHaveTextContent('Refresh the Team state and confirm whether cancellation completed before retrying.');
    expect(failure.textContent).not.toContain('private cancellation process detail');

    fireEvent.click(screen.getByTestId('native-team-rename'));
    await waitFor(() => expect(screen.getByTestId('actestra-team-action-error')).toHaveTextContent('The Team name could not be saved.'));
    failure = screen.getByTestId('actestra-team-action-error');
    expect(failure).toHaveTextContent('Refresh the Team state, then try the rename again.');
    expect(failure.textContent).not.toContain('private persistence path');
  });

  it('restores durable user and Worker activity from the recovered run state', async () => {
    const first = renderWorkspace();
    expect(await screen.findByText('Prepare the recovered Team result.')).toBeTruthy();
    expect(screen.getByText('Goose recovered its persisted coding summary.')).toBeTruthy();
    first.unmount();

    renderWorkspace();
    expect(await screen.findByText('Prepare the recovered Team result.')).toBeTruthy();
    expect(screen.getByText('Goose recovered its persisted coding summary.')).toBeTruthy();
  });

  it('shows only teammate messages owned by this Team conversation', async () => {
    renderWorkspace();
    expect(await screen.findByText('Launch Team')).toBeTruthy();
    act(() => teamEventHandler?.({
      type: 'team.teammateMessage',
      payload: {
        conversation_id: team.assistants[0]!.conversation_id,
        content: 'General finished the bounded research node.',
        from_slot_id: team.assistants[0]!.slot_id,
        from_name: 'General',
      },
    }));
    expect(await screen.findByText('General finished the bounded research node.')).toBeTruthy();

    act(() => teamEventHandler?.({
      type: 'team.teammateMessage',
      payload: {
        conversation_id: 'actestra-team-conversation-other',
        content: 'Other Team private message',
        from_slot_id: team.assistants[0]!.slot_id,
        from_name: 'Other',
      },
    }));
    expect(screen.queryByText('Other Team private message')).toBeNull();
  });

  it.each([
    ['team-invalid-request', 400, 'This Team task body has an invalid format.', 'Remove control characters and leading or trailing blank lines, then submit the task again.'],
    ['team-planner-invalid', 422, 'The supervised Team planner returned an invalid plan.', 'Review the Team goal and planner configuration, then retry without changing the Team identity.'],
    ['team-planner-timeout', 504, 'The supervised Team planner timed out.', 'Confirm the planner is responsive, then retry this task.'],
  ] as const)('shows bounded %s recovery guidance without losing the task', async (code, status, title, nextStep) => {
    mocks.getState.mockResolvedValue({
      ...runState,
      session_generation: null,
      active_run: null,
      slot_work: [],
      activities: [],
    } satisfies NativeAionUiTeamRunState);
    mocks.submit.mockRejectedValue(new BackendHttpError({
      method: 'POST',
      path: '/api/teams/private-runtime/messages',
      status,
      body: { success: false, error: 'private planner detail', code },
    }));

    renderWorkspace();
    const input = await screen.findByTestId('actestra-team-task-input');
    fireEvent.change(input, { target: { value: 'Prepare the bounded Team result.' } });
    fireEvent.click(screen.getByTestId('actestra-team-run-submit'));

    const failure = await screen.findByTestId('actestra-team-submit-error');
    expect(failure).toHaveTextContent(title);
    expect(failure).toHaveTextContent(nextStep);
    expect(failure.textContent).not.toContain('private planner detail');
    expect(failure.textContent).not.toContain('/api/teams/private-runtime');
    expect(input).toHaveValue('Prepare the bounded Team result.');
  });

  it('projects planner unavailability before effect and blocks an impossible task intent', async () => {
    mocks.getState.mockResolvedValue({
      session_generation: 'schema-15-no-run',
      submission: {
        availability: 'unavailable',
        blocked_reason: 'planner-unavailable',
        next_action: 'restart-after-planner-admission',
        authority_source: 'actestra-main-runtime',
      },
      active_run: null,
      slot_work: [],
      activities: [],
    } satisfies NativeAionUiTeamRunState);

    renderWorkspace();
    const input = await screen.findByTestId('actestra-team-task-input');
    fireEvent.change(input, { target: { value: 'Prepare the release plan.' } });

    const failure = await screen.findByTestId('actestra-team-submission-unavailable');
    expect(failure.textContent).toContain('The supervised Team planner is unavailable.');
    expect(failure.textContent).toContain('Check the admitted planner and retry this task.');
    expect(input).toBeDisabled();
    expect(screen.getByTestId('actestra-team-run-submit')).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('projects missing Worker readiness before effect and explains the next action', async () => {
    mocks.getState.mockResolvedValue({
      session_generation: 'schema-15-no-run',
      submission: {
        availability: 'unavailable',
        blocked_reason: 'worker-runtime-unavailable',
        next_action: 'configure-worker-runtime',
        authority_source: 'actestra-main-runtime',
      },
      active_run: null,
      slot_work: [],
      activities: [],
    } satisfies NativeAionUiTeamRunState);

    renderWorkspace();
    const input = await screen.findByTestId('actestra-team-task-input');
    const failure = await screen.findByTestId('actestra-team-worker-runtime-unavailable');
    expect(failure.textContent).toContain('The required General and Goose Worker runtime is unavailable.');
    expect(failure.textContent).toContain('Configure both Worker runtimes in Actestra, then refresh this Team.');
    expect(input).toBeDisabled();
    expect(screen.getByTestId('actestra-team-run-submit')).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('blocks task submission while the authoritative Team state is unavailable', async () => {
    mocks.getState.mockRejectedValue(new Error('Main/Core Team state unavailable'));

    renderWorkspace();
    expect(await screen.findByText('team.actestra.authorityUnavailable')).toBeTruthy();

    const input = screen.getByTestId('actestra-team-task-input');
    fireEvent.change(input, { target: { value: 'Do not submit without Core state.' } });

    expect(input).toBeDisabled();
    expect(screen.getByTestId('actestra-team-run-submit')).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
`,
);

const activeLeaseDomTestPath = "tests/unit/renderer/conversation/useActiveLease.dom.test.ts";
replaceOnce(
  activeLeaseDomTestPath,
  `const conversationActiveLease = vi.mocked(ipcBridge.conversation.activeLease.invoke);`,
  `const activeLeaseMocks = vi.hoisted(() => ({
  providerActive: false,
  renewActestraTeamActiveLease: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  isActestraTeamProviderActive: () => activeLeaseMocks.providerActive,
  renewActestraTeamActiveLease: (...args: unknown[]) => activeLeaseMocks.renewActestraTeamActiveLease(...args),
}));

const conversationActiveLease = vi.mocked(ipcBridge.conversation.activeLease.invoke);`,
);
replaceOnce(
  activeLeaseDomTestPath,
  `  it('renews team lease with the team endpoint', () => {`,
  `  it('renews provider-active Team leases through the Main/Core projection', () => {
    activeLeaseMocks.providerActive = true;
    renderHook(() => useActiveLease({ type: 'team', id: 'team-1' }));

    expect(activeLeaseMocks.renewActestraTeamActiveLease).toHaveBeenCalledWith('team-1');
    expect(teamActiveLease).not.toHaveBeenCalled();
  });

  it('renews team lease with the native endpoint when the provider is absent', () => {`,
);

replaceOnce(
  activeLeaseDomTestPath,
  `    vi.clearAllMocks();
    setVisibilityState('visible');`,
  `    vi.clearAllMocks();
    activeLeaseMocks.providerActive = false;
    activeLeaseMocks.renewActestraTeamActiveLease.mockReset().mockResolvedValue(undefined);
    setVisibilityState('visible');`,
);

const activeLeaseHookPath =
  "packages/desktop/src/renderer/pages/conversation/hooks/useActiveLease.ts";
replaceOnce(
  activeLeaseHookPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import {
  isActestraTeamProviderActive,
  renewActestraTeamActiveLease,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  activeLeaseHookPath,
  `      } else {
        void ipcBridge.team.activeLease.invoke({ team_id: id }).catch(() => {});
      }`,
  `      } else {
        const renewal = isActestraTeamProviderActive()
          ? renewActestraTeamActiveLease(id)
          : ipcBridge.team.activeLease.invoke({ team_id: id });
        void renewal.catch(() => {});
      }`,
);
replaceOnce(
  "packages/desktop/src/common/adapter/actestraTeamClient.ts",
  `export async function ensureActestraTeamSession(teamId: string): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeam | NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(teamId) + '/session'
  );
}`,
  `export async function ensureActestraTeamSession(teamId: string): Promise<void> {
  await requestActestraTeam<NativeAionUiStandardTeam | NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(teamId) + '/session'
  );
}

export async function renewActestraTeamActiveLease(teamId: string): Promise<void> {
  await requestActestraTeam<null | NativeAionUiTeamRunState>('POST', '/api/teams/' + segment(teamId) + '/active-lease');
}`,
);

const siderTeamRunningDomTestPath = "tests/unit/renderer/layout/useSiderTeamRunning.dom.test.ts";
replaceOnce(
  siderTeamRunningDomTestPath,
  `vi.mock('@/common', () => ({`,
  `const providerMocks = vi.hoisted(() => ({
  active: false,
  getRunState: vi.fn(),
  handler: null as ((event: unknown) => void) | null,
  unsubscribe: vi.fn(),
  subscribe: vi.fn((handler: (event: unknown) => void) => {
    providerMocks.handler = handler;
    return providerMocks.unsubscribe;
  }),
}));

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  getProjectedTeamRunState: (...args: unknown[]) => providerMocks.getRunState(...args),
  isActestraTeamProviderActive: () => providerMocks.active,
  subscribeActestraTeamEvents: (handler: (event: unknown) => void) => providerMocks.subscribe(handler),
}));

vi.mock('@/common', () => ({`,
);
replaceOnce(
  siderTeamRunningDomTestPath,
  `    bridgeMocks.getRunState.mockResolvedValue(emptyRunState());
    Object.keys(bridgeMocks.handlers).forEach((key) => delete bridgeMocks.handlers[key]);`,
  `    bridgeMocks.getRunState.mockResolvedValue(emptyRunState());
    providerMocks.active = false;
    providerMocks.getRunState.mockReset();
    providerMocks.getRunState.mockResolvedValue(emptyRunState());
    providerMocks.handler = null;
    providerMocks.unsubscribe.mockReset();
    Object.keys(bridgeMocks.handlers).forEach((key) => delete bridgeMocks.handlers[key]);`,
);
replaceOnce(
  siderTeamRunningDomTestPath,
  `  it.each(ACTIVE_CASES)('shows a team as running for %s events', async (channel, status) => {`,
  `  it('hydrates a provider-active Team running badge from the Main/Core projection', async () => {
    providerMocks.active = true;
    providerMocks.getRunState.mockResolvedValue({
      ...emptyRunState(),
      active_run: runEvent({ status: 'running' }),
    });

    const { result } = renderHook(() => useSiderTeamRunning([team('team-1')]));

    await waitFor(() => expect(result.current('team-1')).toBe(true));
    expect(providerMocks.getRunState).toHaveBeenCalledWith('team-1');
    expect(bridgeMocks.getRunState).not.toHaveBeenCalled();
  });

  it('applies provider-active orchestrated run events to the running badge', async () => {
    providerMocks.active = true;
    const { result, unmount } = renderHook(() => useSiderTeamRunning([team('team-1')]));
    await waitFor(() => expect(providerMocks.handler).toBeTypeOf('function'));

    act(() => {
      providerMocks.handler?.({ type: 'team.runStarted', payload: runEvent({ status: 'running' }) });
    });

    expect(result.current('team-1')).toBe(true);
    unmount();
    expect(providerMocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('reconciles provider-active native run hints through Main/Core', async () => {
    providerMocks.active = true;
    const { result } = renderHook(() => useSiderTeamRunning([team('team-1')]));
    await waitFor(() => expect(bridgeMocks.on.runStarted).toHaveBeenCalledOnce());
    await waitFor(() => expect(providerMocks.getRunState).toHaveBeenCalledTimes(1));

    emitRun('runStarted', runEvent({ status: 'running' }));

    await waitFor(() => expect(providerMocks.getRunState).toHaveBeenCalledTimes(2));
    expect(result.current('team-1')).toBe(false);
  });

  it.each(ACTIVE_CASES)('shows a team as running for %s events', async (channel, status) => {`,
);

const siderTeamRunningPath =
  "packages/desktop/src/renderer/components/layout/Sider/useSiderTeamRunning.ts";
replaceOnce(
  siderTeamRunningPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import {
  getProjectedTeamRunState,
  isActestraTeamProviderActive,
  subscribeActestraTeamEvents,
} from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  siderTeamRunningPath,
  `      const snapshot = await ipcBridge.team.getRunState.invoke({ team_id });`,
  `      const snapshot = isActestraTeamProviderActive()
        ? await getProjectedTeamRunState(team_id)
        : await ipcBridge.team.getRunState.invoke({ team_id });`,
);
replaceOnce(
  siderTeamRunningPath,
  `    return removeStack(
      ipcBridge.team.runAccepted.on(applyRunEvent),`,
  `    return removeStack(
      subscribeActestraTeamEvents((event) => {
        switch (event.type) {
          case 'team.runAccepted':
          case 'team.runStarted':
          case 'team.runUpdated':
          case 'team.runCompleted':
          case 'team.runCancelled':
          case 'team.runFailed':
            applyRunEvent(event.payload as unknown as ITeamRunEvent);
            return;
          default:
            return;
        }
      }),
      ipcBridge.team.runAccepted.on(applyRunEvent),`,
);
replaceOnce(
  siderTeamRunningPath,
  `    return removeStack(
      subscribeActestraTeamEvents((event) => {
        switch (event.type) {
          case 'team.runAccepted':
          case 'team.runStarted':
          case 'team.runUpdated':
          case 'team.runCompleted':
          case 'team.runCancelled':
          case 'team.runFailed':
            applyRunEvent(event.payload as unknown as ITeamRunEvent);
            return;
          default:
            return;
        }
      }),
      ipcBridge.team.runAccepted.on(applyRunEvent),
      ipcBridge.team.runStarted.on(applyRunEvent),
      ipcBridge.team.runUpdated.on(applyRunEvent),
      ipcBridge.team.runCompleted.on(applyRunEvent),
      ipcBridge.team.runCancelled.on(applyRunEvent),
      ipcBridge.team.runFailed.on(applyRunEvent),`,
  `    const applyNativeRunHint = (event: ITeamRunEvent): void => {
      if (isActestraTeamProviderActive()) {
        if (knownTeamIdsRef.current.has(event.team_id)) void reconcileTeam(event.team_id);
        return;
      }
      applyRunEvent(event);
    };
    const runSubscriptions = [
      subscribeActestraTeamEvents((event) => {
        switch (event.type) {
          case 'team.runAccepted':
          case 'team.runStarted':
          case 'team.runUpdated':
          case 'team.runCompleted':
          case 'team.runCancelled':
          case 'team.runFailed':
            applyRunEvent(event.payload as unknown as ITeamRunEvent);
            return;
          default:
            return;
        }
      }),
      ipcBridge.team.runAccepted.on(applyNativeRunHint),
      ipcBridge.team.runStarted.on(applyNativeRunHint),
      ipcBridge.team.runUpdated.on(applyNativeRunHint),
      ipcBridge.team.runCompleted.on(applyNativeRunHint),
      ipcBridge.team.runCancelled.on(applyNativeRunHint),
      ipcBridge.team.runFailed.on(applyNativeRunHint),
    ];
    return removeStack(
      ...runSubscriptions,`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/actestraTeamClient.ts",
  `export async function getStandardTeamRunState(teamId: string): Promise<ITeamRunStateResponse> {
  const result = await requestActestraTeam<NativeAionUiStandardTeamRunState>(
    'GET',
    '/api/teams/' + segment(teamId) + '/run-state'
  );
  return {
    session_generation: result.session_generation,
    active_run: result.active_run as ITeamRunStateResponse['active_run'],
    slot_work: result.slot_work as ITeamRunStateResponse['slot_work'],
  };
}`,
  `export async function getProjectedTeamRunState(teamId: string): Promise<ITeamRunStateResponse> {
  const result = await requestActestraTeam<NativeAionUiStandardTeamRunState | NativeAionUiTeamRunState>(
    'GET',
    '/api/teams/' + segment(teamId) + '/run-state'
  );
  return {
    session_generation: result.session_generation,
    active_run: result.active_run as ITeamRunStateResponse['active_run'],
    slot_work: result.slot_work as ITeamRunStateResponse['slot_work'],
  };
}

export function getStandardTeamRunState(teamId: string): Promise<ITeamRunStateResponse> {
  return getProjectedTeamRunState(teamId);
}`,
);

const titlebarPath = "packages/desktop/src/renderer/components/layout/Titlebar/index.tsx";
replaceOnce(
  titlebarPath,
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import { getActestraTeam, isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  titlebarPath,
  `        void ipcBridge.team.get
          .invoke({ id: team_id })
          .then((team) => {`,
  `        const teamProjection = isActestraTeamProviderActive()
          ? getActestraTeam(team_id)
          : ipcBridge.team.get.invoke({ id: team_id });
        void teamProjection
          .then((team) => {`,
);

replaceOnce(
  "tests/unit/actestra/teamNativeWiring.test.ts",
  `  it('keeps Workspace selection in the registered main window and projects no path', () => {`,
  `  it('keeps sidebar running state and mobile Team title on the Main/Core projection', () => {
    const client = read('packages/desktop/src/common/adapter/actestraTeamClient.ts');
    const running = read('packages/desktop/src/renderer/components/layout/Sider/useSiderTeamRunning.ts');
    const titlebar = read('packages/desktop/src/renderer/components/layout/Titlebar/index.tsx');
    expect(client).toContain('export async function getProjectedTeamRunState');
    expect(running).toContain('? await getProjectedTeamRunState(team_id)');
    expect(running).toContain('subscribeActestraTeamEvents((event) => {');
    expect(running).toContain(': await ipcBridge.team.getRunState.invoke({ team_id })');
    expect(titlebar).toContain('? getActestraTeam(team_id)');
    expect(titlebar).toContain(': ipcBridge.team.get.invoke({ id: team_id })');
  });

  it('keeps Workspace selection in the registered main window and projects no path', () => {`,
);
