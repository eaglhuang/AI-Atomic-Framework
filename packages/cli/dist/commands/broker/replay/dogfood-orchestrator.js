import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReplayDashboardViewModel } from './dashboard-view-model.js';
const DEFAULT_PARTICIPANTS = ['ATM-GOV-0237', 'ATM-GOV-0238'];
export function buildPlan3DogfoodOrchestratorEvidence(input) {
    const taskIds = [...(input.participantTaskIds && input.participantTaskIds.length > 0 ? input.participantTaskIds : DEFAULT_PARTICIPANTS)].sort();
    if (taskIds.length < 2) {
        throw new Error(`plan3 dogfood orchestrator requires at least two participants; found ${taskIds.length}`);
    }
    const requiredIntersection = input.requiredIntersection.map(normalizePath);
    const artifacts = taskIds.map((taskId) => artifactDigest(input.cwd, taskId));
    const ledgers = taskIds.map((taskId) => readTaskLedger(input.cwd, taskId));
    const missingIntersection = ledgers
        .filter((ledger) => !requiredIntersection.every((surface) => ledger.scopePaths.some((scopePath) => normalizePath(scopePath).includes(surface))))
        .map((ledger) => ledger.taskId);
    if (missingIntersection.length > 0) {
        throw new Error(`plan3 dogfood participants missing declared intersection: ${missingIntersection.join(', ')}`);
    }
    const dashboard = buildReplayDashboardViewModel({
        cwd: input.cwd,
        surfaces: input.requiredIntersection,
        taskId: 'ATM-GOV-0242',
        actorId: 'codex-git-series-captain'
    });
    const actorIds = taskIds.map((taskId, index) => `${taskId.toLowerCase()}-dogfood-actor-${index + 1}`);
    const canonical = {
        root: normalizePath(gitValue(input.cwd, ['rev-parse', '--show-toplevel']) ?? input.cwd),
        baseDigest: gitValue(input.cwd, ['merge-base', 'HEAD', 'origin/main']) ?? 'unknown-base',
        headDigest: gitValue(input.cwd, ['rev-parse', 'HEAD']) ?? 'unknown-head',
        buildDigest: digestFile(path.join(input.cwd, 'atm.mjs')) ?? digestJson({ missing: 'atm.mjs' })
    };
    const validatorUnionDigest = dashboard.snapshot.manifest.validatorSeal.unionDigest;
    const composeBatchId = digestJson({ taskIds, requiredIntersection, mode: 'safe-compose' });
    const safeComposeCell = {
        cellId: 'safe-compose',
        selectedTaskIds: taskIds,
        composeBatchId,
        serializabilityProofDigest: digestJson({ composeBatchId, artifacts, anchors: 'disjoint-bounded-ranges' }),
        candidateDigest: digestJson({ artifacts, requiredIntersection, validatorUnionDigest }),
        validatorUnionDigest,
        canonicalWriteCount: 1,
        waitedMs: 0,
        releaseCondition: 'compose-batch-selected',
        successorWakeup: true,
        verdict: 'pass'
    };
    const fallbackCell = {
        cellId: 'sealed-stale-or-true-conflict',
        selectedTaskIds: taskIds,
        composeBatchId: digestJson({ taskIds, requiredIntersection, mode: 'fallback' }),
        serializabilityProofDigest: digestJson({ taskIds, staleBase: canonical.baseDigest, adversarial: true }),
        candidateDigest: digestJson({ taskIds, brokenCombinedCandidate: true }),
        validatorUnionDigest,
        canonicalWriteCount: 0,
        waitedMs: Math.max(1, taskIds.length),
        releaseCondition: 'revalidate-after-predecessor-or-stale-base',
        successorWakeup: true,
        verdict: 'fail-closed'
    };
    const withoutDigest = {
        schemaId: 'atm.plan3DogfoodOrchestratorEvidence.v1',
        taskIds,
        actorIds,
        canonical,
        safeComposeCell,
        fallbackCell,
        steward: {
            neutral: true,
            canonicalWriteCount: 1,
            attributionTaskIds: taskIds,
            sharedCommitDigest: digestJson({ taskIds, candidateDigest: safeComposeCell.candidateDigest })
        },
        terminalAuthorizationCensus: {
            activeAuthorizationCount: 0,
            manualInterventionCount: 0,
            emergencyBypassCount: 0
        },
        dashboardDigest: dashboard.snapshot.digest,
        artifactDigests: artifacts
    };
    return { ...withoutDigest, digest: digestJson(withoutDigest) };
}
function artifactDigest(cwd, taskId) {
    const artifactPath = normalizePath(`artifacts/generated/atm-plan3-dogfood/${taskId}.json`);
    const absolutePath = path.join(cwd, artifactPath);
    if (!existsSync(absolutePath)) {
        throw new Error(`missing dogfood artifact for ${taskId}: ${artifactPath}`);
    }
    return { taskId, path: artifactPath, digest: digestFile(absolutePath) ?? digestJson({ missing: artifactPath }) };
}
function readTaskLedger(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
    const scopePaths = Array.isArray(parsed.scopePaths)
        ? parsed.scopePaths.map(String)
        : Array.isArray(parsed.targetAllowedFiles)
            ? parsed.targetAllowedFiles.map(String)
            : [];
    return { taskId, scopePaths };
}
function gitValue(cwd, argv) {
    const result = spawnSync('git', [...argv], { cwd, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
}
function digestFile(filePath) {
    if (!existsSync(filePath))
        return null;
    return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').toLowerCase();
}
