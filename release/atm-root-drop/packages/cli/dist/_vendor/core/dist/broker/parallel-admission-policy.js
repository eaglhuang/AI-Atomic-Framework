// @ts-nocheck
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export const parallelAdmissionPolicySchemaId = 'atm.parallelAdmissionPolicy.v1';
export const parallelAdmissionPolicySpecVersion = '0.1.0';
export function defaultParallelAdmissionPolicy() {
    const base = {
        schemaId: parallelAdmissionPolicySchemaId,
        specVersion: parallelAdmissionPolicySpecVersion,
        mode: 'enforce',
        circuitBreakerEnabled: true,
        fallbackMode: 'queue-only',
        rolloutScope: [
            'runner-sync',
            'build',
            'release-mirror',
            'projection',
            'generated-write',
            'checkpoint',
            'closeback',
            'git-commit'
        ],
        tripped: false,
        trippedAt: null,
        trippedBy: null,
        tripReason: null,
        resetEvidenceDigest: null,
        resetAt: null,
        gatePolicies: defaultGatePolicies()
    };
    return { ...base, configDigest: digestPolicyConfig(base) };
}
export function defaultGatePolicies() {
    return [
        {
            gateId: 'R1_SAME_TASK_SECOND_LANE',
            gateClass: 'hard-exception',
            owner: 'task-lifecycle',
            adapter: 'claim-admission',
            statusCommand: 'node atm.mjs tasks status --task <task-id> --json',
            nextAction: 'Reject same-task second-lane writes unless explicit adoption/handoff succeeds.',
            recoveryCommand: 'node atm.mjs tasks release --task <task-id> --actor <actor-id> --reason "<handoff reason>" --json',
            canPolicyRelax: false
        },
        {
            gateId: 'R2_DEPENDENCY_GATE',
            gateClass: 'hard-exception',
            owner: 'task-dependency',
            adapter: 'next-claim-readiness',
            statusCommand: 'node atm.mjs tasks status --task <dependency-id> --json',
            nextAction: 'Wait for dependency closeback or choose another independent task.',
            recoveryCommand: 'node atm.mjs next --prompt "<dependency completion or independent task prompt>" --json',
            canPolicyRelax: false
        },
        {
            gateId: 'R3_SHARED_WRITE_SURFACE',
            gateClass: 'ticketed-shared-write',
            owner: 'broker',
            adapter: 'shared-surface-queue',
            statusCommand: 'node atm.mjs broker parallel-admission status --json',
            nextAction: 'Route shared write through a canonical broker ticket and queue-only fallback.',
            recoveryCommand: 'node atm.mjs broker parallel-admission trip --actor <actor-id> --reason "<gate failure>" --json',
            canPolicyRelax: true
        },
        {
            gateId: 'R4_SHARED_SIDE_EFFECT',
            gateClass: 'ticketed-shared-write',
            owner: 'broker',
            adapter: 'side-effect-steward',
            statusCommand: 'node atm.mjs broker parallel-admission status --json',
            nextAction: 'Serialize side effects through canonical ticket/status/recovery evidence.',
            recoveryCommand: 'node atm.mjs broker parallel-admission reset --actor <actor-id> --receipt-digest <sha256> --json',
            canPolicyRelax: true
        }
    ];
}
export function parallelAdmissionPolicyPath(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'parallel-admission-policy.json');
}
export function readParallelAdmissionPolicy(cwd) {
    const policyPath = parallelAdmissionPolicyPath(cwd);
    if (!existsSync(policyPath))
        return defaultParallelAdmissionPolicy();
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
    return normalizeParallelAdmissionPolicy(parsed);
}
export function writeParallelAdmissionPolicy(cwd, policy) {
    const policyPath = parallelAdmissionPolicyPath(cwd);
    mkdirSync(path.dirname(policyPath), { recursive: true });
    const normalized = normalizeParallelAdmissionPolicy(policy);
    writeFileSync(policyPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}
export function updateParallelAdmissionPolicy(cwd, patch) {
    const current = readParallelAdmissionPolicy(cwd);
    return writeParallelAdmissionPolicy(cwd, {
        ...current,
        ...patch,
        configDigest: digestPolicyConfig({ ...current, ...patch })
    });
}
export function tripParallelAdmissionPolicy(cwd, input) {
    const current = readParallelAdmissionPolicy(cwd);
    return writeParallelAdmissionPolicy(cwd, {
        ...current,
        tripped: true,
        trippedAt: new Date().toISOString(),
        trippedBy: input.actorId,
        tripReason: input.reason,
        fallbackMode: 'queue-only',
        configDigest: digestPolicyConfig({ ...current, tripped: true, fallbackMode: 'queue-only' })
    });
}
export function resetParallelAdmissionPolicy(cwd, input) {
    const current = readParallelAdmissionPolicy(cwd);
    return writeParallelAdmissionPolicy(cwd, {
        ...current,
        tripped: false,
        tripReason: null,
        resetAt: new Date().toISOString(),
        trippedBy: input.actorId,
        resetEvidenceDigest: input.receiptDigest,
        configDigest: digestPolicyConfig({ ...current, tripped: false, resetEvidenceDigest: input.receiptDigest })
    });
}
export function evaluateParallelAdmissionSafety(metrics) {
    const blockers = parallelAdmissionSafetyBlockers(metrics);
    return {
        schemaId: 'atm.parallelAdmissionSafetyDecision.v1',
        verdict: blockers.length ? 'trip' : 'pass',
        fallbackMode: blockers.length ? 'queue-only' : 'queue-only',
        evidenceDigest: digestSafetyMetrics(metrics),
        blockers,
        resetEligible: blockers.length === 0 && metrics.taskSummary.sealedDigest.startsWith('sha256:')
    };
}
export function applyParallelAdmissionSafetyDecision(policy, input) {
    const decision = evaluateParallelAdmissionSafety(input.metrics);
    if (decision.verdict === 'trip') {
        return normalizeParallelAdmissionPolicy({
            ...policy,
            tripped: true,
            trippedAt: input.now ?? new Date().toISOString(),
            trippedBy: input.actorId,
            tripReason: decision.blockers.join('; '),
            fallbackMode: decision.fallbackMode
        });
    }
    return normalizeParallelAdmissionPolicy({
        ...policy,
        tripped: false,
        tripReason: null,
        resetAt: input.now ?? new Date().toISOString(),
        trippedBy: input.actorId,
        resetEvidenceDigest: decision.evidenceDigest
    });
}
function parallelAdmissionSafetyBlockers(metrics) {
    const blockers = [];
    if (metrics.cellCount !== metrics.requiredCellCount)
        blockers.push(`cell coverage ${metrics.cellCount}/${metrics.requiredCellCount}`);
    if (metrics.requiredCellCount < 420)
        blockers.push('required cell matrix is below 420');
    if (metrics.medianMakespanImprovementPct < 25)
        blockers.push('median makespan improvement below 25%');
    if (metrics.activeThroughputImprovementPct < 25)
        blockers.push('active throughput improvement below 25%');
    if (metrics.productionCostRatio > 1.10)
        blockers.push('production cost ratio above 1.10');
    if (metrics.coveragePct !== 100)
        blockers.push('coverage below 100%');
    if (metrics.sideEffectCounts.silentOverwrite !== 0)
        blockers.push('silent overwrite detected');
    if (metrics.sideEffectCounts.escapedConflict !== 0)
        blockers.push('escaped conflict detected');
    if (metrics.sideEffectCounts.duplicateSideEffect !== 0)
        blockers.push('duplicate side effect detected');
    if (metrics.sideEffectCounts.unresolvedStarvation !== 0)
        blockers.push('unresolved starvation detected');
    if (!metrics.taskSummary.window)
        blockers.push('task summary window missing');
    if (!metrics.taskSummary.watermark)
        blockers.push('task summary watermark missing');
    if (!metrics.taskSummary.sealedDigest.startsWith('sha256:'))
        blockers.push('task summary sealed digest missing');
    return blockers;
}
export function buildParallelAdmissionReceipt(input) {
    return {
        schemaId: 'atm.parallelAdmissionPolicyReceipt.v1',
        action: input.action,
        actorId: input.actorId,
        createdAt: new Date().toISOString(),
        policyPath: '.atm/runtime/parallel-admission-policy.json',
        policy: input.policy,
        rollbackCommand: 'node atm.mjs broker parallel-admission set --mode enforce --fallback-mode queue-only --json'
    };
}
export function resolveGatePolicy(gateId, policy = defaultParallelAdmissionPolicy()) {
    return policy.gatePolicies.find((gate) => gate.gateId === gateId) ?? null;
}
function normalizeParallelAdmissionPolicy(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const candidate = {
        ...defaultParallelAdmissionPolicy(),
        ...record,
        mode: record.mode === 'observe' ? 'observe' : 'enforce',
        circuitBreakerEnabled: record.circuitBreakerEnabled !== false,
        fallbackMode: record.fallbackMode === 'fail-closed' ? 'fail-closed' : 'queue-only',
        rolloutScope: Array.isArray(record.rolloutScope) ? record.rolloutScope.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : defaultParallelAdmissionPolicy().rolloutScope,
        gatePolicies: defaultGatePolicies()
    };
    return { ...candidate, configDigest: digestPolicyConfig(candidate) };
}
function digestPolicyConfig(value) {
    const stable = {
        mode: value.mode,
        circuitBreakerEnabled: value.circuitBreakerEnabled,
        fallbackMode: value.fallbackMode,
        rolloutScope: value.rolloutScope,
        tripped: value.tripped,
        resetEvidenceDigest: value.resetEvidenceDigest
    };
    return `sha256:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}
function digestSafetyMetrics(metrics) {
    return `sha256:${createHash('sha256').update(JSON.stringify(metrics)).digest('hex')}`;
}
