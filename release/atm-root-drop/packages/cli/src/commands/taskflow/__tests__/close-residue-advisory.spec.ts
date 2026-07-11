import assert from 'node:assert/strict';
import { buildTaskflowCloseResidueAdvisory, buildTaskflowPlanningIndexAdvisory } from '../../taskflow.ts';

const staleImport = buildTaskflowCloseResidueAdvisory({
  bucket: 'stale-import',
  truth: 'live ledger is done, but the planning mirror has not converged',
  residue: 'The imported ledger is ahead of the planning mirror.',
  reason: 'Mirror metadata needs a governed refresh.',
  nextCommand: 'node atm.mjs tasks import --from <plan.md> --write --reconcile-mirror --json'
});

assert.equal(staleImport?.schemaId, 'atm.taskflowCloseResidueAdvisory.v1');
assert.equal(staleImport?.severity, 'warning');
assert.equal(staleImport?.closeSucceeded, true);
assert.equal(staleImport?.recoveryCommand, 'node atm.mjs tasks import --from <plan.md> --write --reconcile-mirror --json');

const planningMirrorOnly = buildTaskflowCloseResidueAdvisory({
  bucket: 'planning-mirror-only',
  nextCommand: 'node atm.mjs tasks import --from <plan.md> --write --reconcile-mirror --json'
});
assert.equal(planningMirrorOnly?.bucket, 'planning-mirror-only');

const hardResidue = buildTaskflowCloseResidueAdvisory({
  bucket: 'ambiguous-manual-review',
  nextCommand: 'node atm.mjs tasks status --task <id> --residue --json'
});
assert.equal(hardResidue, null, 'ambiguous residue must not be downgraded to a close success advisory');

const planningIndex = buildTaskflowPlanningIndexAdvisory({
  taskId: 'TASK-RFT-0080',
  planningRosterPaths: {
    repoRoot: 'C:/repo/planning',
    indexPath: 'docs/tasks/README.md',
    fromPath: 'docs/tasks/TASK-RFT-0080.task.md'
  },
  rosterCommand: 'node atm.mjs tasks roster update --index docs/tasks/README.md --from docs/tasks/TASK-RFT-0080.task.md --json',
  rosterCloseback: {
    mode: 'inline',
    result: {
      ok: true,
      evidence: {
        unchanged: false,
        diff: {
          before: '| [TASK-RFT-0080](./TASK-RFT-0080.task.md) | Sync | planned |',
          after: '| [TASK-RFT-0080](./TASK-RFT-0080.task.md) | Sync | done |'
        }
      }
    }
  }
});
assert.equal(planningIndex?.schemaId, 'atm.taskflowPlanningIndexAdvisory.v1');
assert.equal(planningIndex?.status, 'updated');
assert.equal(planningIndex?.indexPath, 'docs/tasks/README.md');
assert.ok(planningIndex?.frontmatterFields.includes('delivery_commit'));
assert.match(planningIndex?.requiredCommand ?? '', /tasks roster update/);

console.log('[close-residue-advisory.spec] ok');
