import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCloseWriteReadinessHint } from '../write-readiness.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function initGitRepo(repo: string) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-write-readiness-'));
initGitRepo(repo);
writeJson(path.join(repo, '.atm/runtime/write-broker.registry.json'), {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'fixture',
  workspaceId: 'main',
  currentEpoch: 2,
  activeIntents: [
    {
      intentId: 'intent-self',
      taskId: 'TASK-WRITE-0001',
      actorId: 'validator',
      baseCommit: 'base',
      resourceKeys: {
        files: ['src/app.ts'],
        atomIds: ['ATOM-SELF'],
        atomCids: ['CID-SELF'],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      leaseEpoch: 2,
      leaseSeconds: 1800,
      leaseMaxSeconds: 1800,
      heartbeatAt: '2026-06-20T00:00:00.000Z',
      lane: 'direct-brokered',
      expiresAt: '2099-01-01T00:00:00.000Z'
    },
    {
      intentId: 'intent-foreign',
      taskId: 'TASK-WRITE-FOREIGN',
      actorId: 'other',
      baseCommit: 'base',
      resourceKeys: {
        files: ['src/app.ts'],
        atomIds: ['ATOM-FOREIGN'],
        atomCids: ['CID-FOREIGN'],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      leaseEpoch: 1,
      leaseSeconds: 1800,
      leaseMaxSeconds: 1800,
      heartbeatAt: '2026-06-20T00:00:00.000Z',
      lane: 'direct-brokered',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  ]
});

const hint = buildTaskflowCloseWriteReadinessHint({
  cwd: repo,
  taskId: 'TASK-WRITE-0001',
  actorId: 'validator',
  taskDocument: {
    status: 'done',
    claim: {
      state: 'released',
      actorId: 'validator',
      leaseId: 'lease-1'
    }
  },
  declaredFiles: ['src/app.ts'],
  closebackPlan: {
    writerBoundary: { planningMirrorPath: null },
    closebackPathResolution: null,
    historicalDeliveryGate: { required: false }
  } as any,
  previewCommitBundle: {
    targetDeliveryFiles: []
  },
  historicalDeliveryRefs: [],
  planningAuthorityDeliveryGate: {
    required: false,
    ok: false,
    repoRoot: null,
    matchedFiles: [],
    reason: null
  }
});

assert.equal(hint.brokerConflictGate.verdict, 'takeoverRequired');
assert.ok(hint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'));

console.log('ok: write readiness spec passed');
