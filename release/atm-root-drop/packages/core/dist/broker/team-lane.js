import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { calculateBrokerDecision } from './decision.js';
import { buildVirtualAtomInUseRegistry, cleanupStale, loadRegistry } from './registry.js';
import { readGitHeadCommit } from './steward.js';
export const DEFAULT_TEAM_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';
const HOT_FILE_BASENAMES = new Set(['tasks.ts', 'next.ts', 'evidence.ts', 'hook.ts', 'team.ts', 'broker.ts']);
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
    const hotFiles = targetFiles.filter((entry) => HOT_FILE_BASENAMES.has(path.posix.basename(entry)));
    const proposalAdmission = deriveTeamProposalAdmission(task, hotFiles);
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
        requestedLane: 'auto',
        ...(proposalAdmission ? { proposalAdmission } : {})
    };
}
export function resolveTeamBrokerLane(decision) {
    if (decision.admission?.state === 'proposal-submitted') {
        return {
            chosenLane: 'direct-brokered',
            stewardId: null,
            composerPath: null,
            safeToStart: false,
            blockedReasons: [decision.admission.reason]
        };
    }
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
    const registry = cleanupStale(loadRegistry(registryPath, { persistCleanup: input.readOnly !== true }));
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
    const admission = decision.admission ?? {
        trigger: 'not-required',
        state: 'not-required',
        requiresProposal: false,
        summarySubmitted: false,
        hotFiles: [],
        boundedRegions: [],
        rearbitrationRequired: false,
        reason: 'No proposal admission evidence was emitted.'
    };
    const evidence = {
        schemaId: 'atm.teamBrokerLaneEvidence.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        actorId: input.actorId,
        registryPath: DEFAULT_BROKER_REGISTRY_RELATIVE_PATH,
        writeIntent,
        writeTransaction,
        decision,
        admission,
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
        admissionState: input.decision.admission?.state ?? 'not-required',
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
    const firstRegion = deriveBoundedRegions(task)[0];
    const atomCid = deriveTeamAtomCid(task, ownerAtom, taskId, firstRegion);
    return [{
            atomId: ownerAtom,
            atomCid,
            operation: 'modify',
            ...(firstRegion ? {
                sourceRange: {
                    filePath: firstRegion.filePath,
                    lineStart: firstRegion.lineStart,
                    lineEnd: firstRegion.lineEnd
                }
            } : {})
        }];
}
function deriveTeamAtomCid(task, ownerAtom, taskId, firstRegion) {
    const atomizationImpact = task?.atomizationImpact;
    const proposalAdmission = asRecord(task?.proposalAdmission) ?? asRecord(task?.brokerProposalAdmission);
    const explicitAtomCid = normalizeOptionalString(atomizationImpact?.atomCid
        ?? atomizationImpact?.atom_cid
        ?? task?.atomCid
        ?? task?.atom_cid
        ?? proposalAdmission?.atomCid
        ?? proposalAdmission?.atom_cid);
    if (explicitAtomCid) {
        return explicitAtomCid;
    }
    const base = toSyntheticAtomSlug(ownerAtom || taskId);
    if (!firstRegion) {
        return base;
    }
    const fileComponent = path.posix.basename(firstRegion.filePath).replace(/\.[^.]+$/, '');
    return `${base}-${toSyntheticAtomSlug(fileComponent)}-${firstRegion.lineStart}-${firstRegion.lineEnd}`;
}
function deriveTeamProposalAdmission(task, hotFiles) {
    const raw = asRecord(task?.proposalAdmission)
        ?? asRecord(task?.brokerProposalAdmission)
        ?? asRecord(task?.writeAdmission);
    const boundedRegions = deriveBoundedRegions(task);
    const configuredTrigger = normalizeProposalTrigger(raw?.trigger);
    const notes = typeof raw?.notes === 'string' && raw.notes.trim()
        ? raw.notes.trim()
        : hotFiles.length > 0
            ? 'Hot files require proposal-first admission before live write.'
            : boundedRegions.length > 0
                ? 'Bounded-region proposal admission metadata supplied by task.'
                : '';
    const trigger = configuredTrigger
        ?? (hotFiles.length > 0 ? 'hot-file' : boundedRegions.length > 0 ? 'shared-surface-risk' : null);
    if (!trigger) {
        return undefined;
    }
    return {
        trigger,
        summarySubmitted: raw?.summarySubmitted === true,
        hotFiles: normalizeStringList([...(hotFiles ?? []), ...normalizeStringArray(raw?.hotFiles)]),
        boundedRegions,
        notes
    };
}
function deriveBoundedRegions(task) {
    const rawRegions = normalizeRegionArray(asArray(task?.proposalAdmission && asRecord(task.proposalAdmission)?.boundedRegions)
        ?? asArray(task?.brokerProposalAdmission && asRecord(task.brokerProposalAdmission)?.boundedRegions)
        ?? asArray(task?.writeBoundedRegions)
        ?? asArray(task?.boundedRegions)
        ?? []);
    return rawRegions;
}
function normalizeRegionArray(value) {
    const regions = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const filePath = typeof record?.filePath === 'string' ? record.filePath.replace(/\\/g, '/').trim() : '';
        const lineStart = normalizePositiveInteger(record?.lineStart);
        const lineEnd = normalizePositiveInteger(record?.lineEnd);
        if (!filePath || lineStart === null || lineEnd === null || lineEnd < lineStart) {
            continue;
        }
        regions.push({ filePath, lineStart, lineEnd });
    }
    return normalizeBoundedRegionList(regions);
}
function normalizeBoundedRegionList(regions) {
    const seen = new Set();
    const output = [];
    for (const region of regions) {
        const key = `${region.filePath}:${region.lineStart}:${region.lineEnd}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(region);
    }
    return output.sort((left, right) => `${left.filePath}:${left.lineStart}:${left.lineEnd}`.localeCompare(`${right.filePath}:${right.lineStart}:${right.lineEnd}`));
}
function normalizeProposalTrigger(value) {
    const trigger = typeof value === 'string' ? value.trim() : '';
    if (trigger === 'hot-file'
        || trigger === 'same-file-overlap-risk'
        || trigger === 'shared-surface-risk'
        || trigger === 'manual-review-surface') {
        return trigger;
    }
    return null;
}
function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
        : [];
}
function normalizePositiveInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number.parseInt(value.trim(), 10);
        return parsed > 0 ? parsed : null;
    }
    return null;
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}
function toSyntheticAtomSlug(value) {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || 'unknown-atom';
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asArray(value) {
    return Array.isArray(value) ? value : null;
}
function toProposalAdmissionRequest(admission) {
    if (!admission) {
        return undefined;
    }
    return {
        trigger: admission.trigger,
        summarySubmitted: admission.summarySubmitted,
        ...(admission.boundedRegions.length > 0 ? { boundedRegions: admission.boundedRegions } : {}),
        ...(admission.hotFiles.length > 0 ? { hotFiles: admission.hotFiles } : {}),
        ...(admission.reason ? { notes: admission.reason } : {})
    };
}
function rehydrateWriteIntentFromActiveIntent(activeIntent) {
    const atomRefs = activeIntent.resourceKeys.atomIds.map((atomId, index) => {
        const atomCid = activeIntent.resourceKeys.atomCids[index] ?? toSyntheticAtomSlug(atomId);
        const sourceRange = activeIntent.resourceKeys.atomRanges?.find((range) => range.atomCid === atomCid);
        return {
            atomId,
            atomCid,
            operation: 'modify',
            ...(sourceRange ? {
                sourceRange: {
                    filePath: sourceRange.filePath,
                    lineStart: sourceRange.lineStart,
                    lineEnd: sourceRange.lineEnd
                }
            } : {})
        };
    });
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'rehydrated from active write intent' },
        taskId: activeIntent.taskId,
        actorId: activeIntent.actorId,
        baseCommit: activeIntent.baseCommit,
        targetFiles: activeIntent.resourceKeys.files,
        atomRefs,
        sharedSurfaces: {
            generators: activeIntent.resourceKeys.generators,
            projections: activeIntent.resourceKeys.projections,
            registries: activeIntent.resourceKeys.registries,
            validators: activeIntent.resourceKeys.validators,
            artifacts: activeIntent.resourceKeys.artifacts
        },
        requestedLane: 'auto',
        ...(activeIntent.admission ? { proposalAdmission: toProposalAdmissionRequest(activeIntent.admission) } : {})
    };
}
export function projectTeamBrokerRearbitrationSnapshot(input) {
    const shadowRegistry = {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'local-repo',
        workspaceId: 'main',
        currentEpoch: input.registry.currentEpoch ?? Date.now(),
        activeIntents: input.registry.activeIntents.filter((entry) => entry.intentId !== input.activeIntent.intentId)
    };
    const effectiveDecision = calculateBrokerDecision(rehydrateWriteIntentFromActiveIntent(input.activeIntent), shadowRegistry);
    const effectiveLane = resolveTeamBrokerLane(effectiveDecision);
    return {
        observedAt: new Date().toISOString(),
        triggerTaskId: input.triggerTaskId,
        triggerActorId: input.triggerActorId,
        registeredLane: input.activeIntent.lane === 'neutral-steward' ? 'neutral-steward' : input.activeIntent.lane,
        registeredDecision: {
            schemaId: 'atm.brokerDecision.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'registered active intent snapshot' },
            intentId: input.activeIntent.intentId,
            taskId: input.activeIntent.taskId,
            verdict: input.activeIntent.lane === 'blocked'
                ? 'blocked-active-lease'
                : input.activeIntent.lane === 'deterministic-composer'
                    ? 'needs-physical-split'
                    : input.activeIntent.lane === 'serial'
                        ? 'serial'
                        : 'parallel-safe',
            lane: input.activeIntent.lane,
            conflicts: [],
            applyMethod: input.activeIntent.lane === 'deterministic-composer' ? 'patch-apply' : 'none',
            reason: 'Registered active intent snapshot.',
            ...(input.activeIntent.admission ? { admission: input.activeIntent.admission } : {})
        },
        effectiveDecision,
        effectiveChosenLane: effectiveLane.chosenLane,
        effectiveSafeToStart: effectiveLane.safeToStart,
        effectiveBlockedReasons: effectiveLane.blockedReasons
    };
}
