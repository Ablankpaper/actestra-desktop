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

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import type { ActestraPersistencePort } from '@/actestra/core';`,
  `import {
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  type ActestraPersistencePort,
} from '@/actestra/core';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import {
  launchElectronPersistenceUtility,
} from '@/actestra/main/persistence/electronPersistenceUtility';`,
  `import {
  launchElectronPersistenceUtility,
} from '@/actestra/main/persistence/electronPersistenceUtility';
import {
  createScopedNativeToolPlatform,
  type ScopedNativeToolPlatform,
} from '@/actestra/main/privileged/scopedNativeToolPlatform';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `let approvalService: AionUiApprovalAuthorityService | null = null;
let handlerRegistered = false;`,
  `let approvalService: AionUiApprovalAuthorityService | null = null;
let nativeToolPlatform: ScopedNativeToolPlatform | null = null;
let handlerRegistered = false;`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  persistence = activePersistence;
  projectionService = new AionUiShadowProjectionService(activePersistence);
  const nativeApprovalTransport =`,
  `  persistence = activePersistence;
  projectionService = new AionUiShadowProjectionService(activePersistence);
  nativeToolPlatform = createScopedNativeToolPlatform({
    persistence: activePersistence,
  });
  console.info(
    \`[Actestra native tools] Ready tools=\${WORKSPACE_READ_TEXT_TOOL_ID},\${TASK_OUTPUT_WRITE_TEXT_TOOL_ID}\`,
  );
  const nativeApprovalTransport =`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    persistence = null;
    projectionService = null;
    approvalService = null;
    console.warn('[Actestra shadow] Persistence utility unavailable at startup');`,
  `    persistence = null;
    projectionService = null;
    approvalService = null;
    nativeToolPlatform = null;
    console.warn('[Actestra shadow] Persistence utility unavailable at startup');`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `function startApprovalRecovery(): void {`,
  `export function getActestraScopedNativeToolPlatform(): ScopedNativeToolPlatform | null {
  return nativeToolPlatform;
}

function startApprovalRecovery(): void {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  projectionService = null;
  approvalService = null;
  approvalRecoveryStarted = false;`,
  `  projectionService = null;
  approvalService = null;
  nativeToolPlatform = null;
  approvalRecoveryStarted = false;`,
);

writeNew(
  "tests/unit/actestra/scopedNativeTools.test.ts",
  `// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  parseScopedNativeToolInput,
  scopedNativeToolDefinition,
} from '@/actestra/core';
import {
  scopedNativePolicySnapshot,
} from '@/actestra/main/privileged/scopedNativeToolPlatform';

describe('Actestra scoped native tools', () => {
  it('registers only the two GW-P4.4 capabilities and exact production rules', () => {
    expect(scopedNativeToolDefinition(WORKSPACE_READ_TEXT_TOOL_ID)).toMatchObject({
      action: 'workspace.read',
      resourceKind: 'workspace',
    });
    expect(scopedNativeToolDefinition(TASK_OUTPUT_WRITE_TEXT_TOOL_ID)).toMatchObject({
      action: 'artifact.create',
      resourceKind: 'task-output',
    });
    expect(scopedNativePolicySnapshot().rules).toEqual([
      expect.objectContaining({
        effect: 'allow',
        actions: ['workspace.read'],
        resourceKinds: ['workspace'],
        credentialUse: 'none',
        toolIds: [WORKSPACE_READ_TEXT_TOOL_ID],
      }),
      expect.objectContaining({
        effect: 'allow',
        actions: ['artifact.create'],
        resourceKinds: ['task-output'],
        credentialUse: 'none',
        toolIds: [TASK_OUTPUT_WRITE_TEXT_TOOL_ID],
      }),
    ]);
    expect(() => scopedNativeToolDefinition('actestra.shell.execute')).toThrow();
  });

  it('fails closed for traversal and unknown fields', () => {
    expect(() =>
      parseScopedNativeToolInput(
        WORKSPACE_READ_TEXT_TOOL_ID,
        JSON.stringify({ contractVersion: 1, relativePath: '../outside.txt' }),
      ),
    ).toThrow();
    expect(() =>
      parseScopedNativeToolInput(
        TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
        JSON.stringify({
          contractVersion: 1,
          relativePath: 'result.txt',
          mediaType: 'text/plain; charset=utf-8',
          content: 'bounded',
          overwrite: true,
        }),
      ),
    ).toThrow();
  });
});
`,
);
