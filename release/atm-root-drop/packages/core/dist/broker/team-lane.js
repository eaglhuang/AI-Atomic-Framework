import path from 'node:path';
import { calculateBrokerDecision } from './decision.js';
import { buildVirtualAtomInUseRegistry, loadRegistry } from './registry.js';
import { readGitHeadCommit } from './steward.js';
export const DEFAULT_TEAM_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';
export function buildTeamBrokerRunRecord(input) {
    const taskId = input.request.taskId?.trim();
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
        ...(taskId ? { task_ids: [taskId] } : {})
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
    const registry = loadRegistry(registryPath);
    const virtualAtomInUseRegistry = buildVirtualAtomInUseRegistry(registry);
    const decision = calculateBrokerDecision(writeIntent, registry);
    const resolution = resolveTeamBrokerLane(decision);
    const evidence = {
        schemaId: 'atm.teamBrokerLaneEvidence.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        actorId: input.actorId,
        registryPath: DEFAULT_BROKER_REGISTRY_RELATIVE_PATH,
        writeIntent,
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
