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
  `import {
  AionUiApprovalAuthorityService,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';`,
  `import {
  AionUiApprovalAuthorityService,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import {
  createPolicyGatedAionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalPolicyGate';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `const approvalAuthorityEnabled =
  process.env.ACTESTRA_APPROVAL_AUTHORITY !== '0';`,
  `const approvalAuthorityEnabled =
  process.env.ACTESTRA_APPROVAL_AUTHORITY !== '0';
const approvalPolicyGateEnabled =
  process.env.ACTESTRA_APPROVAL_POLICY_GATE !== '0';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    approvalService = new AionUiApprovalAuthorityService(
      persistence,
      new LoopbackAionUiApprovalNativeTransport(),
    );`,
  `    const nativeApprovalTransport =
      new LoopbackAionUiApprovalNativeTransport();
    const approvalTransport = approvalPolicyGateEnabled
      ? createPolicyGatedAionUiApprovalNativeTransport({
          persistence,
          transport: nativeApprovalTransport,
        })
      : nativeApprovalTransport;
    approvalService = new AionUiApprovalAuthorityService(
      persistence,
      approvalTransport,
    );`,
);

writeNew(
  "tests/unit/actestra/approvalPolicyGate.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AionUiApprovalDecisionRecord,
} from '@/actestra/compatibility/aionui';
import { instant } from '@/actestra/core';
import {
  AionUiApprovalAuthorityService,
  type AionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import {
  createPolicyGatedAionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalPolicyGate';
import {
  openSqliteCorePersistence,
} from '@/actestra/main/persistence/sqliteCorePersistence';

const directories: string[] = [];

function directory(): string {
  const value = fs.mkdtempSync(
    path.join(os.tmpdir(), 'actestra-downstream-policy-gate-'),
  );
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) {
    if (
      !value.startsWith(
        path.join(os.tmpdir(), 'actestra-downstream-policy-gate-'),
      )
    ) {
      throw new Error(\`Refusing to remove unexpected test directory: \${value}\`);
    }
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe('Actestra AionUi approval policy gate', () => {
  it('routes one persisted response through durable P3 policy and tool audit', async () => {
    const persistence = openSqliteCorePersistence(directory());
    const deliver = vi.fn(async (_record: AionUiApprovalDecisionRecord) => {});
    const nativeTransport: AionUiApprovalNativeTransport = {
      isPending: vi.fn(async () => true),
      deliver,
    };
    let identifier = 0;
    let now = Date.parse('2026-07-29T08:45:00.000Z');
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence,
      transport: nativeTransport,
      clock: {
        now: () => {
          const value = instant(new Date(now).toISOString());
          now += 1_000;
          return value;
        },
      },
      newIdentifier: (prefix) => \`\${prefix}-\${String(++identifier)}\`,
    });
    const service = new AionUiApprovalAuthorityService(
      persistence,
      gated,
      {
        now: () => {
          const value = new Date(now).toISOString();
          now += 1_000;
          return value;
        },
      },
    );

    await expect(
      service.resolve({
        contractVersion: 1,
        method: 'POST',
        path:
          '/api/conversations/private-conversation/confirmations/private-call/confirm',
        body: {
          msg_id: 'private-message',
          data: { value: 'proceed_once' },
        },
      }),
    ).resolves.toMatchObject({
      status: 'delivered',
      disposition: 'new',
      attemptCount: 1,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    await expect(persistence.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 0,
      deliveredCount: 1,
    });
    await persistence.close();
  });
});
`,
);
