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
      leaseEpoch: 1,
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
      leaseEpoch: 2,
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
    targetDeliveryFiles: ['src/app.ts']
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

assert.equal(hint.brokerConflictGate.verdict, 'noConflict');
assert.ok(hint.blockers.every((entry) => entry.code !== 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'));

// A close can declare planning/read-only authority paths in addition to files
// that the target repository will write.  The target work ticket covers only
// the latter; planning authority is checked by the independent closeback
// gate.  Passing the combined declaration set to work admission used to turn
// a valid target ticket into a scope violation.
writeJson(path.join(repo, '.atm/history/tasks/TASK-WRITE-0003.json'), {
  status: 'done',
  scopePaths: ['src/app.ts'],
  claim: {
    state: 'active',
    actorId: 'validator',
    leaseId: 'lease-3',
    ttlSeconds: 3600
  }
});
const planningReadOnlyHint = buildTaskflowCloseWriteReadinessHint({
  cwd: repo,
  taskId: 'TASK-WRITE-0003',
  actorId: 'validator',
  taskDocument: {
    status: 'done',
    claim: {
      state: 'active',
      actorId: 'validator',
      leaseId: 'lease-3'
    }
  },
  declaredFiles: ['src/app.ts', 'C:/planning/docs/tasks/TASK-WRITE-0003.task.md'],
  closebackPlan: {
    writerBoundary: { planningMirrorPath: null },
    closebackPathResolution: null,
    historicalDeliveryGate: { required: false }
  } as any,
  previewCommitBundle: {
    targetDeliveryFiles: ['src/app.ts']
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
assert.ok(
  planningReadOnlyHint.blockers.every((entry) => entry.code !== 'ATM_WRITE_TICKET_SCOPE_VIOLATION'),
  'target work admission must evaluate the target delivery set, not read-only planning declarations'
);

// ATM-BUG-2026-07-07-050: a stale/unresolvable closeback planning path (route
// 'missing' or 'ambiguous') used to only fail at `--write` time via
// assertClosebackPlanningPathReady(), while dry-run's write-readiness hint had
// no matching blocker and reported `ready`. Confirm the hint now surfaces the
// same failure dry-run sees, so `--write` cannot fail in a way dry-run did not
// already disclose.
const staleClosebackHint = buildTaskflowCloseWriteReadinessHint({
  cwd: repo,
  taskId: 'TASK-WRITE-0002',
  actorId: 'validator',
  taskDocument: {
    status: 'done',
    claim: {
      state: 'released',
      actorId: 'validator',
      leaseId: 'lease-2'
    }
  },
  declaredFiles: ['src/app.ts'],
  closebackPlan: {
    writerBoundary: { planningMirrorPath: null },
    closebackPathResolution: {
      route: 'missing',
      planningMirrorPath: null,
      profileRepoRoot: null,
      planningStatus: null,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'],
        messages: ['Planning card path from source.planPath does not exist: docs/tasks/TASK-WRITE-0002.task.md.']
      }
    },
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
assert.equal(staleClosebackHint.status, 'blocked', 'dry-run must report blocked when the closeback path route is missing, matching what --write would throw');
assert.ok(
  staleClosebackHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'),
  'dry-run blockers must include the same code assertClosebackPlanningPathReady() would throw at --write time'
);

// A closure-critical acceptance predicate is consumed by `tasks close` when it
// builds the packet.  taskflow preview must surface the exact same missing
// evidence rather than reporting ready until the first write attempt.
const acceptanceEvidenceHint = buildTaskflowCloseWriteReadinessHint({
  cwd: repo,
  taskId: 'TASK-WRITE-0004',
  actorId: 'validator',
  taskDocument: {
    status: 'done',
    claim: { state: 'released', actorId: 'validator', leaseId: 'lease-4' },
    acceptanceEvidence: {
      'external-proof': {
        id: 'external-proof',
        claim: 'An independently verified external proof exists.',
        authoritativeSources: ['atm.externalProof.v1'],
        derivationRule: 'verify-external-proof',
        requiredRealness: 'production-ledger',
        verifier: { mode: 'separate-actor', actorId: 'independent-verifier' },
        negativeControls: [{ id: 'missing-proof', expectedFailureReason: 'proof-missing' }],
        missingDataVerdict: 'inconclusive',
        closureCritical: true
      }
    }
  },
  declaredFiles: ['src/app.ts'],
  closebackPlan: {
    writerBoundary: { planningMirrorPath: null },
    closebackPathResolution: null,
    historicalDeliveryGate: { required: false }
  } as any,
  previewCommitBundle: { targetDeliveryFiles: [] },
  historicalDeliveryRefs: [],
  planningAuthorityDeliveryGate: {
    required: false,
    ok: false,
    repoRoot: null,
    matchedFiles: [],
    reason: null
  }
});
assert.equal(acceptanceEvidenceHint.status, 'blocked');
assert.ok(
  acceptanceEvidenceHint.blockers.some((entry) => entry.code === 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT'),
  'taskflow preview must surface the same missing acceptance observation that blocks tasks close'
);

console.log('ok: write readiness spec passed');
