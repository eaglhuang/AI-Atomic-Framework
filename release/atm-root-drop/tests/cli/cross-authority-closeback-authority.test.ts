import assert from 'node:assert/strict';
import { buildClosebackPlan } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';

const plan = buildClosebackPlan({
  cwd: process.cwd(),
  taskId: 'ATM-GOV-0326',
  actorId: 'validator',
  historicalDeliveryRefs: [],
  delegationContract: {
    hostOpenerAvailable: false,
    openerPath: null,
    describeOnly: true,
    hint: 'fixture',
    displayHint: null,
    invocable: false,
    generationSurface: 'tasks-new',
    policy: {
      allocateTaskId: { mode: 'fallback', prefix: null, format: null },
      resolveCanonicalOutputPath: { mode: 'fallback', pattern: null, directory: null },
      rosterSyncPolicy: 'none',
      rosterSync: { indexPath: null },
      fallbackBehavior: { mode: 'template-only-fallback', reason: 'fixture', missingPrerequisites: [] }
    }
  },
  taskDocument: {
    source: {
      planningSourceSeal: {
        schemaId: 'atm.planningSourceSeal.v1',
        repoIdentity: 'fixture-planning',
        contentDigest: 'sha256:fixture-source'
      }
    }
  },
  targetFiles: ['packages/cli/src/commands/taskflow/cross-authority-closeback.ts'],
  planningFiles: ['governance-optimization/tasks/ATM-GOV-0326.task.md'],
  diagnosis: {
    bucket: 'no-residue',
    truth: 'fixture',
    residue: 'fixture',
    reason: 'fixture',
    nextCommand: 'node atm.mjs tasks status --task ATM-GOV-0326 --json',
    triangulation: {
      liveLedger: { status: 'running' },
      planningFrontmatter: { status: 'planned', source: null },
      divergence: []
    }
  }
});

assert.ok(plan.authorityReconciliation, 'closeback facade must expose one authority reconciliation plan');
assert.equal(plan.authorityReconciliation?.schemaId, 'atm.crossAuthorityClosebackPlan.v1');
assert.equal(plan.authorityReconciliation?.receipt.sourceIdentity, 'fixture-planning:sha256:fixture-source');
assert.equal(plan.authorityReconciliation?.receipt.receiptDigest.startsWith('sha256:'), true);
assert.deepEqual(plan.authorityReconciliation?.expectedFiles.target, ['packages/cli/src/commands/taskflow/cross-authority-closeback.ts']);

console.log('[cross-authority-closeback-authority.test] ok');
