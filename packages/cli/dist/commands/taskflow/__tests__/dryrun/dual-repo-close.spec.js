import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runTaskflow } from '../../../taskflow.js';
import { buildTaskflowCommitMessage } from '../../commit-messages.js';
import { makeDualRepoCloseFixture, readBranchRef, writeBranchCommitQueueLock, writeJson, writeText } from './fixtures.js';
const dryRunFixture = await makeDualRepoCloseFixture('dryrun');
const dryRunClose = await runTaskflow([
    'close',
    '--cwd', dryRunFixture.targetRepo,
    '--task', dryRunFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', dryRunFixture.deliveryCommit,
    '--json'
]);
assert.equal(dryRunClose.ok, true);
assert.equal(dryRunClose.evidence.governedCommitBundle.schemaId, 'atm.taskflowGovernedCommitBundle.v1');
assert.equal(dryRunClose.evidence.governedCommitBundle.commitMode, 'dry-run');
assert.equal(dryRunClose.evidence.governedCommitBundle.targetRepo.status, 'preview');
assert.equal(dryRunClose.evidence.governedCommitBundle.planningRepo.status, 'preview');
assert.equal(dryRunClose.evidence.governedCommitBundle.targetRepo.commitMessage, buildTaskflowCommitMessage('target', { taskId: dryRunFixture.taskId }), 'target close commit message must come from the taskflow commit-message strategy');
assert.equal(dryRunClose.evidence.governedCommitBundle.planningRepo.commitMessage, buildTaskflowCommitMessage('planning', { taskId: dryRunFixture.taskId }), 'planning close commit message must come from the taskflow commit-message strategy');
assert.deepEqual(dryRunClose.evidence.governedCommitBundle.targetDeliveryFiles, []);
assert.ok(dryRunClose.evidence.closebackPlan.historicalDeliveryGate.refs.includes(dryRunFixture.deliveryCommit));
assert.ok(dryRunClose.evidence.governedCommitBundle.targetRepo.stageFiles.includes(`.atm/history/tasks/${dryRunFixture.taskId}.json`), 'pre-close bundle must carry current-task governance files for historical close state');
assert.ok(dryRunClose.evidence.governedCommitBundle.planningRepo.stageFiles.includes(`docs/tasks/${dryRunFixture.taskId}.task.md`));
assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dryRunFixture.targetRepo, encoding: 'utf8' }).trim(), '', 'dry-run must not stage target repo');
assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dryRunFixture.planningRepo, encoding: 'utf8' }).trim(), '', 'dry-run must not stage planning repo');
const secondCloseHintFixture = await makeDualRepoCloseFixture('second-close-hint', { closePlanningStatus: 'planned' });
const secondCloseHintDryRun = await runTaskflow([
    'close',
    '--cwd', secondCloseHintFixture.targetRepo,
    '--profile', secondCloseHintFixture.profilePath,
    '--task', secondCloseHintFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(secondCloseHintDryRun.ok, true, 'post-delivery second close dry-run must succeed');
assert.equal(secondCloseHintDryRun.evidence.closebackPlan.historicalDeliveryGate.required, true, 'post-delivery second close must require historical delivery before write');
const branchQueueBusyFixture = await makeDualRepoCloseFixture('branch-queue-busy', { closePlanningStatus: 'planned' });
writeBranchCommitQueueLock(branchQueueBusyFixture.targetRepo, {
    actorId: 'other-writer',
    taskId: 'TASK-OTHER-FINALIZING',
    branchRef: readBranchRef(branchQueueBusyFixture.targetRepo)
});
const branchQueueBusyDryRun = await runTaskflow([
    'close',
    '--cwd', branchQueueBusyFixture.targetRepo,
    '--profile', branchQueueBusyFixture.profilePath,
    '--task', branchQueueBusyFixture.taskId,
    '--actor', 'validator',
    '--json'
]);
assert.equal(branchQueueBusyDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy');
assert.ok(branchQueueBusyDryRun.evidence.writeReadinessHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY'), 'active branch commit queue must block taskflow close --write before commit tail');
const historicalDeliveryBlocker = secondCloseHintDryRun.evidence.writeReadinessHint.blockers.find((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED');
assert.ok(historicalDeliveryBlocker, 'post-delivery second close must surface historical-delivery blocker');
assert.ok(historicalDeliveryBlocker.requiredCommand.includes(secondCloseHintFixture.deliveryCommit), 'historical-delivery blocker must promote the detected delivery SHA in requiredCommand');
assert.equal(secondCloseHintDryRun.evidence.writeReadinessHint.nextCommand, historicalDeliveryBlocker.requiredCommand, 'writeReadinessHint.nextCommand must match the promoted historical-delivery command');
const normalLaneFixture = await makeDualRepoCloseFixture('normal-lane-planned', { closePlanningStatus: 'planned' });
const normalLaneDryRun = await runTaskflow([
    'close',
    '--cwd', normalLaneFixture.targetRepo,
    '--profile', normalLaneFixture.profilePath,
    '--task', normalLaneFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', normalLaneFixture.deliveryCommit,
    '--json'
]);
assert.equal(normalLaneDryRun.ok, true);
assert.equal(normalLaneDryRun.evidence.closeMode, 'normal-close', 'active target ledger plus open planning card must stay on the normal close lane');
assert.equal(normalLaneDryRun.evidence.closebackPlan.backendSurface, 'tasks-close', 'normal close lane must route to tasks-close backend');
const normalLaneStage = await runTaskflow([
    'close',
    '--cwd', normalLaneFixture.targetRepo,
    '--profile', normalLaneFixture.profilePath,
    '--task', normalLaneFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', normalLaneFixture.deliveryCommit,
    '--write',
    '--no-commit',
    '--json'
]);
assert.equal(normalLaneStage.evidence.closeMode, 'normal-close');
assert.equal(normalLaneStage.evidence.planningCardCloseback?.mode, 'frontmatter-closeback', 'taskflow close must update the planning card in the same closeback story');
assert.equal(normalLaneStage.evidence.planningIndexAdvisory?.status, 'updated', 'taskflow close must report planning roster/index closeback status');
assert.equal(normalLaneStage.evidence.planningIndexAdvisory?.indexPath, 'docs/tasks/README.md', 'planning index advisory must identify the roster index path');
assert.ok(normalLaneStage.evidence.planningIndexAdvisory?.frontmatterFields.includes('lastTransitionId'), 'planning index advisory must list the closeback frontmatter fields that keep the plan snapshot auditable');
const normalLanePlanningCard = readFileSync(normalLaneFixture.planPath, 'utf8');
assert.ok(normalLanePlanningCard.includes('status: done'), 'taskflow close must mark the planning card done');
assert.ok(normalLanePlanningCard.includes('completed_by_agent: "validator"'), 'taskflow close must record the planning closeback actor');
assert.ok(normalLanePlanningCard.includes('closedByActor: "validator"'), 'taskflow close must stamp CLI close provenance onto the planning card');
assert.ok(normalLanePlanningCard.includes('closedByCommand: atm tasks close'), 'taskflow close must identify the governed close command on the planning card');
assert.ok(normalLanePlanningCard.includes('lastTransitionId: "'), 'taskflow close must record a planning mirror transition id');
assert.ok(normalLanePlanningCard.includes(`delivery_commit: "${normalLaneFixture.deliveryCommit}"`), 'taskflow close must record the delivery commit on the planning card');
const normalLaneTransitionId = /lastTransitionId:\s*"([^"]+)"/.exec(normalLanePlanningCard)?.[1];
assert.ok(normalLaneTransitionId, 'taskflow close must make the planning mirror transition event addressable');
assert.equal(existsSync(path.join(normalLaneFixture.planningRepo, '.atm/history/task-events', normalLaneFixture.taskId, `${normalLaneTransitionId}.json`)), true, 'taskflow close must emit the planning mirror transition event needed by task audit');
assert.deepEqual(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: normalLaneFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean), ['.atm/history/task-events/' + normalLaneFixture.taskId + '/' + normalLaneTransitionId + '.json', 'docs/tasks/README.md', `docs/tasks/${normalLaneFixture.taskId}.task.md`], 'normal close lane must exact-stage only the planning closeback bundle');
const batchLaneFixture = await makeDualRepoCloseFixture('historical-batch', { closePlanningStatus: 'planned' });
const batchId = 'hist-batch-fixture';
writeJson(path.join(batchLaneFixture.targetRepo, '.atm/history/evidence/historical-batches', `${batchId}.json`), {
    schemaId: 'atm.historicalBatchEvidence.v1',
    batchId,
    taskIds: [batchLaneFixture.taskId],
    commits: [batchLaneFixture.deliveryCommit],
    tasks: [{
            taskId: batchLaneFixture.taskId,
            ok: true,
            matchedCommits: [batchLaneFixture.deliveryCommit],
            matchedFiles: ['src/deliver.txt'],
            outOfScopeFiles: [],
            declaredDeliverables: ['src/deliver.txt'],
            declaredScopeFiles: ['src/deliver.txt'],
            matchedDeliverables: ['src/deliver.txt'],
            missingCoverage: [],
            coverageStatus: 'complete',
            validatorClaims: [{ gate: 'validate:cli', kind: 'taskSpecific', satisfied: true, requiredForClose: true }],
            taskSpecificValidationPasses: ['validate:cli'],
            batchWideValidationPasses: [],
            advisoryValidationPasses: [],
            atomHealthClaims: [{ atomOrMapId: 'atm.historical-batch-evidence', kind: 'owner', generatedByTask: true, validatorHealthy: true }],
            okToRecordEvidence: true,
            okToCloseTask: true,
            diagnosticOnly: false
        }]
});
const batchLaneDryRun = await runTaskflow([
    'close',
    '--cwd', batchLaneFixture.targetRepo,
    '--profile', batchLaneFixture.profilePath,
    '--task', batchLaneFixture.taskId,
    '--actor', 'validator',
    '--historical-batch', batchId,
    '--json'
]);
assert.equal(batchLaneDryRun.ok, true, 'taskflow close dry-run must accept historical-batch as a close-ready operator source');
assert.equal(batchLaneDryRun.evidence.closeMode, 'normal-close', 'historical-batch close should behave like a normal close once the matched delivery commits satisfy the historical delivery gate');
assert.equal(batchLaneDryRun.evidence.closebackPlan.backendSurface, 'tasks-close', 'historical-batch close should route through tasks-close when the live ledger is still active');
assert.ok(batchLaneDryRun.evidence.writeReadinessHint.blockers.every((entry) => entry.code !== 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED'), 'historical-batch dry-run should clear the historical-delivery gate before write');
assert.equal(batchLaneDryRun.evidence.closebackPlan.historicalDeliveryGate.required, false, 'historical-batch dry-run should clear the historical-delivery gate before write');
assert.deepEqual(batchLaneDryRun.evidence.governedCommitBundle.targetDeliveryFiles, [], 'historical-batch close should reuse matched commits rather than stage fresh deliverables');
const batchLaneClose = await runTaskflow([
    'close',
    '--cwd', batchLaneFixture.targetRepo,
    '--profile', batchLaneFixture.profilePath,
    '--task', batchLaneFixture.taskId,
    '--actor', 'validator',
    '--historical-batch', batchId,
    '--write',
    '--no-commit',
    '--json'
]);
assert.equal(batchLaneClose.ok, true, 'taskflow close must accept historical-batch as a governed close source');
assert.equal(batchLaneClose.evidence.backendResult?.evidence?.historicalBatchSlice?.batchId, batchId, 'backend close evidence must preserve the historical batch slice');
assert.equal(batchLaneClose.evidence.governedCommitBundle.commitMode, 'stage-only', 'historical-batch write with --no-commit must keep the governed bundle in stage-only mode');
assert.equal(batchLaneClose.evidence.governedCommitBundle.targetRepo.status, 'staged');
assert.equal(batchLaneClose.evidence.governedCommitBundle.planningRepo.status, 'staged');
assert.equal(batchLaneClose.evidence.governedCommitBundle.failClosed, false);
assert.ok(batchLaneClose.evidence.governedCommitBundle.targetRepo.stageFiles.includes(`.atm/history/evidence/${batchLaneFixture.taskId}.json`), 'historical-batch close must still stage task evidence in the target bundle');
assert.ok(batchLaneClose.evidence.governedCommitBundle.targetRepo.stageFiles.includes(`.atm/history/evidence/historical-batches/${batchId}.json`), 'historical-batch close must stage the referenced batch envelope in the target bundle');
assert.ok(batchLaneClose.evidence.governedCommitBundle.targetGovernanceFiles.includes(`.atm/history/evidence/historical-batches/${batchId}.json`), 'historical-batch close must report the batch envelope as target governance evidence');
assert.ok(batchLaneClose.evidence.governedCommitBundle.planningRepo.stageFiles.includes(`docs/tasks/${batchLaneFixture.taskId}.task.md`), 'historical-batch close must still stage the planning card closeback bundle');
const batchLanePlanningCard = readFileSync(batchLaneFixture.planPath, 'utf8');
assert.ok(batchLanePlanningCard.includes(`delivery_commit: "${batchLaneFixture.deliveryCommit}"`), 'historical-batch close must still write the matched delivery commit onto the planning card');
const legacyBatchLaneFixture = await makeDualRepoCloseFixture('historical-batch-legacy-scope', { closePlanningStatus: 'planned' });
const legacyBatchTaskPath = path.join(legacyBatchLaneFixture.targetRepo, '.atm/history/tasks', `${legacyBatchLaneFixture.taskId}.json`);
const legacyBatchTaskDocument = JSON.parse(readFileSync(legacyBatchTaskPath, 'utf8'));
delete legacyBatchTaskDocument.deliverables;
legacyBatchTaskDocument.legacyImportAliases = { allowed_files: ['src/deliver.txt'] };
writeJson(legacyBatchTaskPath, legacyBatchTaskDocument);
const legacyBatchId = 'hist-batch-legacy-scope';
writeJson(path.join(legacyBatchLaneFixture.targetRepo, '.atm/history/evidence/historical-batches', `${legacyBatchId}.json`), {
    schemaId: 'atm.historicalBatchEvidence.v1',
    batchId: legacyBatchId,
    taskIds: [legacyBatchLaneFixture.taskId],
    commits: [legacyBatchLaneFixture.deliveryCommit],
    tasks: [{
            taskId: legacyBatchLaneFixture.taskId,
            ok: true,
            matchedCommits: [legacyBatchLaneFixture.deliveryCommit],
            matchedFiles: ['src/deliver.txt'],
            outOfScopeFiles: [],
            declaredDeliverables: ['src/deliver.txt'],
            declaredScopeFiles: ['src/deliver.txt'],
            matchedDeliverables: ['src/deliver.txt'],
            missingCoverage: [],
            coverageStatus: 'complete',
            validatorClaims: [{ gate: 'validate:cli', kind: 'taskSpecific', satisfied: true, requiredForClose: true }],
            taskSpecificValidationPasses: ['validate:cli'],
            batchWideValidationPasses: [],
            advisoryValidationPasses: [],
            atomHealthClaims: [{ atomOrMapId: 'atm.historical-batch-evidence', kind: 'owner', generatedByTask: true, validatorHealthy: true }],
            okToRecordEvidence: true,
            okToCloseTask: true,
            diagnosticOnly: false
        }]
});
const legacyBatchDryRun = await runTaskflow([
    'close',
    '--cwd', legacyBatchLaneFixture.targetRepo,
    '--profile', legacyBatchLaneFixture.profilePath,
    '--task', legacyBatchLaneFixture.taskId,
    '--actor', 'validator',
    '--historical-batch', legacyBatchId,
    '--json'
]);
assert.equal(legacyBatchDryRun.ok, true, 'historical-batch close must accept imported legacy scope-only tasks when every scope entry is file-shaped');
assert.ok(legacyBatchDryRun.evidence.writeReadinessHint.blockers.every((entry) => entry.code !== 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED'), 'legacy scope-only historical-batch close should synthesize a canonical deliverable boundary');
const legacyHistoricalCloseFixture = await makeDualRepoCloseFixture('historical-batch-planned-ledger', { closePlanningStatus: 'planned' });
const legacyHistoricalTaskPath = path.join(legacyHistoricalCloseFixture.targetRepo, '.atm/history/tasks', `${legacyHistoricalCloseFixture.taskId}.json`);
const legacyHistoricalTaskDocument = JSON.parse(readFileSync(legacyHistoricalTaskPath, 'utf8'));
legacyHistoricalTaskDocument.status = 'planned';
delete legacyHistoricalTaskDocument.claim;
writeJson(legacyHistoricalTaskPath, legacyHistoricalTaskDocument);
const legacyHistoricalLockPath = path.join(legacyHistoricalCloseFixture.targetRepo, '.atm/runtime/locks', `${legacyHistoricalCloseFixture.taskId}.lock.json`);
rmSync(legacyHistoricalLockPath, { force: true });
const plannedLedgerBatchId = 'hist-batch-planned-ledger';
writeJson(path.join(legacyHistoricalCloseFixture.targetRepo, '.atm/history/evidence/historical-batches', `${plannedLedgerBatchId}.json`), {
    schemaId: 'atm.historicalBatchEvidence.v1',
    batchId: plannedLedgerBatchId,
    taskIds: [legacyHistoricalCloseFixture.taskId],
    commits: [legacyHistoricalCloseFixture.deliveryCommit],
    tasks: [{
            taskId: legacyHistoricalCloseFixture.taskId,
            ok: true,
            matchedCommits: [legacyHistoricalCloseFixture.deliveryCommit],
            matchedFiles: ['src/deliver.txt'],
            outOfScopeFiles: [],
            declaredDeliverables: ['src/deliver.txt'],
            declaredScopeFiles: ['src/deliver.txt'],
            matchedDeliverables: ['src/deliver.txt'],
            missingCoverage: [],
            coverageStatus: 'complete',
            validatorClaims: [{ gate: 'validate:cli', kind: 'taskSpecific', satisfied: true, requiredForClose: true }],
            taskSpecificValidationPasses: ['validate:cli'],
            batchWideValidationPasses: [],
            advisoryValidationPasses: [],
            atomHealthClaims: [{ atomOrMapId: 'atm.historical-batch-evidence', kind: 'owner', generatedByTask: true, validatorHealthy: true }],
            okToRecordEvidence: true,
            okToCloseTask: true,
            diagnosticOnly: false
        }]
});
const plannedLedgerClose = await runTaskflow([
    'close',
    '--cwd', legacyHistoricalCloseFixture.targetRepo,
    '--profile', legacyHistoricalCloseFixture.profilePath,
    '--task', legacyHistoricalCloseFixture.taskId,
    '--actor', 'validator',
    '--historical-batch', plannedLedgerBatchId,
    '--write',
    '--no-commit',
    '--json'
]);
assert.equal(plannedLedgerClose.ok, true, 'historical-batch close must bridge imported planned tasks without a live claim or direction lock');
assert.equal(plannedLedgerClose.evidence.backendResult?.ok, true, 'backend close must succeed for imported planned tasks under historical closeback');
assert.equal(plannedLedgerClose.evidence.governedCommitBundle.failClosed, false, 'historical planned closeback must not fail closed after lifecycle bridging');
const historicalResidualFixture = await makeDualRepoCloseFixture('historical-batch-residual-scope', { closePlanningStatus: 'planned' });
const historicalResidualTaskPath = path.join(historicalResidualFixture.targetRepo, '.atm/history/tasks', `${historicalResidualFixture.taskId}.json`);
const historicalResidualTaskDocument = JSON.parse(readFileSync(historicalResidualTaskPath, 'utf8'));
historicalResidualTaskDocument.scopePaths = ['src/deliver.txt', 'docs/governance/atm-bug-and-optimization-backlog.md'];
historicalResidualTaskDocument.targetAllowedFiles = ['src/deliver.txt', 'docs/governance/atm-bug-and-optimization-backlog.md'];
historicalResidualTaskDocument.deliverables = ['src/deliver.txt'];
writeJson(historicalResidualTaskPath, historicalResidualTaskDocument);
writeText(path.join(historicalResidualFixture.targetRepo, 'docs/governance/atm-bug-and-optimization-backlog.md'), 'later unrelated residue\n');
const residualBatchId = 'hist-batch-residual-scope';
writeJson(path.join(historicalResidualFixture.targetRepo, '.atm/history/evidence/historical-batches', `${residualBatchId}.json`), {
    schemaId: 'atm.historicalBatchEvidence.v1',
    batchId: residualBatchId,
    taskIds: [historicalResidualFixture.taskId],
    commits: [historicalResidualFixture.deliveryCommit],
    tasks: [{
            taskId: historicalResidualFixture.taskId,
            ok: true,
            matchedCommits: [historicalResidualFixture.deliveryCommit],
            matchedFiles: ['src/deliver.txt'],
            outOfScopeFiles: [],
            declaredDeliverables: ['src/deliver.txt'],
            declaredScopeFiles: ['src/deliver.txt', 'docs/governance/atm-bug-and-optimization-backlog.md'],
            matchedDeliverables: ['src/deliver.txt'],
            missingCoverage: [],
            coverageStatus: 'complete',
            validatorClaims: [{ gate: 'validate:cli', kind: 'taskSpecific', satisfied: true, requiredForClose: true }],
            taskSpecificValidationPasses: ['validate:cli'],
            batchWideValidationPasses: [],
            advisoryValidationPasses: [],
            atomHealthClaims: [{ atomOrMapId: 'atm.historical-batch-evidence', kind: 'owner', generatedByTask: true, validatorHealthy: true }],
            okToRecordEvidence: true,
            okToCloseTask: true,
            diagnosticOnly: false
        }]
});
const residualDryRun = await runTaskflow([
    'close',
    '--cwd', historicalResidualFixture.targetRepo,
    '--profile', historicalResidualFixture.profilePath,
    '--task', historicalResidualFixture.taskId,
    '--actor', 'validator',
    '--historical-batch', residualBatchId,
    '--json'
]);
assert.equal(residualDryRun.ok, true, 'historical-batch close must tolerate later in-scope residue outside declared historical deliverables');
assert.equal(residualDryRun.evidence.governedCommitBundle.failClosed, false, 'historical residual in-scope files should downgrade to advisory residue instead of fail-closed metadata');
const stageOnlyFixture = await makeDualRepoCloseFixture('stageonly');
const stageOnlyTargetHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim();
const stageOnlyPlanningHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim();
const stageOnly = await runTaskflow([
    'close',
    '--cwd', stageOnlyFixture.targetRepo,
    '--profile', stageOnlyFixture.profilePath,
    '--task', stageOnlyFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', stageOnlyFixture.deliveryCommit,
    '--write',
    '--no-commit',
    '--json'
]);
assert.equal(stageOnly.evidence.governedCommitBundle.commitMode, 'stage-only');
assert.equal(stageOnly.evidence.governedCommitBundle.targetRepo.status, 'staged');
assert.equal(stageOnly.evidence.governedCommitBundle.planningRepo.status, 'staged');
assert.equal(stageOnly.evidence.governedCommitBundle.failClosed, false);
assert.equal(stageOnly.evidence.governedCommitBundle.targetRepo.indexIsolation.verified, true, 'stage-only target index isolation must be verified');
assert.equal(stageOnly.evidence.governedCommitBundle.planningRepo.indexIsolation.verified, true, 'stage-only planning index isolation must be verified');
assert.ok(stageOnly.evidence.governedCommitBundle.targetRepo.indexIsolation.expectedStageFiles.includes(`.atm/history/evidence/${stageOnlyFixture.taskId}.json`), 'target index diagnostics must include expected bundle files');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim(), stageOnlyTargetHead, '--no-commit must not commit target repo');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim(), stageOnlyPlanningHead, '--no-commit must not commit planning repo');
const stageOnlyTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: stageOnlyFixture.targetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const stageOnlyPlanningStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: stageOnlyFixture.planningRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(stageOnlyTargetStaged.includes(`.atm/history/tasks/${stageOnlyFixture.taskId}.json`), 'stage-only target bundle must stage task json');
assert.ok(stageOnlyTargetStaged.some((entry) => entry.startsWith(`.atm/history/task-events/${stageOnlyFixture.taskId}/`) && entry.includes('-close-')), 'stage-only target bundle must stage close event');
assert.ok(!stageOnlyTargetStaged.includes('scratch.txt'), 'stage-only target bundle must not stage unrelated dirty files');
const stageOnlyPlanningCard = readFileSync(path.join(stageOnlyFixture.planningRepo, `docs/tasks/${stageOnlyFixture.taskId}.task.md`), 'utf8');
const stageOnlyPlanningTransitionId = /lastTransitionId:\s*"([^"]+)"/.exec(stageOnlyPlanningCard)?.[1];
assert.ok(stageOnlyPlanningTransitionId, 'stage-only planning closeback must stamp a planning transition id');
assert.deepEqual(stageOnlyPlanningStaged, [`.atm/history/task-events/${stageOnlyFixture.taskId}/${stageOnlyPlanningTransitionId}.json`, 'docs/tasks/README.md', `docs/tasks/${stageOnlyFixture.taskId}.task.md`], 'stage-only planning bundle must exact-stage the planning card, roster, and planning transition event');
assert.ok(readFileSync(path.join(stageOnlyFixture.planningRepo, 'docs/tasks/README.md'), 'utf8').includes('| done |'), 'profile-only taskflow close must update the planning roster from the planning repo');
const targetIndexContaminationFixture = await makeDualRepoCloseFixture('target-index-contamination');
writeText(path.join(targetIndexContaminationFixture.targetRepo, 'pre-staged-target.txt'), 'must not commit\n');
execFileSync('git', ['add', 'pre-staged-target.txt'], { cwd: targetIndexContaminationFixture.targetRepo, stdio: 'ignore' });
const targetIndexContamination = await runTaskflow([
    'close',
    '--cwd', targetIndexContaminationFixture.targetRepo,
    '--profile', targetIndexContaminationFixture.profilePath,
    '--task', targetIndexContaminationFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', targetIndexContaminationFixture.deliveryCommit,
    '--write',
    '--json'
]);
assert.equal(targetIndexContamination.ok, true, 'target repo unrelated pre-staged files must now be preserved during auto-commit');
assert.equal(targetIndexContamination.evidence.closeWriteTransaction.phase, 'committed');
assert.ok(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: targetIndexContaminationFixture.targetRepo, encoding: 'utf8' }).includes('pre-staged-target.txt'), 'foreign target staged work must remain staged');
const planningIndexContaminationFixture = await makeDualRepoCloseFixture('planning-index-contamination');
writeText(path.join(planningIndexContaminationFixture.planningRepo, 'docs/tasks/pre-staged-planning.md'), 'must not commit\n');
execFileSync('git', ['add', 'docs/tasks/pre-staged-planning.md'], { cwd: planningIndexContaminationFixture.planningRepo, stdio: 'ignore' });
const planningIndexContamination = await runTaskflow([
    'close',
    '--cwd', planningIndexContaminationFixture.targetRepo,
    '--profile', planningIndexContaminationFixture.profilePath,
    '--task', planningIndexContaminationFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', planningIndexContaminationFixture.deliveryCommit,
    '--write',
    '--json'
]);
assert.equal(planningIndexContamination.ok, true, 'planning repo unrelated pre-staged files must now be preserved during auto-commit');
assert.equal(planningIndexContamination.evidence.closeWriteTransaction.phase, 'committed');
assert.ok(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: planningIndexContaminationFixture.planningRepo, encoding: 'utf8' }).includes('docs/tasks/pre-staged-planning.md'), 'foreign planning staged work must remain staged');
const expectedPreStagedFixture = await makeDualRepoCloseFixture('expected-pre-staged');
execFileSync('git', ['add', `.atm/history/evidence/${expectedPreStagedFixture.taskId}.json`], { cwd: expectedPreStagedFixture.targetRepo, stdio: 'ignore' });
execFileSync('git', ['add', `docs/tasks/${expectedPreStagedFixture.taskId}.task.md`], { cwd: expectedPreStagedFixture.planningRepo, stdio: 'ignore' });
const expectedPreStaged = await runTaskflow([
    'close',
    '--cwd', expectedPreStagedFixture.targetRepo,
    '--profile', expectedPreStagedFixture.profilePath,
    '--task', expectedPreStagedFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', expectedPreStagedFixture.deliveryCommit,
    '--write',
    '--no-commit',
    '--json'
]);
assert.equal(expectedPreStaged.evidence.governedCommitBundle.failClosed, false, 'expected pre-staged bundle files must not fail isolation');
assert.equal(expectedPreStaged.evidence.governedCommitBundle.targetRepo.indexIsolation.verified, true);
assert.equal(expectedPreStaged.evidence.governedCommitBundle.planningRepo.indexIsolation.verified, true);
assert.ok(expectedPreStaged.evidence.governedCommitBundle.targetRepo.indexIsolation.preStagedFiles.includes(`.atm/history/evidence/${expectedPreStagedFixture.taskId}.json`), 'target diagnostics must preserve expected pre-staged bundle file');
assert.ok(expectedPreStaged.evidence.governedCommitBundle.planningRepo.indexIsolation.preStagedFiles.includes(`docs/tasks/${expectedPreStagedFixture.taskId}.task.md`), 'planning diagnostics must preserve expected pre-staged bundle file');
const autoCommitFixture = await makeDualRepoCloseFixture('autocommit');
const autoCommit = await runTaskflow([
    'close',
    '--cwd', autoCommitFixture.targetRepo,
    '--task', autoCommitFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', autoCommitFixture.deliveryCommit,
    '--write',
    '--json'
]);
assert.equal(autoCommit.ok, true);
assert.equal(autoCommit.evidence.closeWriteTransaction.phase, 'committed');
assert.equal(autoCommit.evidence.closeWriteTransaction.ok, true);
assert.equal(autoCommit.evidence.closeWriteTransaction.commitBundleApplied, true);
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoCommitFixture.targetRepo, encoding: 'utf8' }).trim(), `chore(taskflow): close ${autoCommitFixture.taskId} target governance bundle`);
assert.equal(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoCommitFixture.planningRepo, encoding: 'utf8' }).trim(), `docs(taskflow): close ${autoCommitFixture.taskId} planning bundle`);
const missingPlanningFixture = await makeDualRepoCloseFixture('missingplan');
const missingTaskPath = path.join(missingPlanningFixture.targetRepo, '.atm/history/tasks', `${missingPlanningFixture.taskId}.json`);
const missingTask = JSON.parse(readFileSync(missingTaskPath, 'utf8'));
missingTask.source.planPath = path.join(missingPlanningFixture.planningRepo, 'docs/tasks/DOES-NOT-EXIST.task.md');
writeJson(missingTaskPath, missingTask);
await assert.rejects(() => runTaskflow([
    'close',
    '--cwd', missingPlanningFixture.targetRepo,
    '--task', missingPlanningFixture.taskId,
    '--actor', 'validator',
    '--historical-delivery', missingPlanningFixture.deliveryCommit,
    '--write',
    '--json'
]), (err) => err.code === 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING');
console.log('[taskflow-dryrun:dual-repo-close] ok');
