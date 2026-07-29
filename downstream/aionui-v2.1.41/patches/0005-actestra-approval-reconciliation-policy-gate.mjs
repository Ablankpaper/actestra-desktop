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
  createPolicyGatedAionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalPolicyGate';`,
  `import {
  createPolicyGatedAionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalPolicyGate';
import {
  createPolicyGatedAionUiApprovalReconciliationTransport,
} from '@/actestra/main/compatibility/aionuiApprovalReconciliationPolicyGate';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `const approvalPolicyGateEnabled =
  process.env.ACTESTRA_APPROVAL_POLICY_GATE !== '0';`,
  `const approvalPolicyGateEnabled =
  process.env.ACTESTRA_APPROVAL_POLICY_GATE !== '0';
const approvalReconciliationGateEnabled =
  process.env.ACTESTRA_APPROVAL_RECONCILIATION_GATE !== '0';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    const approvalTransport = approvalPolicyGateEnabled
      ? createPolicyGatedAionUiApprovalNativeTransport({
          persistence,
          transport: nativeApprovalTransport,
        })
      : nativeApprovalTransport;
    approvalService = new AionUiApprovalAuthorityService(
      persistence,
      approvalTransport,
    );`,
  `    const deliveryGatedApprovalTransport = approvalPolicyGateEnabled
      ? createPolicyGatedAionUiApprovalNativeTransport({
          persistence,
          transport: nativeApprovalTransport,
        })
      : nativeApprovalTransport;
    const approvalTransport =
      approvalPolicyGateEnabled && approvalReconciliationGateEnabled
        ? createPolicyGatedAionUiApprovalReconciliationTransport({
            persistence,
            transport: deliveryGatedApprovalTransport,
          })
        : deliveryGatedApprovalTransport;
    approvalService = new AionUiApprovalAuthorityService(
      persistence,
      approvalTransport,
    );`,
);

writeNew(
  "tests/unit/actestra/approvalReconciliationPolicyGate.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeAionUiApprovalDecisionRequest,
  type AionUiApprovalDecisionRecord,
} from '@/actestra/compatibility/aionui';
import { instant } from '@/actestra/core';
import {
  AionUiApprovalAuthorityService,
  type AionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import {
  createPolicyGatedAionUiApprovalReconciliationTransport,
} from '@/actestra/main/compatibility/aionuiApprovalReconciliationPolicyGate';
import {
  openSqliteCorePersistence,
} from '@/actestra/main/persistence/sqliteCorePersistence';

const directories: string[] = [];

function directory(): string {
  const value = fs.mkdtempSync(
    path.join(os.tmpdir(), 'actestra-downstream-reconciliation-gate-'),
  );
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) {
    if (
      !value.startsWith(
        path.join(os.tmpdir(), 'actestra-downstream-reconciliation-gate-'),
      )
    ) {
      throw new Error(\`Refusing to remove unexpected test directory: \${value}\`);
    }
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe('Actestra AionUi approval reconciliation policy gate', () => {
  it('audits a restart reconciliation read without redelivering the response', async () => {
    const persistence = openSqliteCorePersistence(directory());
    try {
      const normalized = normalizeAionUiApprovalDecisionRequest({
        contractVersion: 1,
        method: 'POST',
        path:
          '/api/conversations/private-conversation/confirmations/private-call/confirm',
        body: {
          msg_id: 'private-message',
          data: { value: 'proceed_once' },
        },
      });
      await persistence.reserveAionUiApprovalDecision(
        normalized,
        '2026-07-29T10:44:00.000Z',
      );
      await persistence.beginAionUiApprovalDelivery(
        normalized.decisionId,
        '2026-07-29T10:44:01.000Z',
      );

      const isPending = vi.fn(async (_record: AionUiApprovalDecisionRecord) => false);
      const deliver = vi.fn(async (_record: AionUiApprovalDecisionRecord) => {});
      const nativeTransport: AionUiApprovalNativeTransport = {
        isPending,
        deliver,
      };
      let identifier = 0;
      let now = Date.parse('2026-07-29T10:45:00.000Z');
      const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
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
        disposition: 'reconciled',
        attemptCount: 1,
      });
      expect(isPending).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();
      await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
        recordCount: 3,
        lastSequence: 3,
      });
      await expect(persistence.summarizeAionUiApprovalAuthority()).resolves.toEqual({
        recordCount: 1,
        pendingCount: 0,
        deliveredCount: 1,
      });
    } finally {
      await persistence.close();
    }
  });
});
`,
);
