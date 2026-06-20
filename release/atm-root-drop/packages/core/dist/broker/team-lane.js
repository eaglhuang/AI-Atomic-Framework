import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { calculateBrokerDecision } from './decision.js';
import { buildVirtualAtomInUseRegistry, cleanupStale, loadRegistry } from './registry.js';
import { readGitHeadCommit } from './steward.js';
export const DEFAULT_TEAM_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';
export function buildTeamBrokerRunRecord(input) {
    const taskId = input.request.taskId?.trim();
    const transactionIds = normalizeStringList(input.transactionIds ?? []);
    return {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'team lane run record'
        },
        runId: input.runId,
        planId: input.planId,
        request_identity: [input.request.requestId],
        actor_ids: [input.request.actorId],
        request_files: [input.request.filePath],
        adapter_choice: input.adapterChoice,
        applied_files: input.appliedFiles ?? [input.request.filePath],
        lane_decision: input.laneDecision,
        merge_verdict: input.mergeVerdict,
        evidence_path: input.evidencePath,
        ...(taskId ? { task_ids: [taskId] } : {}),
        ...(input.commitSha ? { commit_sha: input.commitSha } : {}),
        ...(transactionIds.length > 0 ? { transaction_ids: transactionIds } : {})
    };
}
export function buildTeamBrokerRunRecordEnvelope(input) {
    return {
        schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'team lane run record'
        },
        runId: input.runId,
        planId: input.planId,
        records: [...input.records]
    };
}
export function buildTeamWriteIntent(input) {
    const task = input.task;
    const baseCommit = readGitHeadCommit(path.resolve(input.cwd)) ?? 'unknown-base-commit';
    const targetFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'team plan/start broker lane' },
        taskId: input.taskId,
        actorId: input.actorId,
        baseCommit,
        targetFiles,
        atomRefs: deriveTeamAtomRefs(task, input.taskId),
        sharedSurfaces: {
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
        },
        requestedLane: 'auto'
    };
}
export function resolveTeamBrokerLane(decision) {
    if (decision.verdict === 'blocked-cid-conflict'
        || decision.verdict === 'blocked-shared-surface'
        || decision.verdict === 'blocked-active-lease'
        || decision.lane === 'blocked') {
        return {
            chosenLane: 'blocked',
            stewardId: null,
            composerPath: null,
            safeToStart: false,
            blockedReasons: [
                decision.reason,
                ...decision.conflicts.map((conflict) => conflict.detail)
            ]
        };
    }
    if (decision.verdict === 'needs-physical-split') {
        return {
            chosenLane: 'neutral-steward',
            stewardId: DEFAULT_TEAM_STEWARD_ID,
            composerPath: 'broker compose -> steward plan/apply',
            safeToStart: true,
            blockedReasons: []
        };
    }
    if (decision.lane === 'deterministic-composer') {
        return {
            chosenLane: 'deterministic-composer',
            stewardId: null,
            composerPath: 'broker compose',
            safeToStart: true,
            blockedReasons: []
        };
    }
    return {
        chosenLane: decision.lane === 'serial' ? 'serial' : 'direct-brokered',
        stewardId: null,
        composerPath: null,
        safeToStart: true,
        blockedReasons: []
    };
}
export function evaluateTeamBrokerLane(input) {
    const registryPath = input.registryPath ?? path.join(path.resolve(input.cwd), DEFAULT_BROKER_REGISTRY_RELATIVE_PATH);
    const writeIntent = buildTeamWriteIntent(input);
    const registry = cleanupStale(loadRegistry(registryPath));
    const virtualAtomInUseRegistry = buildVirtualAtomInUseRegistry(registry);
    const decision = calculateBrokerDecision(writeIntent, registry);
    const resolution = resolveTeamBrokerLane(decision);
    const writeTransaction = buildTeamBrokerWriteTransactionEvidence({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        writeIntent,
        decision,
        writePaths: input.writePaths
    });
    const evidence = {
        schemaId: 'atm.teamBrokerLaneEvidence.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        actorId: input.actorId,
        registryPath: DEFAULT_BROKER_REGISTRY_RELATIVE_PATH,
        writeIntent,
        writeTransaction,
        decision,
        virtualAtomInUseRegistry,
        chosenLane: resolution.chosenLane,
        stewardId: resolution.stewardId,
        composerPath: resolution.composerPath,
        safeToStart: resolution.safeToStart,
        blockedReasons: resolution.blockedReasons
    };
    return {
        ok: resolution.safeToStart,
        evidence
    };
}
export function buildTeamBrokerEvidence(result) {
    return result.evidence;
}
export function buildTeamBrokerWriteTransactionEvidence(input) {
    const cwd = path.resolve(input.cwd);
    const allowedFiles = normalizePathList(input.writePaths);
    const readSet = normalizePathList([
        ...allowedFiles,
        ...input.writeIntent.atomRefs.map((ref) => ref.sourceRange?.filePath ?? '').filter(Boolean)
    ]);
    const writeSet = normalizePathList(input.writeIntent.targetFiles);
    const startedAt = new Date().toISOString();
    const leaseEpoch = Date.now();
    const leaseSeconds = Math.max(1, Math.floor(input.writeIntent.leaseBounds?.requestedSeconds ?? 1800));
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const transactionSeed = [
        input.taskId,
        input.actorId,
        input.writeIntent.baseCommit,
        input.decision.intentId,
        leaseEpoch,
        ...writeSet
    ].join('\n');
    return {
        schemaId: 'atm.teamBrokerWriteTransaction.v1',
        transactionId: `txn-${createHash('sha256').update(transactionSeed).digest('hex').slice(0, 16)}`,
        taskId: input.taskId,
        principalId: input.actorId,
        actorId: input.actorId,
        sessionId: readSessionId(),
        instanceId: `${input.actorId}@local`,
        worktreeId: cwd,
        branchRef: readGitBranchRef(cwd),
        baseHead: input.writeIntent.baseCommit,
        leaseEpoch,
        allowedFiles,
        readSet,
        writeSet,
        fileHashesBefore: buildFileHashesBefore(cwd, writeSet),
        brokerDecision: {
            verdict: input.decision.verdict,
            lane: input.decision.lane,
            intentId: input.decision.intentId,
            parallelSafetyReason: input.decision.verdict === 'parallel-safe'
                ? 'no-known-textual-or-resource-conflict'
                : null
        },
        startedAt,
        expiresAt,
        heartbeatAt: startedAt
    };
}
function readSessionId() {
    for (const key of ['ATM_SESSION_ID', 'CODEX_SESSION_ID', 'GITHUB_RUN_ID']) {
        const value = process.env[key]?.trim();
        if (value)
            return value;
    }
    return null;
}
function readGitBranchRef(cwd) {
    const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
    if (result.status !== 0)
        return null;
    const branch = String(result.stdout ?? '').trim();
    return branch || null;
}
function normalizePathList(entries) {
    return normalizeStringList(entries.map((entry) => entry.replace(/\\/g, '/')));
}
function normalizeStringList(entries) {
    return [...new Set(entries.map((entry) => entry.replace(/\\/g, '/').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function buildFileHashesBefore(cwd, relativePaths) {
    const output = {};
    for (const relativePath of relativePaths) {
        const absolutePath = path.resolve(cwd, relativePath);
        output[relativePath] = existsSync(absolutePath)
            ? `sha256:${createHash('sha256').update(readFileSync(absolutePath)).digest('hex')}`
            : null;
    }
    return output;
}
export function buildTeamBrokerRuntimeActivationHandshake(input) {
    const laneResult = evaluateTeamBrokerLane(input);
    const approved = laneResult.ok && laneResult.evidence.safeToStart;
    const allowedFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
    const evidence = {
        schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        actorId: input.actorId,
        registryPath: laneResult.evidence.registryPath,
        brokerLane: laneResult.evidence,
        activationState: approved ? 'activated' : 'blocked',
        scopedWriteExecution: {
            approved,
            allowedFiles,
            evidencePath: input.evidencePath ?? null,
            acceptedInputs: ['PatchProposal', 'MergePlan', 'StewardPlan']
        },
        runtimeBoundary: {
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
        },
        blockedReasons: approved ? [] : [...laneResult.evidence.blockedReasons]
    };
    return {
        ok: approved,
        evidence
    };
}
export function brokerLaneToFindings(result) {
    if (result.ok) {
        return [];
    }
    const { decision, blockedReasons } = result.evidence;
    const code = decision.verdict === 'blocked-shared-surface'
        ? 'blocked-broker-shared-surface'
        : 'blocked-broker-cid-conflict';
    return [{
            level: 'error',
            code,
            detail: blockedReasons[0] ?? decision.reason,
            paths: decision.conflicts
                .filter((conflict) => conflict.kind === 'file-range')
                .map((conflict) => {
                const match = /'([^']+)'/.exec(conflict.detail);
                return match?.[1] ?? '';
            })
                .filter(Boolean)
        }];
}
function deriveTeamAtomRefs(task, taskId) {
    const atomizationImpact = task?.atomizationImpact;
    const ownerAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? taskId).trim();
    const atomCid = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return [{
            atomId: ownerAtom,
            atomCid,
            operation: 'modify'
        }];
}
