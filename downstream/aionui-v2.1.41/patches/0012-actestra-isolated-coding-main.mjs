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

const bridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  bridgePath,
  `import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';`,
  `import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';
import {
  createIsolatedCodingMainService,
  type IsolatedCodingMainService,
} from '@/actestra/main/workers/isolatedCodingMainService';`,
);

replaceOnce(
  bridgePath,
  `let nativeToolPlatform: ScopedNativeToolPlatform | null = null;
let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;`,
  `let nativeToolPlatform: ScopedNativeToolPlatform | null = null;
let isolatedCodingMainService: IsolatedCodingMainService | null = null;
let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;`,
);

replaceOnce(
  bridgePath,
  `function configurePersistenceServices(
  activePersistence: ActestraPersistencePort,
): void {`,
  `function configurePersistenceServices(
  activePersistence: ActestraPersistencePort,
  userDataPath: string,
): void {`,
);

replaceOnce(
  bridgePath,
  `  const platform = nativeToolPlatform;
  const nativeContext =`,
  `  const platform = nativeToolPlatform;
  isolatedCodingMainService = createIsolatedCodingMainService({
    persistence: activePersistence,
    clock: platform.clock,
    managedRoot: path.join(userDataPath, 'coding-worktrees'),
  });
  console.info('[Actestra isolated coding] Desktop-main containment ready');
  const nativeContext =`,
);

replaceOnce(
  bridgePath,
  `export function getActestraScopedNativeToolPlatform(): ScopedNativeToolPlatform | null {
  return nativeToolPlatform;
}

function startApprovalRecovery(): void {`,
  `export function getActestraScopedNativeToolPlatform(): ScopedNativeToolPlatform | null {
  return nativeToolPlatform;
}

export function getActestraIsolatedCodingMainService(): IsolatedCodingMainService | null {
  return isolatedCodingMainService;
}

function startApprovalRecovery(): void {`,
);

replaceOnce(
  bridgePath,
  `    configurePersistenceServices(utility);`,
  `    configurePersistenceServices(utility, userDataPath);`,
);

replaceOnce(
  bridgePath,
  `  } catch {
    await scheduleService?.close().catch((): undefined => undefined);`,
  `  } catch {
    await isolatedCodingMainService?.close().catch((): undefined => undefined);
    isolatedCodingMainService = null;
    await scheduleService?.close().catch((): undefined => undefined);`,
);

replaceOnce(
  bridgePath,
  `  const activeSchedule = scheduleService;
  const activeGeneralWork = generalWorkJourneyService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;`,
  `  const activeSchedule = scheduleService;
  const activeGeneralWork = generalWorkJourneyService;
  const activeIsolatedCoding = isolatedCodingMainService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;`,
);

replaceOnce(
  bridgePath,
  `  currentWindow = null;
  persistence = null;
  projectionService = null;`,
  `  currentWindow = null;
  projectionService = null;`,
);

replaceOnce(
  bridgePath,
  `  disposeScheduleBridge?.();
  await activeSchedule?.close().catch((): undefined => undefined);
  await activeGeneralWork?.close().catch((): undefined => undefined);`,
  `  disposeScheduleBridge?.();
  let isolatedCodingCloseFailed = false;
  let isolatedCodingCloseError: unknown;
  try {
    await activeIsolatedCoding?.close();
    isolatedCodingMainService = null;
  } catch (error) {
    isolatedCodingCloseFailed = true;
    isolatedCodingCloseError = error;
  }
  await activeSchedule?.close().catch((): undefined => undefined);
  await activeGeneralWork?.close().catch((): undefined => undefined);
  if (isolatedCodingCloseFailed) {
    throw isolatedCodingCloseError;
  }
  persistence = null;`,
);

writeNew(
  "tests/unit/actestra/isolatedCodingMainComposition.test.ts",
  `// @vitest-environment node

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  instant,
  workspaceGrantId,
  workspaceId,
  type ActestraPersistencePort,
} from '@/actestra/core';
import {
  createIsolatedCodingMainService,
} from '@/actestra/main/workers/isolatedCodingMainService';

describe('Actestra native isolated-coding main composition', () => {
  it('exposes only a main-owned lifecycle service and denies opening after close', async () => {
    const service = createIsolatedCodingMainService({
      persistence: {} as ActestraPersistencePort,
      clock: { now: () => instant('2026-08-03T12:00:00.000Z') },
      managedRoot: path.resolve(process.cwd(), '.actestra-coding-worktrees-test'),
    });

    expect(service.openGoose).toBeTypeOf('function');
    await service.close();

    await expect(
      service.open({
        repositoryRoot: path.resolve(process.cwd(), '.actestra-coding-repository-test'),
        workspaceId: workspaceId('workspace-native-coding-main'),
        grantId: workspaceGrantId('grant-native-coding-main'),
        displayName: 'Native coding main test',
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: 'IsolatedCodingMainServiceError',
      code: 'closed',
    });
  });
});
`,
);
