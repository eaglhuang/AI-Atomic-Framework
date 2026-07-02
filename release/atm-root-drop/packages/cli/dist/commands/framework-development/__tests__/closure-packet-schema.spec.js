import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditTasks, validateClosurePacket } from '../closure-packet-schema.js';
const digest = `sha256:${'a'.repeat(64)}`;
function validPacket(overrides = {}) {
    return {
        schemaId: 'atm.closurePacket.v1',
        specVersion: '0.1.0',
        taskId: 'TASK-RFT-0003',
        targetRepoIdentity: {
            isFrameworkRepo: true,
            score: 5,
            root: '/repo',
            name: 'ai-atomic-framework',
            signals: ['package-name:ai-atomic-framework']
        },
        targetCommit: 'abc123',
        governedTreeSha: 'tree123',
        targetCommitDelta: {
            currentCommitSha: 'abc123',
            parentCommitShas: ['parent123'],
            governedTreeSha: 'tree123',
            changedFiles: ['packages/cli/src/commands/framework-development.ts']
        },
        closedByCommand: 'atm tasks close',
        commandRuns: [{
                command: 'npm run typecheck',
                cwd: '.',
                exitCode: 0,
                stdoutSha256: digest,
                stderrSha256: digest,
                runnerVersion: 'test'
            }],
        validationPasses: ['typecheck', 'validate:cli'],
        evidenceFreshness: 'fresh',
        requiredGates: ['typecheck', 'validate:cli'],
        requiredGatesSnapshot: {
            schemaId: 'atm.requiredGatesSnapshot.v1',
            generatedAt: '2026-06-14T00:00:00.000Z',
            source: 'frameworkStatus.requiredGates',
            ruleVersion: '0.1.0',
            frameworkMode: 'required',
            repoRole: 'framework',
            changedFiles: ['packages/cli/src/commands/framework-development.ts'],
            criticalChangedFiles: ['packages/cli/src/commands/framework-development.ts'],
            requiredGates: ['typecheck', 'validate:cli']
        },
        evidencePath: '.atm/history/evidence/TASK-RFT-0003.json',
        closedAt: '2026-06-14T00:00:00.000Z',
        closedByActor: 'captain-teamagents',
        sessionId: null,
        attestation: null,
        repair: null,
        historicalDeliveryProvenance: null,
        ...overrides
    };
}
assert.equal(validateClosurePacket(validPacket()).ok, true);
const missingTargetCommitDelta = validateClosurePacket({
    ...validPacket(),
    targetCommitDelta: undefined
});
assert.equal(missingTargetCommitDelta.ok, false);
assert.ok(missingTargetCommitDelta.missing.includes('targetCommitDelta'));
const shaMismatch = validateClosurePacket({
    ...validPacket(),
    commandRuns: [{
            ...validPacket().commandRuns[0],
            stdoutSha256: 'sha256:not-valid'
        }]
});
assert.equal(shaMismatch.ok, false);
assert.equal(shaMismatch.invalidFormat[0]?.path, 'commandRuns/0/stdoutSha256');
const repairRoundTrip = validateClosurePacket(validPacket({
    repair: {
        schemaId: 'atm.closurePacketRepair.v1',
        repairedAt: '2026-06-14T00:00:00.000Z',
        repairedByCommand: 'atm tasks repair-closure',
        originalPacketCommitSha: 'old',
        repairedTargetCommitSha: 'new',
        evidencePath: '.atm/history/evidence/git-head.jsonl'
    }
}));
assert.equal(repairRoundTrip.ok, true);
const auditRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-audit-'));
try {
    writeFileSync(path.join(auditRoot, 'package.json'), JSON.stringify({
        name: 'ai-atomic-framework',
        workspaces: ['packages/*']
    }, null, 2));
    mkdirSync(path.join(auditRoot, 'packages', 'core', 'src'), { recursive: true });
    mkdirSync(path.join(auditRoot, 'packages', 'cli', 'src'), { recursive: true });
    writeFileSync(path.join(auditRoot, 'packages', 'core', 'src', 'index.ts'), 'export {};\n');
    writeFileSync(path.join(auditRoot, 'packages', 'cli', 'src', 'atm.ts'), 'export {};\n');
    writeFileSync(path.join(auditRoot, 'atomic-registry.json'), '{}\n');
    mkdirSync(path.join(auditRoot, 'docs', 'governance'), { recursive: true });
    writeFileSync(path.join(auditRoot, 'docs', 'governance', 'atm-bug-and-optimization-backlog.md'), '# ATM Bug and Optimization Backlog\n\n'
        + 'status: **all completed**\n\n'
        + '| ID | Evidence |\n| --- | --- |\n'
        + '| ATM-BUG-TEST | Reproduced with `node atm.mjs next --claim --prompt "[SKL batch execution prompt omitted for audit safety]" --json`. |\n');
    writeFileSync(path.join(auditRoot, 'docs', 'closeout-report.md'), '# Closeout\n\nstatus: **all completed**\n');
    writeFileSync(path.join(auditRoot, 'docs', 'governance', 'completion-report.md'), '# Governance Notes\n\nstatus: **all completed**\n');
    mkdirSync(path.join(auditRoot, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(auditRoot, '.atm', 'history', 'tasks', 'TASK-STALE-0001.json'), JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-STALE-0001',
        title: 'stale claim fixture',
        status: 'running',
        claim: {
            actorId: 'vanished-agent',
            leaseId: 'lease-deadbeef0000',
            claimedAt: '2026-01-01T00:00:00.000Z',
            heartbeatAt: '2026-01-01T00:00:00.000Z',
            ttlSeconds: 1800,
            files: ['packages/cli/src/atm.ts'],
            state: 'active'
        }
    }, null, 2));
    const audit = auditTasks(auditRoot);
    const staleClaimFindings = audit.findings.filter((entry) => entry.code === 'ATM_TASK_AUDIT_STALE_CLAIM');
    assert.equal(staleClaimFindings.length, 1);
    assert.equal(staleClaimFindings[0]?.taskId, 'TASK-STALE-0001');
    assert.equal(staleClaimFindings[0]?.level, 'warning');
    assert.ok(staleClaimFindings[0]?.detail.includes('repair-claim'));
    const completionFindings = audit.findings.filter((entry) => entry.code === 'ATM_TASK_AUDIT_COMPLETION_REPORT_UNVERIFIED');
    assert.deepEqual(completionFindings.map((entry) => entry.path), ['docs/closeout-report.md', 'docs/governance/completion-report.md']);
}
finally {
    rmSync(auditRoot, { recursive: true, force: true });
}
console.log('[framework-development-closure-packet-schema:test] ok');
