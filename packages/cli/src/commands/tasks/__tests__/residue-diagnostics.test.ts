import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildResidueClassification,
  buildResidueDiagnosisEvidenceFromTriangulation,
  type TaskStatusTriangulation
} from '../residue-diagnostics.ts';

function fail(message: string): never {
  console.error(`[residue-diagnostics.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function taskDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planningRepo: 'PlanningRepo',
    targetRepo: 'TargetRepo',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-13T00:00:00.000Z',
    ...extra
  };
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-residue-diagnostics-'));
try {
  mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
  writeFileSync(
    path.join(repo, '.atm', 'history', 'evidence', 'TASK-RES.closure-packet.json'),
    `${JSON.stringify({ schemaId: 'atm.closurePacket.v1', taskId: 'TASK-RES' }, null, 2)}\n`,
    'utf8'
  );

  const noResidue = buildResidueClassification({
    cwd: repo,
    taskId: 'TASK-RES',
    taskDocument: taskDocument({
      closurePacket: '.atm/history/evidence/TASK-RES.closure-packet.json'
    }),
    liveLedger: {
      status: 'done',
      claimState: 'released',
      lastTransitionId: 'close-1',
      lastTransitionAt: '2026-06-13T00:00:00.000Z'
    },
    planningFrontmatter: {
      status: 'done',
      source: '../planning/tasks/TASK-RES.task.md'
    },
    lastTransitionEvent: {
      action: 'close',
      actorId: 'captain',
      createdAt: '2026-06-13T00:00:00.000Z',
      fromStatus: 'running',
      toStatus: 'done'
    },
    divergence: []
  });
  assert(noResidue.bucket === 'no-residue', 'done/done with provenance must classify as no-residue');
  assert(noResidue.nextCommand === 'node atm.mjs tasks status --task TASK-RES --json', 'no-residue command must materialize task id');
  assert(noResidue.autoMutationAllowed === false, 'residue diagnostics must never auto-mutate');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const ambiguous = buildResidueClassification({
  cwd: process.cwd(),
  taskId: 'TASK-RES',
  taskDocument: taskDocument({ status: 'running' }),
  liveLedger: {
    status: 'running',
    claimState: 'active',
    lastTransitionId: 'claim-1',
    lastTransitionAt: '2026-06-13T00:00:00.000Z'
  },
  planningFrontmatter: {
    status: 'review',
    source: '../planning/tasks/TASK-RES.task.md'
  },
  lastTransitionEvent: {
    action: 'claim',
    actorId: 'captain',
    createdAt: '2026-06-13T00:00:00.000Z',
    fromStatus: 'ready',
    toStatus: 'running'
  },
  divergence: [
    {
      field: 'status',
      liveLedger: 'running',
      planningFrontmatter: 'review',
      lastTransitionEvent: 'running'
    }
  ]
});
assert(ambiguous.bucket === 'ambiguous-manual-review', 'divergence must fail closed as ambiguous-manual-review');
assert(ambiguous.nextCommand === 'node atm.mjs tasks status --task TASK-RES --json', 'ambiguous command must stay diagnostic-only');

const incomplete = buildResidueClassification({
  cwd: process.cwd(),
  taskId: 'TASK-RES',
  taskDocument: taskDocument(),
  liveLedger: {
    status: 'done',
    claimState: 'released',
    lastTransitionId: 'close-1',
    lastTransitionAt: '2026-06-13T00:00:00.000Z'
  },
  planningFrontmatter: {
    status: 'done',
    source: '../planning/tasks/TASK-RES.task.md'
  },
  lastTransitionEvent: {
    action: 'close',
    actorId: 'captain',
    createdAt: '2026-06-13T00:00:00.000Z',
    fromStatus: 'running',
    toStatus: 'done'
  },
  divergence: []
});
assert(incomplete.bucket === 'source-done-governance-incomplete', 'done without provenance must surface governance gap');
assert(incomplete.residue.includes('Missing proof segments'), 'governance gap must name missing proof segments');

const closebackFinalize = buildResidueClassification({
  cwd: process.cwd(),
  taskId: 'TASK-RES',
  taskDocument: taskDocument(),
  liveLedger: {
    status: 'running',
    claimState: 'active',
    lastTransitionId: 'claim-1',
    lastTransitionAt: '2026-06-13T00:00:00.000Z'
  },
  planningFrontmatter: {
    status: 'done',
    source: '../planning/tasks/TASK-RES.task.md'
  },
  lastTransitionEvent: {
    action: 'claim',
    actorId: 'captain',
    createdAt: '2026-06-13T00:00:00.000Z',
    fromStatus: 'ready',
    toStatus: 'running'
  },
  divergence: []
});
assert(closebackFinalize.bucket === 'closeback-finalize', 'planning record done but ledger running must classify as closeback-finalize');
assert(closebackFinalize.nextCommand === 'node atm.mjs taskflow close --task TASK-RES --json', 'closeback-finalize command must point to taskflow close');

const triangulation: TaskStatusTriangulation = {
  ssot: 'liveLedger',
  liveLedger: {
    status: 'running',
    claimState: 'active',
    lastTransitionId: 'claim-1',
    lastTransitionAt: '2026-06-13T00:00:00.000Z'
  },
  lastTransitionEvent: null,
  planningFrontmatter: {
    status: 'review',
    source: '../planning/tasks/TASK-RES.task.md'
  },
  divergence: [
    {
      field: 'status',
      liveLedger: 'running',
      planningFrontmatter: 'review'
    }
  ],
  recommendation: 'node atm.mjs tasks import --from <plan.md> --write --json',
  residueClassification: ambiguous
};
const evidence = buildResidueDiagnosisEvidenceFromTriangulation({
  taskId: 'TASK-RES',
  triangulation
});
assert(evidence.schemaId === 'atm.taskResidueDiagnosis.v1', 'diagnosis evidence schema must be stable');
assert(evidence.diagnostics.codes.includes('ATM_TASK_RESIDUE_AMBIGUOUS_MANUAL_REVIEW'), 'diagnosis code must be bucket-derived');
assert(evidence.triangulation === triangulation, 'diagnosis evidence must preserve triangulation object');

console.log('[residue-diagnostics.test] ok');
