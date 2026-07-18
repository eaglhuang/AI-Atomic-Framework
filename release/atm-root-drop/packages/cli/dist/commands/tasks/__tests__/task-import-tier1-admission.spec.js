import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksImport } from '../import-orchestrator.js';
import { classifyForceImportAdmission } from '../import-validation.js';
import { CliError } from '../../shared.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writePlan(root, taskId, title) {
    const planPath = path.join(root, 'docs/tasks', `${taskId}.task.md`);
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(planPath, [
        '---',
        `task_id: ${taskId}`,
        `title: ${title}`,
        'status: planned',
        'planning_repo: governance-workbench',
        'target_repo: AI-Atomic-Framework',
        'closure_authority: target_repo',
        'scopePaths:',
        '  - src/import.ts',
        'deliverables:',
        '  - src/import.ts',
        'validators:',
        '  - npm run typecheck',
        'evidence:',
        '  required: command-backed',
        'rollback:',
        '  strategy: revert-commit',
        '---',
        '',
        `# ${taskId}`,
        '',
        '## Acceptance Criteria',
        '',
        '- Import can refresh planned ledger.',
        ''
    ].join('\n'), 'utf8');
    return planPath;
}
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-import-tier1-'));
try {
    writeJson(path.join(root, '.atm/config.json'), {
        schemaVersion: 'atm.config.v0.1',
        taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
    });
    writeFileSync(path.join(root, 'foreign-release-artifact.txt'), 'foreign dirty release work\n', 'utf8');
    const taskId = 'ATM-GOV-9157';
    const planPath = writePlan(root, taskId, 'Ledger import tier1 fixture');
    writeJson(path.join(root, '.atm/history/tasks', `${taskId}.json`), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: 'Old planned import',
        status: 'planned',
        source: { planPath: 'docs/tasks/ATM-GOV-9157.task.md', hash: 'old-hash' },
        importedAt: '2026-07-17T00:00:00.000Z'
    });
    const result = await runTasksImport(['--cwd', root, '--from', planPath, '--write', '--force', '--json']);
    assert.equal(result.ok, true, 'force refresh of open task ledger must succeed without emergency approval');
    const taskPath = path.join(root, '.atm/history/tasks', `${taskId}.json`);
    assert.equal(existsSync(taskPath), true, 'task ledger must still exist after force refresh');
    const closedDecision = classifyForceImportAdmission({
        cwd: root,
        force: true,
        tasks: [{
                schemaVersion: 'atm.workItem.v0.2',
                workItemId: 'ATM-GOV-9158',
                title: 'Closed fixture',
                status: 'planned',
                milestone: null,
                dependencies: [],
                acceptance: [],
                deliverables: [],
                scopePaths: [],
                validators: [],
                planningReadOnlyPaths: [],
                planningMirrorPaths: [],
                outOfScope: [],
                nonGoals: [],
                legacyImportAliases: {},
                importDiagnostics: [],
                tags: [],
                notes: null,
                source: { planPath: 'docs/tasks/ATM-GOV-9158.task.md', sectionTitle: 'ATM-GOV-9158', headingLine: 1, hash: 'new-hash' },
                importedAt: '2026-07-17T00:00:00.000Z'
            }]
    });
    assert.equal(closedDecision.emergencyRequired, false, 'nonexistent ledger force remains tier1');
    writeJson(path.join(root, '.atm/history/tasks/ATM-GOV-9158.json'), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'ATM-GOV-9158',
        status: 'done',
        source: { planPath: 'docs/tasks/ATM-GOV-9158.task.md', hash: 'old-hash' }
    });
    const closedBlocked = classifyForceImportAdmission({
        cwd: root,
        force: true,
        tasks: [{
                schemaVersion: 'atm.workItem.v0.2',
                workItemId: 'ATM-GOV-9158',
                title: 'Closed fixture',
                status: 'planned',
                milestone: null,
                dependencies: [],
                acceptance: [],
                deliverables: [],
                scopePaths: [],
                validators: [],
                planningReadOnlyPaths: [],
                planningMirrorPaths: [],
                outOfScope: [],
                nonGoals: [],
                legacyImportAliases: {},
                importDiagnostics: [],
                tags: [],
                notes: null,
                source: { planPath: 'docs/tasks/ATM-GOV-9158.task.md', sectionTitle: 'ATM-GOV-9158', headingLine: 1, hash: 'new-hash' },
                importedAt: '2026-07-17T00:00:00.000Z'
            }]
    });
    assert.equal(closedBlocked.emergencyRequired, true, 'closed target history overwrite must remain emergency-gated');
    assert.equal(closedBlocked.admissionClass, 'closed-history-overwrite');
    writeJson(path.join(root, '.atm/history/tasks/ATM-GOV-9159.json'), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'ATM-GOV-9159',
        status: 'running',
        claim: { actorId: 'foreign-lane', state: 'active' },
        source: { planPath: 'docs/tasks/ATM-GOV-9159.task.md', hash: 'old-hash' }
    });
    const activeClaimPlan = writePlan(root, 'ATM-GOV-9159', 'Active claim fixture');
    await assert.rejects(() => runTasksImport(['--cwd', root, '--from', activeClaimPlan, '--write', '--force', '--json']), (error) => error instanceof CliError && error.code === 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED', 'same-task active claim force import must still require protected approval');
}
finally {
    rmSync(root, { recursive: true, force: true });
}
console.log('[task-import-tier1-admission.spec] ok');
