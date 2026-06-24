import { createHash } from 'node:crypto';
import { calculateBrokerDecision } from '../broker/decision.js';
import { loadRegistry, cleanupStale } from '../broker/registry.js';
import { readBrokerLifecycleState } from '../broker/lifecycle.js';
import { collectGitDiffMutationRequests } from './diff-mutation-request.js';
import { bridgeGitDiffEntriesToAdapterConflictKeys } from './format-adapter-bridge.js';
export function evaluateGitAdmission(input) {
    try {
        const envelope = collectGitDiffMutationRequests(input);
        const localBridge = bridgeGitDiffEntriesToAdapterConflictKeys({
            cwd: input.cwd,
            baseRef: envelope.topology.mergeBaseSha,
            targetRef: envelope.topology.headSha,
            entries: envelope.localDiff,
            actorId: input.actorId,
            taskId: input.taskId ?? null,
            gitExecutable: input.gitExecutable
        });
        const remoteBridge = bridgeGitDiffEntriesToAdapterConflictKeys({
            cwd: input.cwd,
            baseRef: envelope.topology.mergeBaseSha,
            targetRef: envelope.topology.remoteRef,
            entries: envelope.remoteDiff,
            actorId: `virtual:git-remote@${envelope.topology.remoteSha}`,
            taskId: input.taskId ?? null,
            gitExecutable: input.gitExecutable
        });
        const local = {
            diff: envelope.localDiff,
            requests: envelope.localRequests,
            bridged: localBridge.entries.map(toAdmissionBridgeEntry)
        };
        const remote = {
            diff: envelope.remoteDiff,
            requests: envelope.remoteRequests,
            bridged: remoteBridge.entries.map(toAdmissionBridgeEntry)
        };
        const diagnostics = [...localBridge.diagnostics, ...remoteBridge.diagnostics];
        if (envelope.localDiff.length === 0) {
            return {
                outcome: 'no-op',
                topology: envelope.topology,
                brokerDecision: null,
                brokerRegistryPath: resolveRegistryPath(input.cwd, input.registryPath),
                conflictingFiles: [],
                recommendedNextStep: 'No local commits diverge from the merge base; nothing to admit before push.',
                local,
                remote,
                diagnostics
            };
        }
        const localIntent = buildAdmissionIntent({
            taskId: input.taskId ?? `git-local-${envelope.topology.branch}`,
            actorId: input.actorId,
            baseCommit: envelope.topology.mergeBaseSha,
            topology: envelope.topology,
            side: 'local',
            entries: envelope.localDiff,
            bridged: localBridge.entries
        });
        const remoteActiveIntent = buildActiveAdmissionIntent({
            taskId: `git-remote-${envelope.topology.remoteRef.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
            actorId: `virtual:git-remote@${envelope.topology.remoteSha}`,
            baseCommit: envelope.topology.mergeBaseSha,
            topology: envelope.topology,
            side: 'remote',
            entries: envelope.remoteDiff,
            bridged: remoteBridge.entries
        });
        const registryState = readBrokerLifecycleState(input.cwd);
        const cleanedRegistry = cleanupStale(loadRegistry(input.registryPath ?? registryState.registryPath));
        const syntheticActiveIntents = remoteActiveIntent ? [remoteActiveIntent] : [];
        const syntheticEpoch = syntheticActiveIntents.length > 0
            ? Math.max(...syntheticActiveIntents.map((intent) => intent.leaseEpoch))
            : cleanedRegistry.currentEpoch;
        const brokerRegistry = {
            ...cleanedRegistry,
            currentEpoch: syntheticEpoch,
            activeIntents: syntheticActiveIntents
        };
        const brokerDecision = calculateBrokerDecision(localIntent, brokerRegistry);
        const overlappingFiles = envelope.localDiff
            .map((entry) => entry.filePath)
            .filter((filePath) => envelope.remoteDiff.some((candidate) => candidate.filePath === filePath));
        const conflictingFiles = dedupeStrings([
            ...extractConflictFiles(brokerDecision),
            ...((mapDecisionToOutcome(brokerDecision) === 'block' || mapDecisionToOutcome(brokerDecision) === 'composer-routed') ? overlappingFiles : []),
            ...collectFailClosedFiles(localBridge.entries),
            ...collectFailClosedFiles(remoteBridge.entries)
        ]);
        return {
            outcome: mapDecisionToOutcome(brokerDecision),
            topology: envelope.topology,
            brokerDecision,
            brokerRegistryPath: registryState.registryPath,
            conflictingFiles,
            recommendedNextStep: buildRecommendedNextStep(mapDecisionToOutcome(brokerDecision), conflictingFiles),
            local,
            remote,
            diagnostics
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            outcome: 'internal-error',
            topology: {
                branch: input.branch?.trim() || 'unknown',
                remote: input.remote?.trim() || 'origin',
                remoteRef: `${input.remote?.trim() || 'origin'}/${input.branch?.trim() || 'unknown'}`,
                headSha: 'unknown',
                remoteSha: 'unknown',
                mergeBaseSha: 'unknown',
                fetched: input.fetch !== false
            },
            brokerDecision: null,
            brokerRegistryPath: resolveRegistryPath(input.cwd, input.registryPath),
            conflictingFiles: [],
            recommendedNextStep: `Investigate the admission error and rerun the command after fixing the underlying Git or broker state: ${message}`,
            local: { diff: [], requests: [], bridged: [] },
            remote: { diff: [], requests: [], bridged: [] },
            diagnostics: [{
                    code: 'ATM_GIT_ADMISSION_INTERNAL_ERROR',
                    message,
                    filePath: '',
                    action: 'inspect-text-diff'
                }]
        };
    }
}
function toAdmissionBridgeEntry(entry) {
    return {
        filePath: entry.filePath,
        adapterId: entry.adapterId,
        conflictKeys: entry.conflictKeys,
        requests: entry.requests,
        diagnostics: entry.diagnostics,
        failClosed: entry.failClosed
    };
}
function buildAdmissionIntent(input) {
    const atomRefs = buildAtomRefs(input.entries, input.bridged);
    const targetFiles = dedupeStrings(input.entries.map((entry) => entry.filePath));
    const proposalAdmission = buildProposalAdmission(input.entries);
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'git admission synthesized write intent' },
        taskId: input.taskId,
        actorId: input.actorId,
        baseCommit: input.baseCommit,
        targetFiles,
        atomRefs,
        sharedSurfaces: {
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
        },
        requestedLane: 'auto',
        proposalAdmission
    };
}
function buildActiveAdmissionIntent(input) {
    if (input.entries.length === 0) {
        return null;
    }
    const atomRefs = buildAtomRefs(input.entries, input.bridged);
    const proposalAdmission = buildProposalAdmission(input.entries);
    const now = Date.now();
    const isoNow = new Date(now).toISOString();
    return {
        intentId: `git-admission-remote-${shortHash(`${input.topology.remoteRef}:${input.topology.remoteSha}`)}`,
        taskId: input.taskId,
        teamRunId: null,
        actorId: input.actorId,
        baseCommit: input.baseCommit,
        resourceKeys: {
            files: dedupeStrings(input.entries.map((entry) => entry.filePath)),
            atomIds: atomRefs.map((ref) => ref.atomId),
            atomCids: atomRefs.map((ref) => ref.atomCid),
            readAtomIds: [],
            readAtomCids: [],
            atomRanges: atomRefs
                .filter((ref) => ref.sourceRange)
                .map((ref) => ({
                filePath: ref.sourceRange.filePath,
                lineStart: ref.sourceRange.lineStart,
                lineEnd: ref.sourceRange.lineEnd,
                atomCid: ref.atomCid
            })),
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
        },
        leaseEpoch: now,
        leaseSeconds: 1800,
        leaseMaxSeconds: 1800,
        heartbeatAt: isoNow,
        lane: 'direct-brokered',
        expiresAt: new Date(now + 1800 * 1000).toISOString(),
        admission: {
            trigger: proposalAdmission.trigger,
            state: 'write-admitted',
            requiresProposal: proposalAdmission.trigger !== 'not-required',
            summarySubmitted: true,
            hotFiles: proposalAdmission.hotFiles ?? [],
            boundedRegions: proposalAdmission.boundedRegions ?? [],
            rearbitrationRequired: false,
            reason: 'Remote branch admission surface synthesized from Git diff.'
        }
    };
}
function buildAtomRefs(entries, bridged) {
    const bridgeByPath = new Map(bridged.map((entry) => [entry.filePath, entry]));
    const refs = [];
    for (const entry of entries) {
        const bridge = bridgeByPath.get(entry.filePath);
        if (bridge && bridge.conflictKeys.length > 0) {
            for (const key of bridge.conflictKeys) {
                refs.push({
                    atomId: `${entry.filePath}::${key.scope}::${key.key}`,
                    atomCid: shortHash(`${entry.filePath}::${key.scope}::${key.key}`),
                    operation: toAtomOperation(entry.status),
                    ...(parseSourceRangeFromConflictKey(entry.filePath, key) ? { sourceRange: parseSourceRangeFromConflictKey(entry.filePath, key) } : {})
                });
            }
            continue;
        }
        refs.push({
            atomId: `${entry.filePath}::file`,
            atomCid: shortHash(`${entry.filePath}::file`),
            operation: toAtomOperation(entry.status)
        });
    }
    return dedupeAtomRefs(refs);
}
function buildProposalAdmission(entries) {
    return {
        trigger: 'not-required',
        summarySubmitted: true,
        hotFiles: [],
        boundedRegions: [],
        notes: 'Git admission compares local and remote branch mutation surfaces before push.'
    };
}
function parseSourceRangeFromConflictKey(filePath, key) {
    if (key.scope !== 'range') {
        return null;
    }
    const match = /^range:[^:]+::(\d+)-(\d+)$/.exec(key.key);
    if (!match) {
        return null;
    }
    return {
        filePath,
        lineStart: Number.parseInt(match[1], 10),
        lineEnd: Number.parseInt(match[2], 10)
    };
}
function toAtomOperation(status) {
    return status === 'deleted' ? 'delete' : status === 'added' ? 'create' : 'modify';
}
function mapDecisionToOutcome(decision) {
    switch (decision.verdict) {
        case 'parallel-safe':
            return 'allow';
        case 'needs-physical-split':
            return 'composer-routed';
        case 'blocked-active-lease':
        case 'blocked-cid-conflict':
        case 'blocked-shared-surface':
        case 'serial':
            return 'block';
        default:
            return 'internal-error';
    }
}
function buildRecommendedNextStep(outcome, conflictingFiles) {
    if (outcome === 'allow') {
        return 'Admission passed; you can proceed to push or capture this verdict as hook/CI evidence.';
    }
    if (outcome === 'no-op') {
        return 'No local branch delta exists; skip push admission or create a new local commit first.';
    }
    if (outcome === 'composer-routed') {
        return conflictingFiles.length > 0
            ? `Same-file but potentially mergeable work was detected in ${conflictingFiles.join(', ')}; route through deterministic-composer before push.`
            : 'Same-file but potentially mergeable work was detected; route through deterministic-composer before push.';
    }
    if (outcome === 'block') {
        return conflictingFiles.length > 0
            ? `Conflicting mutation surfaces were detected in ${conflictingFiles.join(', ')}; rebase, split the work, or rearbitrate before push.`
            : 'Conflicting mutation surfaces were detected; rebase, split the work, or rearbitrate before push.';
    }
    return 'Admission failed internally; inspect diagnostics and retry after repairing the repository or broker state.';
}
function extractConflictFiles(decision) {
    const files = [];
    for (const conflict of decision.conflicts) {
        const match = conflict.detail.match(/'([^']+\.[^']+)'/);
        if (match?.[1]) {
            files.push(normalizeConflictFileToken(match[1]));
            continue;
        }
        const scopedAtomMatch = conflict.detail.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)::/);
        if (scopedAtomMatch?.[1]) {
            files.push(normalizeConflictFileToken(scopedAtomMatch[1]));
        }
    }
    return dedupeStrings(files);
}
function normalizeConflictFileToken(value) {
    return value.split('::')[0] ?? value;
}
function collectFailClosedFiles(entries) {
    return dedupeStrings(entries.filter((entry) => entry.failClosed).map((entry) => entry.filePath));
}
function dedupeStrings(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function dedupeAtomRefs(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const id = `${value.atomId}::${value.atomCid}`;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        result.push(value);
    }
    return result;
}
function shortHash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
function resolveRegistryPath(cwd, registryPath) {
    return registryPath ?? readBrokerLifecycleState(cwd).registryPath;
}
