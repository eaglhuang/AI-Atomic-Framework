import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../../packages/cli/src/commands/quickfix.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { listActiveBatchRuns } from '../../packages/cli/src/commands/work-channels.ts';
import { assert, assertDecisionTrail, assertRunnerMode, assertTeamRecommendation, runGit } from './assertions.ts';
import { writeLedgerTask, writeTaskCard } from './writers.ts';

export async function runImportScenarios(ctx: any) {
  const { tempRoot, taskDir, externalTaskDir, ledgerTaskDir } = ctx;
    // Regression: TASK-AAO-0038 import contract fidelity — nested evidence/rollback, legacy alias diagnostics.
    writeFileSync(path.join(taskDir, 'TASK-FIDELITY-0001.task.md'), `---
task_id: TASK-FIDELITY-0001
title: Import contract fidelity card
status: planned
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/tasks.ts"
deliverables:
  - "packages/cli/src/commands/tasks.ts"
validators:
  - "npm run typecheck"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Restore previous projection if import regresses."
atomizationImpact:
  ownerAtomOrMap: "atm.task-ledger-governance-map"
  mapUpdates:
    - "atomic_workbench/atomization-coverage/path-to-atom-map.json"
---
# TASK-FIDELITY-0001
`, 'utf8');
    const fidelityImport = await runTasks(['import', '--cwd', tempRoot, '--from', path.join('docs', 'plan', 'tasks', 'TASK-FIDELITY-0001.task.md'), '--dry-run', '--json']);
    const fidelityManifest = (fidelityImport.evidence as any).manifest ?? {};
    const fidelityTask = Array.isArray(fidelityManifest.tasks) ? fidelityManifest.tasks[0] : null;
    assert(fidelityTask, 'tasks import --dry-run must parse nested evidence/rollback task card');
    assert(fidelityTask.evidenceRequired === 'command-backed', 'tasks import must unpack nested evidence.required');
    assert(fidelityTask.rollbackStrategy === 'revert-commit', 'tasks import must unpack nested rollback.strategy');
    assert(fidelityTask.rollbackNotes && fidelityTask.rollbackNotes.includes('Restore previous projection'), 'tasks import must unpack nested rollback.notes');
    assert(fidelityTask.atomizationImpact?.ownerAtomOrMap === 'atm.task-ledger-governance-map', 'tasks import must unpack nested atomizationImpact.ownerAtomOrMap');
    assert(Array.isArray(fidelityTask.atomizationImpact?.mapUpdates) && fidelityTask.atomizationImpact.mapUpdates.includes('atomic_workbench/atomization-coverage/path-to-atom-map.json'), 'tasks import must unpack nested atomizationImpact.mapUpdates');
    assert(fidelityTask.targetRepo === 'AI-Atomic-Framework', 'tasks import must preserve targetRepo');
    assert(fidelityTask.closureAuthority === 'target_repo', 'tasks import must preserve closureAuthority');

    // Regression: legacy allowed_files alias must produce an import diagnostic.
    writeFileSync(path.join(taskDir, 'TASK-LEGACY-0001.task.md'), `---
task_id: TASK-LEGACY-0001
title: Legacy alias card
status: planned
target_repo: AI-Atomic-Framework
allowed_files:
  - "packages/cli/src/commands/tasks.ts"
---
# TASK-LEGACY-0001
`, 'utf8');
    const legacyImport = await runTasks(['import', '--cwd', tempRoot, '--from', path.join('docs', 'plan', 'tasks', 'TASK-LEGACY-0001.task.md'), '--dry-run', '--json']);
    const legacyManifest = (legacyImport.evidence as any).manifest ?? {};
    const legacyTask = Array.isArray(legacyManifest.tasks) ? legacyManifest.tasks[0] : null;
    assert(legacyTask, 'tasks import --dry-run must parse legacy allowed_files card');
    assert(Array.isArray(legacyTask.scopePaths) && legacyTask.scopePaths.includes('packages/cli/src/commands/tasks.ts'), 'legacy allowed_files must project to scopePaths');
    const legacyDiagnostics = Array.isArray(legacyTask.importDiagnostics) ? legacyTask.importDiagnostics : [];
    assert(legacyDiagnostics.some((entry: any) => entry?.code === 'ATM_TASK_IMPORT_LEGACY_ALIAS' && entry?.alias === 'allowed_files'), 'legacy allowed_files alias must emit ATM_TASK_IMPORT_LEGACY_ALIAS diagnostic');
    assert(legacyTask.legacyImportAliases?.allowed_files, 'legacy alias projection must retain allowed_files lineage');

    // Regression: planning_repo authority + different target_repo must route to mirror-sync-only.
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-PLANNING-0001.json'), 'TASK-PLANNING-0001', 'Planning-only stale mirror', 'docs/planning-only.md', {
      status: 'planned',
      sourcePlanPath: path.relative(tempRoot, path.join(externalTaskDir, 'TASK-PLANNING-0001.task.md')).replace(/\\/g, '/'),
      scopePaths: ['docs/planning-only.md'],
      targetRepo: 'PlanningRepo',
      closureAuthority: 'planning_repo',
      planningRepo: 'PlanningRepo'
    });
    writeFileSync(path.join(externalTaskDir, 'TASK-PLANNING-0001.task.md'), `---
task_id: TASK-PLANNING-0001
title: Planning-only mirror source card
status: done
target_repo: PlanningRepo
planning_repo: PlanningRepo
closure_authority: planning_repo
scopePaths:
  - "docs/planning-only.md"
---
# TASK-PLANNING-0001
`, 'utf8');
    const planningRoute = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-PLANNING-0001']);
    assert(planningRoute.ok === true, 'planning_repo-authority task lookup must still succeed');
    assert(planningRoute.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED'), 'planning_repo authority + different target_repo must emit ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED');
    const planningNextAction = (planningRoute.evidence.nextAction as any) ?? {};
    assert(planningNextAction.status === 'task-mirror-sync-required', 'planning_repo authority must produce task-mirror-sync-required next action');
    assert(planningNextAction.recommendedChannel === 'mirror-sync', 'planning_repo authority must recommend mirror-sync channel, not normal/batch');
    assert(planningNextAction.deliveryClassification?.intent === 'mirror-sync-only', 'planning_repo authority must classify as mirror-sync-only');
    assert(planningNextAction.deliveryClassification?.statusDivergence === true, 'planning_repo authority with stale ledger must record statusDivergence');
    assert(planningNextAction.deliveryClassification?.sourceStatus === 'done', 'planning_repo authority must read source-card status (done) from the source task card');
    assert(typeof planningNextAction.requiredCommand === 'string' && planningNextAction.requiredCommand.includes('tasks import') && planningNextAction.requiredCommand.includes('--write') && planningNextAction.requiredCommand.includes('--force'), 'planning_repo authority must recommend tasks import --write --force as required command');
    const planningClaimBlocked = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-PLANNING-0001']).catch((error: any) => ({ ok: false, error }));
    const planningClaimError = (planningClaimBlocked as any).error;
    assert(planningClaimError && planningClaimError.code === 'ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED', 'next --claim on a planning_repo-authority task must throw ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED');

    const ambiguous = await runNext(['--cwd', tempRoot, '--prompt', 'Please do the next task card']);
    assert(ambiguous.ok === false, 'ambiguous task-card prompt must not route as ok');
    assert(ambiguous.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SELECTION_REQUIRED'), 'ambiguous task-card prompt must ask for task selection');
    const ambiguousTrail = assertDecisionTrail(ambiguous.evidence.nextAction as any, 'task-selection-required');
    assert(ambiguousTrail.some((entry) => entry.check === 'prompt-scope-resolution' && entry.result === 'blocked'), 'ambiguous route decisionTrail must record selection requirement');

}
