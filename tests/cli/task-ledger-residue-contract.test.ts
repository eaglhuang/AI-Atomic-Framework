import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResidueClassification } from '../../packages/cli/src/commands/tasks/residue-diagnostics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-task-ledger-residue-contract');

type ResidueFixture = {
  readonly label: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly liveLedger: {
    status: string | null;
    claimState: string | null;
    lastTransitionId: string | null;
    lastTransitionAt: string | null;
  };
  readonly planningFrontmatter: {
    status: string | null;
    source: string | null;
  };
  readonly lastTransitionEvent: {
    action: string | null;
    actorId: string | null;
    createdAt: string | null;
    fromStatus: string | null;
    toStatus: string | null;
  } | null;
  readonly divergence: readonly { field: string; liveLedger: string | null }[];
  readonly expectedBucket: string;
  readonly recoveryIncludes: readonly string[];
};

const residueContract: readonly ResidueFixture[] = [
  {
    label: 'done without governed closeout fails closed before planning-mirror-only',
    taskId: 'TASK-RESIDUE-CONTRACT-0001',
    taskDocument: {
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      source: { planPath: 'docs/fixtures/residue-mirror.task.md' }
    },
    liveLedger: { status: 'done', claimState: null, lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'done', source: 'docs/fixtures/residue-mirror.task.md' },
    lastTransitionEvent: null,
    divergence: [],
    expectedBucket: 'source-done-governance-incomplete',
    recoveryIncludes: ['repair-closure']
  },
  {
    label: 'stale-import uses governed reconcile-mirror recovery',
    taskId: 'TASK-RESIDUE-CONTRACT-0002',
    taskDocument: {
      planningRepo: '3KLife',
      targetRepo: 'AI-Atomic-Framework',
      closureAuthority: 'target_repo',
      closurePacket: '.atm/history/evidence/TASK-RESIDUE-CONTRACT-0002.closure-packet.json',
      closedAt: '2026-06-10T00:00:00.000Z',
      source: { planPath: 'docs/fixtures/missing-residue-stale.task.md' }
    },
    liveLedger: { status: 'done', claimState: null, lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'open', source: 'docs/fixtures/missing-residue-stale.task.md' },
    lastTransitionEvent: null,
    divergence: [],
    expectedBucket: 'stale-import',
    recoveryIncludes: ['tasks import', '--reconcile-mirror']
  },
  {
    label: 'complete-but-unfinalized points to reconcile',
    taskId: 'TASK-RESIDUE-CONTRACT-0003',
    taskDocument: {
      planningRepo: '3KLife',
      targetRepo: 'AI-Atomic-Framework',
      closureAuthority: 'target_repo',
      closedAt: '2026-06-10T00:00:00.000Z',
      closurePacket: '.atm/history/evidence/TASK-RESIDUE-CONTRACT-0003.closure-packet.json',
      claim: { state: 'active' },
      source: { planPath: 'docs/fixtures/residue-complete.task.md' }
    },
    liveLedger: { status: 'running', claimState: 'active', lastTransitionId: 'transition-1', lastTransitionAt: '2026-06-10T00:00:00.000Z' },
    planningFrontmatter: { status: 'done', source: 'docs/fixtures/residue-complete.task.md' },
    lastTransitionEvent: { action: 'close', actorId: 'fixture-agent', createdAt: '2026-06-10T00:00:00.000Z', fromStatus: 'running', toStatus: 'running' },
    divergence: [],
    expectedBucket: 'complete-but-unfinalized',
    recoveryIncludes: ['tasks reconcile']
  },
  {
    label: 'interrupted-close points to repair-closure',
    taskId: 'TASK-RESIDUE-CONTRACT-0004',
    taskDocument: {
      planningRepo: '3KLife',
      targetRepo: 'AI-Atomic-Framework',
      closureAuthority: 'target_repo',
      closedAt: '2026-06-10T00:00:00.000Z',
      claim: { state: 'active' },
      source: { planPath: 'docs/fixtures/residue-interrupted.task.md' }
    },
    liveLedger: { status: 'done', claimState: 'active', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'done', source: 'docs/fixtures/residue-interrupted.task.md' },
    lastTransitionEvent: null,
    divergence: [],
    expectedBucket: 'interrupted-close',
    recoveryIncludes: ['repair-closure']
  }
];

try {
  mkdirSync(tempDir, { recursive: true });
  for (const fixture of residueContract) {
    const closurePacketPath = typeof fixture.taskDocument.closurePacket === 'string'
      ? path.join(tempDir, fixture.taskDocument.closurePacket)
      : null;
    if (closurePacketPath) {
      mkdirSync(path.dirname(closurePacketPath), { recursive: true });
      writeFileSync(closurePacketPath, `${JSON.stringify({ schemaId: 'atm.closurePacket.v1', taskId: fixture.taskId }, null, 2)}\n`, 'utf8');
    }
    const classification = buildResidueClassification({
      cwd: tempDir,
      taskId: fixture.taskId,
      taskDocument: fixture.taskDocument,
      liveLedger: fixture.liveLedger,
      planningFrontmatter: fixture.planningFrontmatter,
      lastTransitionEvent: fixture.lastTransitionEvent,
      divergence: fixture.divergence
    });
    assert.equal(
      classification.bucket,
      fixture.expectedBucket,
      `${fixture.label}: expected bucket ${fixture.expectedBucket}, got ${classification.bucket}`
    );
    for (const fragment of fixture.recoveryIncludes) {
      assert.ok(
        classification.nextCommand.includes(fragment),
        `${fixture.label}: recovery command must include ${fragment}: ${classification.nextCommand}`
      );
    }
    assert.equal(classification.autoMutationAllowed, false, `${fixture.label}: residue must not auto-mutate`);
  }

  const mirrorFixture = residueContract[0];
  const governanceIncomplete = buildResidueClassification({
    cwd: tempDir,
    taskId: mirrorFixture.taskId,
    taskDocument: mirrorFixture.taskDocument,
    liveLedger: mirrorFixture.liveLedger,
    planningFrontmatter: mirrorFixture.planningFrontmatter,
    lastTransitionEvent: mirrorFixture.lastTransitionEvent,
    divergence: mirrorFixture.divergence
  });
  assert.notEqual(
    governanceIncomplete.bucket,
    'planning-mirror-only',
    'done without governed closeout must not downgrade to planning-mirror-only'
  );
  assert.ok(
    !governanceIncomplete.nextCommand.includes('--force'),
    'residue recovery must not recommend emergency --force import'
  );

  console.log('[task-ledger-residue-contract] ok');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
