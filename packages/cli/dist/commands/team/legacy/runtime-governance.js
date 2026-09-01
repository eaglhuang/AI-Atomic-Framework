import { createHash } from 'node:crypto';
import { TEAM_CLOSURE_ATTESTATION_SCHEMA_ID } from '../../evidence.js';
import { CliError } from '../../shared.js';
import { resolveNodejsTeamWorkerAdapter } from '../../../../../core/dist/team-runtime/nodejs-worker-adapter.js';
import { resolveTeamRuntimeProviderSelection } from '../role-provider-resolution.js';
import { buildTeamArtifactHandoffContract, buildTeamRetryBudgetContract, buildTeamRoleArtifactContract } from './runtime-contracts.js';
export function buildTeamRuntimeContract(input) {
    const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode);
    const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage) ?? 'node';
    const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId);
    const providerId = normalizeOptionalRuntimeString(input.providerId);
    const sdkId = normalizeOptionalRuntimeString(input.sdkId);
    const modelId = normalizeOptionalRuntimeString(input.modelId);
    const roleName = normalizeOptionalRuntimeString(input.roleName) ?? 'coordinator';
    const explicitRuntimeMode = Boolean(normalizeOptionalRuntimeString(input.runtimeMode));
    const explicitProviderId = Boolean(normalizeOptionalRuntimeString(input.providerId));
    const explicitSdkId = Boolean(normalizeOptionalRuntimeString(input.sdkId));
    const explicitModelId = Boolean(normalizeOptionalRuntimeString(input.modelId));
    const providerSelection = resolveTeamRuntimeProviderSelection({
        roleName,
        selectionConfig: input.selectionConfig,
        runtimeMode: explicitRuntimeMode ? runtimeMode : 'broker-only',
        providerId,
        sdkId,
        modelId,
        explicitRuntimeMode,
        explicitProviderId,
        explicitSdkId,
        explicitModelId
    });
    const selectionDecision = providerSelection.selectionDecision;
    const effectiveRuntimeMode = explicitRuntimeMode
        ? providerSelection.runtimeMode
        : providerSelection.selectionDecision?.runtimeMode ?? runtimeMode;
    const effectiveProviderId = providerSelection.providerId;
    const effectiveSdkId = providerSelection.sdkId;
    const effectiveModelId = providerSelection.modelId;
    const editorBridgeDisabled = Boolean(input.editorBridgeDisabled);
    const workerAdapter = resolveNodejsTeamWorkerAdapter({
        runtimeMode: effectiveRuntimeMode,
        runtimeLanguage,
        runtimeAdapterId,
        providerId: effectiveProviderId,
        sdkId: effectiveSdkId,
        modelId: effectiveModelId
    });
    const agentsSpawned = workerAdapter.agentsSpawned;
    const executionSurface = workerAdapter.executionSurface;
    return {
        schemaId: 'atm.teamRuntimeContract.v1',
        runtimeMode: effectiveRuntimeMode,
        runtimeLanguage,
        runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
        providerId: effectiveProviderId ?? workerAdapter.providerId,
        sdkId: effectiveSdkId ?? workerAdapter.sdkId,
        modelId: effectiveModelId ?? workerAdapter.modelId,
        agentsSpawned,
        executionSurface,
        selectionReason: describeRuntimeSelection({
            runtimeMode: effectiveRuntimeMode,
            runtimeLanguage,
            runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
            selectionSource: selectionDecision?.source ?? null,
            roleName
        }),
        workerAdapter,
        artifactHandoff: buildTeamArtifactHandoffContract({
            recipe: input.recipe,
            requiredRoles: ['implementer', 'reviewer', 'validator', 'evidence-collector'],
            producedArtifacts: []
        }),
        retryBudget: buildTeamRetryBudgetContract({}),
        commitLane: buildTeamCommitLaneContract(),
        brokerSubagent: buildTeamBrokerSubagentContract(),
        editorSubagentBridge: buildEditorSubagentBridgeContract({
            enabled: runtimeMode === 'editor-subagent' && !editorBridgeDisabled,
            disabledReason: runtimeMode !== 'editor-subagent'
                ? 'runtime-mode-is-not-editor-subagent'
                : editorBridgeDisabled
                    ? 'disabled-by-run-option'
                    : null,
            recipe: input.recipe,
            allowedFiles: input.allowedFiles ?? [],
            permissionLeases: input.permissionLeases ?? [],
            evidenceRequired: String(input.evidenceRequired ?? 'command-backed')
        })
    };
}
function buildTeamBrokerSubagentContract() {
    return {
        schemaId: 'atm.teamBrokerSubagentContract.v1',
        enabled: true,
        subagentId: 'team-broker-subagent',
        lifecycleOwner: 'atm',
        decisionSurface: 'brokerLane',
        governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
        stewardId: 'neutral-write-steward',
        evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
        authorityBoundary: {
            fileWrite: false,
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
        },
        escalationTarget: 'coordinator'
    };
}
function buildTeamCommitLaneContract() {
    return {
        schemaId: 'atm.teamCommitLaneContract.v1',
        ownerRole: 'coordinator',
        ownerPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
        workerGitWrite: false,
        serializedBy: 'branch-commit-queue',
        lockSchemaId: 'atm.branchCommitQueueLock.v1',
        retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']
    };
}
export function buildTeamClosureAttestation(input) {
    const runtime = input.runtimeContract ?? null;
    const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode ?? runtime?.runtimeMode);
    const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage ?? runtime?.runtimeLanguage) ?? 'node';
    const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId ?? runtime?.runtimeAdapterId);
    const providerId = normalizeOptionalRuntimeString(input.providerId ?? runtime?.providerId);
    const sdkId = normalizeOptionalRuntimeString(input.sdkId ?? runtime?.sdkId);
    const modelId = normalizeOptionalRuntimeString(input.modelId ?? runtime?.modelId);
    const runnerKind = normalizeOptionalRuntimeString(input.runnerKind) ?? (runtime?.agentsSpawned ? 'team-agent-runtime' : 'broker-governance');
    const sandboxPolicyHash = normalizeOptionalRuntimeString(input.sandboxPolicyHash)
        ?? createHash('sha256')
            .update([
            'local-runtime-wrapper-is-not-secure-sandbox-proof',
            runtimeMode,
            runtimeLanguage,
            runtimeAdapterId ?? '',
            providerId ?? '',
            sdkId ?? '',
            modelId ?? ''
        ].join('\n'))
            .digest('hex');
    return {
        schemaId: TEAM_CLOSURE_ATTESTATION_SCHEMA_ID,
        teamRunId: normalizeOptionalRuntimeString(input.teamRunId) ?? 'manual-team-run',
        runtimeMode,
        runtimeLanguage,
        runtimeAdapterId,
        providerId,
        sdkId,
        modelId,
        runnerKind,
        runtimeVersion: normalizeOptionalRuntimeString(input.runtimeVersion),
        sandboxPolicyHash: `sha256:${sandboxPolicyHash.replace(/^sha256:/, '')}`,
        attestationSigner: normalizeOptionalRuntimeString(input.attestationSigner) ?? 'coordinator',
        brokerSubagent: buildBrokerSubagentAttestation(runtime?.brokerSubagent),
        commitLane: buildCommitLaneAttestation(runtime?.commitLane),
        workerAuthorityBoundary: buildWorkerAuthorityBoundaryAttestation(runtime?.workerAdapter),
        reviewerIndependence: buildReviewerIndependenceAttestation(input.reviewerIndependence),
        attestedAt: normalizeOptionalRuntimeString(input.attestedAt) ?? new Date().toISOString(),
        localRuntimeWrapperIsSecureSandboxProof: false,
        commandBackedEvidenceRequired: true
    };
}
function buildBrokerSubagentAttestation(input) {
    const boundary = (input?.authorityBoundary ?? {});
    return {
        schemaId: normalizeOptionalRuntimeString(input?.schemaId),
        enabled: input?.enabled === true,
        subagentId: normalizeOptionalRuntimeString(input?.subagentId),
        decisionSurface: normalizeOptionalRuntimeString(input?.decisionSurface),
        stewardId: normalizeOptionalRuntimeString(input?.stewardId),
        governs: normalizeStringArray(input?.governs),
        evidenceRequired: normalizeStringArray(input?.evidenceRequired),
        authorityBoundary: {
            fileWrite: boundary?.fileWrite === true,
            gitWrite: boundary?.gitWrite === true,
            taskLifecycle: boundary?.taskLifecycle === true,
            selfClose: boundary?.selfClose === true
        }
    };
}
function buildCommitLaneAttestation(input) {
    const lane = (input ?? {});
    return {
        schemaId: normalizeOptionalRuntimeString(input?.schemaId),
        serializedBy: normalizeOptionalRuntimeString(input?.serializedBy),
        ownerRole: normalizeOptionalRuntimeString(input?.ownerRole),
        workerGitWrite: lane.workerGitWrite === true
    };
}
function buildWorkerAuthorityBoundaryAttestation(input) {
    const boundary = (input?.authorityBoundary ?? {});
    return {
        gitWrite: boundary.gitWrite === true,
        taskLifecycle: boundary.taskLifecycle === true,
        selfClose: boundary.selfClose === true,
        evidenceWriteOwner: normalizeOptionalRuntimeString(boundary?.evidenceWriteOwner)
    };
}
function buildReviewerIndependenceAttestation(input) {
    const required = input?.required !== false;
    const satisfied = input?.satisfied === true;
    return {
        required,
        satisfied,
        policy: normalizeOptionalRuntimeString(input?.policy) ?? 'reviewer-runtime-and-model-independent-from-implementer-when-required',
        reviewerProviderId: normalizeOptionalRuntimeString(input?.reviewerProviderId),
        reviewerModelId: normalizeOptionalRuntimeString(input?.reviewerModelId),
        reviewerRuntimeAdapterId: normalizeOptionalRuntimeString(input?.reviewerRuntimeAdapterId),
        reason: normalizeOptionalRuntimeString(input?.reason) ?? (satisfied ? 'reviewer independence policy satisfied' : 'reviewer independence policy unsatisfied')
    };
}
function buildEditorSubagentBridgeContract(input) {
    const allowedFiles = uniqueStrings(input.allowedFiles.map((entry) => String(entry).trim()).filter(Boolean));
    const leasesByAgent = new Map();
    for (const lease of input.permissionLeases) {
        leasesByAgent.set(lease.agentId, [...(leasesByAgent.get(lease.agentId) ?? []), {
                permission: lease.permission,
                agentId: lease.agentId,
                paths: lease.paths ? [...lease.paths] : undefined
            }]);
    }
    const roleEnvelopes = (input.recipe?.agents ?? []).map((agent) => {
        const permissionLeases = leasesByAgent.get(agent.agentId) ?? [];
        const artifactContract = buildTeamRoleArtifactContract({
            agentId: agent.agentId,
            role: agent.role
        });
        return {
            schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
            agentId: agent.agentId,
            role: agent.role,
            profile: agent.profile ?? null,
            language: agent.language ?? input.recipe?.language ?? null,
            permissions: [...agent.permissions],
            allowedFiles,
            leaseMetadata: {
                permissionLeases,
                leaseOwner: agent.agentId
            },
            artifactMetadata: {
                expectedReports: [
                    'agent report',
                    'validator evidence',
                    'team summary'
                ],
                evidenceRequired: input.evidenceRequired,
                consumesFrom: artifactContract.consumesFrom,
                producesTo: artifactContract.producesTo,
                requiredArtifacts: artifactContract.requiredArtifacts
            },
            retryMetadata: {
                retryPolicy: 'atm-governed',
                maxAttempts: 1
            }
        };
    });
    return {
        schemaId: 'atm.teamEditorSubagentBridgeContract.v1',
        enabled: input.enabled,
        lifecycleOwner: 'atm',
        disabledReason: input.disabledReason,
        editorNeutral: true,
        allowedFiles,
        roleEnvelopes
    };
}
export function normalizeTeamRuntimeMode(value) {
    const normalized = String(value ?? 'broker-only').trim();
    if (normalized === 'real-agent' || normalized === 'editor-subagent' || normalized === 'broker-only') {
        return normalized;
    }
    throw new CliError('ATM_TEAM_RUNTIME_MODE_INVALID', `Unsupported team runtime mode: ${normalized}`, {
        exitCode: 2,
        details: { supportedModes: ['real-agent', 'editor-subagent', 'broker-only'] }
    });
}
export function normalizeOptionalRuntimeString(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
export function buildCliGlobalProviderDefault(options) {
    const providerId = normalizeOptionalRuntimeString(options.provider);
    const sdkId = normalizeOptionalRuntimeString(options.sdk);
    const modelId = normalizeOptionalRuntimeString(options.model);
    const runtimeModeRaw = normalizeOptionalRuntimeString(options.runtimeMode);
    if (!providerId && !sdkId && !modelId && !runtimeModeRaw) {
        return null;
    }
    return {
        ...(providerId ? { providerId } : {}),
        ...(sdkId ? { sdkId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(runtimeModeRaw ? { runtimeMode: normalizeTeamRuntimeMode(runtimeModeRaw) } : {})
    };
}
function describeRuntimeSelection(input) {
    const adapter = input.runtimeAdapterId ?? 'no adapter override';
    const selectionSource = input.selectionSource
        ? `selection=${input.selectionSource}${input.roleName ? ` role=${input.roleName}` : ''}`
        : 'selection=explicit-runtime';
    if (input.runtimeMode === 'broker-only') {
        return `broker-only selected; no agents are spawned, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
    }
    if (input.runtimeMode === 'editor-subagent') {
        return `editor-subagent selected; adapter metadata is advisory, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
    }
    return `real-agent selected; adapter metadata is advisory until a worker bridge consumes it, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
}
export function evaluateReviewerIndependence(input) {
    const implementerFamily = normalizeModelFamily(input.implementer.modelId);
    const reviewerFamily = normalizeModelFamily(input.reviewer.modelId);
    const checks = {
        differentProvider: input.implementer.providerId !== input.reviewer.providerId,
        differentModelFamily: implementerFamily !== reviewerFamily,
        differentCertification: Boolean(input.implementer.modelCertificationId)
            && Boolean(input.reviewer.modelCertificationId)
            && input.implementer.modelCertificationId !== input.reviewer.modelCertificationId
    };
    const ok = input.policy === 'different-provider'
        ? checks.differentProvider
        : input.policy === 'different-model-family'
            ? checks.differentModelFamily
            : checks.differentCertification;
    return {
        schemaId: 'atm.reviewerIndependenceDecision.v1',
        ok,
        policy: input.policy,
        checks,
        reason: ok
            ? `Reviewer satisfies ${input.policy}.`
            : `Reviewer does not satisfy ${input.policy}; advisory note only.`
    };
}
export function buildReviewAgentSignature(input) {
    const independence = evaluateReviewerIndependence({
        implementer: input.implementer,
        reviewer: input.reviewer,
        policy: input.policy
    });
    const certificationPresent = Boolean(input.reviewer.modelCertificationId);
    const formal = independence.ok && certificationPresent;
    return {
        schemaId: 'atm.reviewAgentSignature.v1',
        taskId: input.taskId,
        signatureStatus: formal ? 'formal-signature' : 'advisory-note',
        permission: formal ? 'review.signature.write' : null,
        reviewer: {
            providerId: input.reviewer.providerId,
            modelId: input.reviewer.modelId,
            modelCertificationId: input.reviewer.modelCertificationId ?? null
        },
        implementer: {
            providerId: input.implementer.providerId,
            modelId: input.implementer.modelId,
            modelCertificationId: input.implementer.modelCertificationId ?? null
        },
        modelCertificationId: input.reviewer.modelCertificationId ?? null,
        reviewerIndependencePolicy: input.policy,
        independence,
        reviewedDiffHash: input.reviewedDiffHash,
        findings: [...(input.findings ?? [])],
        earlyWarning: classifyReviewEarlyWarnings(input.findings ?? [])
    };
}
export function evaluateReviewQuorum(input) {
    const formal = input.signatures.filter((signature) => signature.signatureStatus === 'formal-signature');
    const conflicts = detectReviewSignatureConflicts(input.signatures);
    const ok = formal.length >= input.requiredFormalSignatures && conflicts.length === 0;
    return {
        schemaId: 'atm.reviewQuorumDecision.v1',
        ok,
        requiredFormalSignatures: input.requiredFormalSignatures,
        formalSignatureCount: formal.length,
        advisoryNoteCount: input.signatures.length - formal.length,
        conflicts,
        escalationTarget: ok ? null : 'Coordinator/Captain/human review',
        reason: ok
            ? 'Review quorum satisfied.'
            : 'Review quorum insufficient or conflicting; formal signature is blocked but advisory notes remain usable.'
    };
}
function normalizeModelFamily(modelId) {
    return String(modelId ?? '').trim().toLowerCase().split(/[-_.:]/)[0] || 'unknown';
}
function classifyReviewEarlyWarnings(findings) {
    return findings.map((finding) => {
        const normalized = finding.toLowerCase();
        const category = normalized.includes('scope')
            ? 'scope-drift'
            : normalized.includes('test')
                ? 'missing-tests'
                : normalized.includes('contract')
                    ? 'consumer-contract'
                    : normalized.includes('rollback')
                        ? 'rollback-gap'
                        : 'review-note';
        return { category, finding };
    });
}
function detectReviewSignatureConflicts(signatures) {
    const findingSets = signatures.map((signature) => new Set(signature.findings.map((finding) => finding.toLowerCase())));
    const conflicts = [];
    for (let index = 1; index < findingSets.length; index += 1) {
        const previous = findingSets[index - 1];
        const current = findingSets[index];
        if (previous.has('approve') && current.has('block') || previous.has('block') && current.has('approve')) {
            conflicts.push(`reviewer-${index}-decision-conflict`);
        }
    }
    return conflicts;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
