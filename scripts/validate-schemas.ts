import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaEntries: Record<string, string> = {
  'atomic-spec': 'schemas/atomic-spec.schema.json',
  'atomic-map': 'schemas/registry/atomic-map.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'execution-evidence': 'schemas/agent-execute/execution-evidence.schema.json',
  'governance-artifact': 'schemas/governance/artifact.schema.json',
  'governance-log': 'schemas/governance/log.schema.json',
  'governance-run-report': 'schemas/governance/run-report.schema.json',
  'governance-state': 'schemas/governance/markdown-json-state.schema.json',
  'governance-default-guards': 'schemas/governance/default-guards.schema.json',
  'governance-evidence': 'schemas/governance/evidence.schema.json',
  'governance-context-summary': 'schemas/governance/context-summary.schema.json',
  'governance-welcome-lineage': 'schemas/governance/welcome-lineage.schema.json',
  'governance-conversation-transcript': 'schemas/governance/conversation-transcript.schema.json',
  'governance-detector-report': 'schemas/governance/detector-report.schema.json',
  'governance-conversation-review-findings-report': 'schemas/governance/conversation-review-findings-report.schema.json',
  'governance-conversation-patch-draft-report': 'schemas/governance/conversation-patch-draft-report.schema.json',
  'governance-conversation-feedback-report': 'schemas/governance/conversation-feedback-report.schema.json',
  'governance-evolution-scan-report': 'schemas/governance/evolution-scan-report.schema.json',
  'governance-map-curator-report': 'schemas/governance/map-curator-report.schema.json',
  'governance-map-equivalence-report': 'schemas/governance/map-equivalence-report.schema.json',
  'governance-polymorph-impact-report': 'schemas/governance/polymorph-impact-report.schema.json',
  'governance-propagation-report': 'schemas/governance/propagation-report.schema.json',
  'governance-retirement-proof': 'schemas/governance/retirement-proof.schema.json',
  'governance-decomposition-plan': 'schemas/governance/decomposition-plan.schema.json',
  'governance-adapter-report': 'schemas/governance/adapter-report.schema.json',
  'governance-atomize-adapter': 'schemas/governance/atomize-adapter.schema.json',
  'governance-infect-adapter': 'schemas/governance/infect-adapter.schema.json',
  'governance-inject-plan': 'schemas/governance/inject-plan.schema.json',
  'governance-rollback-plan': 'schemas/governance/rollback-plan.schema.json',
  'evidence-usage-feedback': 'schemas/governance/evidence/usage-feedback.schema.json',
  'evidence-quality-baseline': 'schemas/governance/evidence/quality-baseline.schema.json',
  'evidence-quality-comparison': 'schemas/governance/evidence/quality-comparison.schema.json',
  'evidence-rollback-proof': 'schemas/governance/evidence/rollback-proof.schema.json',
  'human-review-decision': 'schemas/human-review/decision.schema.json',
  'governance-work-item': 'schemas/governance/work-item.schema.json',
  'governance-scope-lock': 'schemas/governance/scope-lock.schema.json',
  'governance-bundle': 'schemas/governance/governance-bundle.schema.json',
  'police-registry-candidate-report': 'schemas/police/registry-candidate-report.schema.json',
  'upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json',
  'rollback-proof': 'schemas/registry/rollback-proof.schema.json',
  registry: 'schemas/registry.schema.json',
  'registry-v1': 'schemas/registry.schema.json',
  'version-index': 'schemas/registry/version-index.schema.json',
  'regression-matrix': 'schemas/regression-matrix.schema.json',
  'test-report': 'schemas/test-report.schema.json',
  'behavior-proposal': 'schemas/behavior/behavior-proposal.schema.json',
  'polymorphic-template': 'schemas/polymorphism/polymorphic-template.schema.json',
  'dimension-spec': 'schemas/polymorphism/dimension-spec.schema.json',
  'charter-invariants': 'schemas/charter/charter-invariants.schema.json',
  'integration-install-manifest': 'schemas/integrations/install-manifest.schema.json',
  'agent-pack-manifest': 'schemas/agent-pack/manifest.schema.json',
  'write-intent': 'schemas/governance/write-intent.schema.json',
  'patch-proposal': 'schemas/governance/patch-proposal.schema.json',
  'broker-decision': 'schemas/governance/broker-decision.schema.json',
  'merge-plan': 'schemas/governance/merge-plan.schema.json',
  'break-glass-handoff': 'schemas/governance/break-glass-handoff.schema.json',
  'broker-mutation-request': 'schemas/broker/mutation-request.schema.json',
  'broker-operation-run-record': 'schemas/broker/operation-run-record.schema.json',
  'broker-steward-apply-evidence': 'schemas/broker/steward-apply-evidence.schema.json',
  'broker-conflict-key': 'schemas/broker/conflict-key.schema.json',
  'broker-merge-decision': 'schemas/broker/merge-decision.schema.json',
  'broker-mutation-batch-plan': 'schemas/broker/mutation-batch-plan.schema.json',
  'team-wave-envelope': 'schemas/team-wave-envelope.schema.json',
  'team-worker-report': 'schemas/team-worker-report.schema.json'
};

const supportSchemaEntries: Record<string, string> = {
  'branch-commit-queue': 'schemas/governance/branch-commit-queue.schema.json',
  'test-report-metrics': 'schemas/test-report/metrics.schema.json',
  'team-broker-lane': 'schemas/team-agents/team-broker-lane.schema.json',
  'team-broker-runtime-activation': 'schemas/team-agents/team-broker-runtime-activation.schema.json',
  'team-broker-write-transaction': 'schemas/team-agents/team-broker-write-transaction.schema.json',
  'team-runtime-contract': 'schemas/team-agents/team-runtime-contract.schema.json'
};

const bannedProtectedSurfaceTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['cocos', '-creator'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['draft', '-builder'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['doc', '-id-', 'registry'].join(''),
  ['tools', '_node/'].join(''),
  ['assets', '/scripts/'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message: any) {
  console.error(`[schema:${mode}] ${message}`);
  process.exitCode = 1;
}

function formatErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const addedSchemaIds = new Set<string>();

const supportSchemas = loadSchemas(supportSchemaEntries, { enforceMetadata: false });
const schemas = loadSchemas(schemaEntries, {
  enforceMetadata: true,
  metadataExemptSchemaNames: ['version-index']
});

for (const [schemaName, schema] of supportSchemas.entries()) {
  const schemaId = typeof schema?.$id === 'string' ? schema.$id : schemaName;
  if (!addedSchemaIds.has(schemaId)) {
    ajv.addSchema(schema, schemaName);
    addedSchemaIds.add(schemaId);
  }
}

for (const [schemaName, schema] of schemas.entries()) {
  const schemaId = typeof schema?.$id === 'string' ? schema.$id : schemaName;
  if (!addedSchemaIds.has(schemaId)) {
    ajv.addSchema(schema, schemaName);
    addedSchemaIds.add(schemaId);
  }
}

for (const [schemaName, schema] of supportSchemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${supportSchemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

for (const [schemaName, schema] of schemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${schemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

const atomicSchema = schemas.get('atomic-spec');
const atomicMapSchema = schemas.get('atomic-map');
const performanceBudget = atomicSchema?.$defs?.performanceBudget;
if (performanceBudget?.properties?.hotPath?.type !== 'boolean') {
  fail('atomic-spec performanceBudget.hotPath must be boolean');
}
const inputMutationEnum = performanceBudget?.properties?.inputMutation?.enum || [];
for (const value of ['forbidden', 'allowed', 'clone-on-write']) {
  if (!inputMutationEnum.includes(value)) {
    fail(`atomic-spec performanceBudget.inputMutation missing enum value: ${value}`);
  }
}

const lifecycleModeEnum = atomicSchema?.$defs?.compatibility?.properties?.lifecycleMode?.enum || [];
for (const value of ['birth', 'evolution']) {
  if (!lifecycleModeEnum.includes(value)) {
    fail(`atomic-spec compatibility.lifecycleMode missing enum value: ${value}`);
  }
}
if (atomicSchema?.properties?.lifecycleMode) {
  fail('atomic-spec lifecycleMode must stay under compatibility, not top-level');
}
if (atomicSchema?.$defs?.semanticFingerprint?.pattern !== '^(?:sf:)?sha256:[a-f0-9]{64}$') {
  fail('atomic-spec semanticFingerprint must accept sf:sha256 fingerprints');
}
if (atomicSchema?.$defs?.lineage?.required?.join(',') !== 'bornBy,parentRefs,bornAt') {
  fail('atomic-spec lineage must require bornBy, parentRefs, and bornAt');
}
if (atomicSchema?.$defs?.ttl?.required?.[0] !== 'expiresAt') {
  fail('atomic-spec ttl must require expiresAt');
}
if (!atomicSchema?.properties?.polymorphicTemplateRef) {
  fail('atomic-spec must expose polymorphicTemplateRef');
}
if (!atomicSchema?.properties?.dimensionSpecRef) {
  fail('atomic-spec must expose dimensionSpecRef');
}
if (!atomicSchema?.properties?.lazyInstantiation) {
  fail('atomic-spec must expose lazyInstantiation');
}
for (const value of ['all-env', 'dev-only', 'staging-only', 'test-only']) {
  if (!atomicSchema?.$defs?.deployScope?.enum?.includes(value)) {
    fail(`atomic-spec deployScope missing enum value: ${value}`);
  }
}
for (const value of ['mutable', 'frozen-after-release', 'immutable']) {
  if (!atomicSchema?.$defs?.mutabilityPolicy?.enum?.includes(value)) {
    fail(`atomic-spec mutabilityPolicy missing enum value: ${value}`);
  }
}
if (atomicMapSchema?.properties?.semanticFingerprint?.oneOf?.length !== 2) {
  fail('atomic-map semanticFingerprint must allow string or null');
}
if (atomicMapSchema?.properties?.pendingSfCalculation?.type !== 'boolean') {
  fail('atomic-map pendingSfCalculation must be boolean');
}
if (!atomicMapSchema?.$defs?.member?.properties?.versionLineage) {
  fail('atomic-map member must expose versionLineage');
}
if (atomicMapSchema?.$defs?.versionLineage?.required?.join(',') !== 'currentVersion,versions') {
  fail('atomic-map versionLineage must require currentVersion and versions');
}
if (!atomicMapSchema?.$defs?.versionRecord?.properties?.semanticFingerprint) {
  fail('atomic-map versionRecord must expose semanticFingerprint');
}

const registrySchema = schemas.get('registry');
if (!registrySchema?.$defs?.registryEntry?.properties?.currentVersion) {
  fail('registry atom entry must expose currentVersion');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.versions) {
  fail('registry atom entry must expose versions');
}
if (registrySchema?.$defs?.registryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry atom entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registrySchema?.$defs?.registryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'foundation,governed,standard,experimental') {
  fail('registry atom entry governance.tier enum must be foundation/governed/standard/experimental');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.semanticFingerprint) {
  fail('registry atom entry must expose semanticFingerprint');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.lineageLogRef) {
  fail('registry atom entry must expose lineageLogRef');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.evidenceIndexRef) {
  fail('registry atom entry must expose evidenceIndexRef');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.ttl) {
  fail('registry atom entry must expose ttl');
}
if (!registrySchema?.$defs?.registryVersion?.properties?.semanticFingerprint) {
  fail('registry version record must expose semanticFingerprint');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.semanticFingerprint?.oneOf?.length !== 2) {
  fail('registry map entry must allow semanticFingerprint string or null');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry map entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'foundation,governed,standard,experimental') {
  fail('registry map entry governance.tier enum must be foundation/governed/standard/experimental');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.pendingSfCalculation?.type !== 'boolean') {
  fail('registry map entry must expose pendingSfCalculation');
}

const registryV1Schema = schemas.get('registry-v1');
if (registryV1Schema?.$defs?.registryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry-v1 atom entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registryV1Schema?.$defs?.registryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'foundation,governed,standard,experimental') {
  fail('registry-v1 atom entry governance.tier enum must be foundation/governed/standard/experimental');
}
if (!registryV1Schema?.$defs?.registryVersion?.properties?.semanticFingerprint) {
  fail('registry-v1 version record must expose semanticFingerprint');
}

const policeRegistryCandidateSchema = schemas.get('police-registry-candidate-report');
if (policeRegistryCandidateSchema?.properties?.candidateStatus?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('police registry candidate status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}

const branchCommitQueueSchema = ajv.getSchema('branch-commit-queue');
if (!branchCommitQueueSchema) {
  fail('branch commit queue schema must be registered');
} else {
  const queueEvidence = {
    schemaId: 'atm.branchCommitQueueEvidence.v1',
    serializedBy: 'branch-commit-queue',
    actorId: 'schema-actor',
    taskId: 'TASK-TEAM-SCHEMA-COMMIT',
    branchRef: 'refs/heads/main',
    branchName: 'main',
    headShaAtAcquire: 'abc123schema-before',
    headShaAfterCommit: 'abc123schema-after',
    retryableBusyCode: 'ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY',
    retryableRaceCode: 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'
  };
  if (!branchCommitQueueSchema(queueEvidence)) {
    fail(`branch commit queue schema must accept commit lane evidence: ${formatErrors(branchCommitQueueSchema.errors)}`);
  }
  const queueLock = {
    schemaId: 'atm.branchCommitQueueLock.v1',
    specVersion: '0.1.0',
    actorId: 'schema-actor',
    taskId: 'TASK-TEAM-SCHEMA-COMMIT',
    branchRef: 'refs/heads/main',
    branchName: 'main',
    headShaAtAcquire: 'abc123schema-before',
    createdAt: '2026-06-19T00:00:00.000Z'
  };
  if (!branchCommitQueueSchema(queueLock)) {
    fail(`branch commit queue schema must accept lock record evidence: ${formatErrors(branchCommitQueueSchema.errors)}`);
  }
}

const brokerMutationRequestSchema = ajv.getSchema('broker-mutation-request');
if (!brokerMutationRequestSchema) {
  fail('broker mutation request schema must be registered');
} else {
  const transactionLinkedRequest = {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'schema transaction linkage fixture' },
    requestId: 'req-schema-transaction-link',
    actorId: 'schema-validator',
    taskId: 'TASK-TEAM-SCHEMA-TXN',
    transactionId: 'txn-schema-single',
    transactionIds: ['txn-schema-camel'],
    transaction_ids: ['txn-schema-snake'],
    filePath: 'docs/broker-transaction-link.md',
    op: 'append',
    target: 'EOF',
    value: 'schema transaction linkage'
  };
  if (!brokerMutationRequestSchema(transactionLinkedRequest)) {
    fail(`broker mutation request must accept transaction linkage fields: ${formatErrors(brokerMutationRequestSchema.errors)}`);
  }
}

const teamBrokerWriteTransactionSchema = ajv.getSchema('team-broker-write-transaction');
const teamBrokerLaneSchema = ajv.getSchema('team-broker-lane');
const teamBrokerRuntimeActivationSchema = ajv.getSchema('team-broker-runtime-activation');
const teamRuntimeContractSchema = ajv.getSchema('team-runtime-contract');
if (!teamBrokerWriteTransactionSchema) {
  fail('team broker write transaction schema must be registered');
} else {
  const transactionEvidence = {
    schemaId: 'atm.teamBrokerWriteTransaction.v1',
    transactionId: 'txn-schema-write-transaction',
    taskId: 'TASK-TEAM-SCHEMA-WRITE-TXN',
    principalId: 'schema-principal',
    actorId: 'schema-actor',
    sessionId: 'schema-session',
    instanceId: 'schema-actor@local',
    worktreeId: 'C:/workspace/schema',
    branchRef: 'main',
    baseHead: 'abc123schemahead',
    leaseEpoch: 1,
    allowedFiles: ['src/schema-target.ts'],
    readSet: ['src/schema-target.ts'],
    writeSet: ['src/schema-target.ts'],
    fileHashesBefore: {
      'src/schema-target.ts': 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    },
    brokerDecision: {
      verdict: 'parallel-safe',
      lane: 'direct-brokered',
      intentId: 'intent-schema-write-transaction',
      parallelSafetyReason: 'no-known-textual-or-resource-conflict'
    },
    startedAt: '2026-06-19T00:00:00.000Z',
    expiresAt: '2026-06-19T00:30:00.000Z',
    heartbeatAt: '2026-06-19T00:00:00.000Z'
  };
  if (!teamBrokerWriteTransactionSchema(transactionEvidence)) {
    fail(`team broker write transaction schema must accept the milestone-required fields: ${formatErrors(teamBrokerWriteTransactionSchema.errors)}`);
  }

  if (!teamBrokerLaneSchema) {
    fail('team broker lane schema must be registered');
  } else if (!teamBrokerRuntimeActivationSchema) {
    fail('team broker runtime activation schema must be registered');
  } else {
    const brokerLaneEvidence = {
      schemaId: 'atm.teamBrokerLaneEvidence.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
      actorId: 'schema-actor',
      registryPath: '.atm/runtime/write-broker.registry.json',
      writeIntent: {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'schema broker lane fixture' },
        taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
        actorId: 'schema-actor',
        baseCommit: 'abc123schemahead',
        targetFiles: ['src/schema-target.ts'],
        atomRefs: [],
        sharedSurfaces: {
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        requestedLane: 'auto'
      },
      writeTransaction: transactionEvidence,
      decision: {
        verdict: 'parallel-safe',
        lane: 'direct-brokered',
        reason: 'schema broker lane fixture',
        conflicts: []
      },
      virtualAtomInUseRegistry: {
        schemaId: 'atm.virtualAtomInUseRegistry.v1',
        specVersion: '0.1.0',
        activeVirtualAtoms: []
      },
      chosenLane: 'direct-brokered',
      stewardId: null,
      composerPath: null,
      safeToStart: true,
      blockedReasons: []
    };
    if (!teamBrokerLaneSchema(brokerLaneEvidence)) {
      fail(`team broker lane schema must accept broker decision and write transaction evidence: ${formatErrors(teamBrokerLaneSchema.errors)}`);
    }
    const runtimeActivationEvidence = {
      schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
      actorId: 'schema-actor',
      registryPath: '.atm/runtime/write-broker.registry.json',
      brokerLane: brokerLaneEvidence,
      activationState: 'activated',
      scopedWriteExecution: {
        approved: true,
        allowedFiles: ['src/schema-target.ts'],
        evidencePath: null,
        acceptedInputs: ['PatchProposal', 'MergePlan', 'StewardPlan']
      },
      runtimeBoundary: {
        gitWrite: false,
        taskLifecycle: false,
        selfClose: false
      },
      blockedReasons: []
    };
    if (!teamBrokerRuntimeActivationSchema(runtimeActivationEvidence)) {
      fail(`team broker runtime activation schema must accept broker lane and scoped boundary evidence: ${formatErrors(teamBrokerRuntimeActivationSchema.errors)}`);
    }
  }

  if (!teamRuntimeContractSchema) {
    fail('team runtime contract schema must be registered');
  } else {
    const runtimeContractEvidence = {
      schemaId: 'atm.teamRuntimeContract.v1',
      runtimeMode: 'broker-only',
      runtimeLanguage: 'node',
      runtimeAdapterId: 'atm.node.broker-only-fallback',
      providerId: 'local',
      sdkId: 'nodejs',
      modelId: 'provider-selected',
      agentsSpawned: false,
      executionSurface: 'broker-governance',
      selectionReason: 'broker-only selected by schema fixture',
      workerAdapter: {
        schemaId: 'atm.teamWorkerAdapterContract.v1',
        authorityBoundary: {
          gitWrite: false,
          taskLifecycle: false,
          selfClose: false
        }
      },
      artifactHandoff: {
        schemaId: 'atm.teamArtifactHandoffContract.v1'
      },
      retryBudget: {
        schemaId: 'atm.teamRetryBudgetContract.v1',
        status: 'within-budget'
      },
      commitLane: {
        schemaId: 'atm.teamCommitLaneContract.v1',
        ownerRole: 'coordinator',
        ownerPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
        workerGitWrite: false,
        serializedBy: 'branch-commit-queue',
        lockSchemaId: 'atm.branchCommitQueueLock.v1',
        retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']
      },
      brokerSubagent: {
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
      },
      editorSubagentBridge: {
        schemaId: 'atm.teamEditorSubagentBridgeContract.v1'
      }
    };
    if (!teamRuntimeContractSchema(runtimeContractEvidence)) {
      fail(`team runtime contract schema must accept broker subagent and serialized commit lane evidence: ${formatErrors(teamRuntimeContractSchema.errors)}`);
    }
  }
}

const brokerOperationRunRecordSchema = ajv.getSchema('broker-operation-run-record');
const brokerStewardApplyEvidenceSchema = ajv.getSchema('broker-steward-apply-evidence');
if (!brokerOperationRunRecordSchema) {
  fail('broker operation run record schema must be registered');
} else {
  const operationRunRecordEnvelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'schema operation run fixture' },
    runId: 'run-schema-operation-log',
    planId: 'plan-schema-operation-log',
    records: [
      {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'schema operation run fixture' },
        runId: 'run-schema-operation-log',
        planId: 'plan-schema-operation-log',
        request_identity: ['req-schema-operation-log'],
        actor_ids: ['schema-validator'],
        request_files: ['docs/broker-operation-log.md'],
        adapter_choice: 'text-range',
        applied_files: ['docs/broker-operation-log.md'],
        lane_decision: 'neutral-steward',
        merge_verdict: 'mergeable',
        evidence_path: '.atm/history/evidence/broker-runs/run-schema-operation-log.json',
        task_ids: ['TASK-TEAM-SCHEMA-OPLOG'],
        commit_sha: 'abc123schemaoperation',
        transaction_ids: ['txn-schema-operation-log']
      }
    ]
  };
  if (!brokerOperationRunRecordSchema(operationRunRecordEnvelope)) {
    fail(`broker operation run record schema must accept task/commit/transaction linkage: ${formatErrors(brokerOperationRunRecordSchema.errors)}`);
  }

  if (!brokerStewardApplyEvidenceSchema) {
    fail('broker steward apply evidence schema must be registered');
  } else {
    const stewardApplyEvidence = {
      schemaId: 'atm.stewardApplyEvidence.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'schema steward apply fixture' },
      stewardId: 'neutral-write-steward',
      mergePlanId: 'plan-schema-operation-log',
      proposalIds: ['proposal-schema-steward'],
      targetFiles: ['docs/broker-operation-log.md'],
      appliedFiles: ['docs/broker-operation-log.md'],
      fileBeforeHashes: {
        'docs/broker-operation-log.md': 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      },
      fileAfterHashes: {
        'docs/broker-operation-log.md': 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
      },
      permissions: {
        fileWrite: ['docs/broker-operation-log.md'],
        gitWrite: false,
        taskLifecycle: false,
        selfClose: false
      },
      applyMethod: 'patch-apply',
      verdict: 'applied',
      brokerOperationRun: operationRunRecordEnvelope
    };
    if (!brokerStewardApplyEvidenceSchema(stewardApplyEvidence)) {
      fail(`broker steward apply evidence schema must accept steward boundary and operation linkage: ${formatErrors(brokerStewardApplyEvidenceSchema.errors)}`);
    }
  }
}

const patchProposalSchema = ajv.getSchema('patch-proposal');
if (!patchProposalSchema) {
  fail('patch proposal schema must be registered');
} else {
  const transactionLinkedProposal = {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'schema transaction proposal fixture' },
    proposalId: 'prop-schema-transaction-link',
    taskId: 'TASK-TEAM-SCHEMA-PROP-TXN',
    actorId: 'schema-validator',
    transactionId: 'txn-proposal-single',
    transactionIds: ['txn-proposal-camel'],
    transaction_ids: ['txn-proposal-snake'],
    baseCommit: 'abc123schema',
    fileBeforeHash: 'sha256:abc123schema',
    targetFile: 'docs/broker-proposal-transaction-link.md',
    atomRefs: [{ atomId: 'atom-schema', atomCid: 'cid-schema' }],
    anchors: [{ kind: 'line', hint: 'EOF' }],
    intent: 'schema proposal transaction linkage',
    patch: '@@ -0,0 +1 @@\n+schema proposal transaction linkage',
    validators: ['node --strip-types scripts/validate-schemas.ts --mode validate'],
    rollback: 'revert proposal transaction linkage fixture'
  };
  if (!patchProposalSchema(transactionLinkedProposal)) {
    fail(`patch proposal schema must accept transaction linkage fields: ${formatErrors(patchProposalSchema.errors)}`);
  }
}

const versionIndexSchema = schemas.get('version-index');
if (versionIndexSchema?.minProperties !== 1) {
  fail('version-index must require at least one row');
}
if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.latest) {
  fail('version-index row must expose latest');
}
if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.versions) {
  fail('version-index row must expose versions');
}

const manifestPath = 'tests/schema-fixtures/manifest.json';
const manifest = readJson(manifestPath);
for (const fixture of manifest.positive || []) {
  const validate = ajv.getSchema(fixture.schema);
  if (!validate) {
    fail(`unknown positive fixture schema: ${fixture.schema}`);
    continue;
  }
  const relativePath = `tests/schema-fixtures/${fixture.path}`;
  const valid = validate(readJson(relativePath));
  if (!valid) {
    fail(`positive fixture failed (${fixture.name}): ${formatErrors(validate.errors)}`);
  }
}

for (const fixture of manifest.negative || []) {
  const validate = ajv.getSchema(fixture.schema);
  if (!validate) {
    fail(`unknown negative fixture schema: ${fixture.schema}`);
    continue;
  }
  const relativePath = `tests/schema-fixtures/${fixture.path}`;
  const valid = validate(readJson(relativePath));
  if (valid) {
    fail(`negative fixture unexpectedly passed: ${fixture.name}`);
    continue;
  }
  const matched = (validate.errors || []).some((error) => {
    if (error.keyword !== fixture.expectedKeyword) {
      return false;
    }
    if (fixture.expectedMissingProperty) {
      return error.params?.missingProperty === fixture.expectedMissingProperty;
    }
    return true;
  });
  if (!matched) {
    fail(`negative fixture did not produce expected ${fixture.expectedKeyword}: ${fixture.name}; got ${formatErrors(validate.errors)}`);
  }
}

const protectedFiles = [
  ...Object.values(schemaEntries),
  ...Object.values(supportSchemaEntries),
  'schemas/README.md',
  'scripts/validate-schemas.ts',
  manifestPath,
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'positive')).map((entry) => `tests/schema-fixtures/positive/${entry}`),
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'negative')).map((entry) => `tests/schema-fixtures/negative/${entry}`)
];

const upgradeFixtureDir = path.join(root, 'fixtures', 'upgrade');
if (existsSync(upgradeFixtureDir)) {
  protectedFiles.push(...readdirSync(upgradeFixtureDir).map((entry) => `fixtures/upgrade/${entry}`));
}

const evolutionPatternFixtureDir = path.join(root, 'fixtures', 'evolution', 'evidence-patterns');
if (existsSync(evolutionPatternFixtureDir)) {
  protectedFiles.push(...readdirSync(evolutionPatternFixtureDir).map((entry) => `fixtures/evolution/evidence-patterns/${entry}`));
}

const humanReviewFixtureDir = path.join(root, 'fixtures', 'human-review');
if (existsSync(humanReviewFixtureDir)) {
  protectedFiles.push(...readdirSync(humanReviewFixtureDir).map((entry) => `fixtures/human-review/${entry}`));
}

const rollbackFixtureDir = path.join(root, 'fixtures', 'rollback');
if (existsSync(rollbackFixtureDir)) {
  protectedFiles.push(...readdirSync(rollbackFixtureDir).map((entry) => `fixtures/rollback/${entry}`));
}

for (const relativePath of protectedFiles) {
  const content = readText(relativePath);
  for (const term of bannedProtectedSurfaceTerms) {
    if (content.includes(term)) {
      fail(`${relativePath} contains downstream-only term: ${term}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[schema:${mode}] ok (${Object.keys(schemaEntries).length} schemas, ${manifest.positive.length} positive fixtures, ${manifest.negative.length} negative fixtures)`);
}

function loadSchemas(entries: Record<string, string>, options: any = {}) {
  const loadedSchemas = new Map<string, any>();
  const metadataExemptSchemaNames = new Set(options.metadataExemptSchemaNames ?? []);
  for (const [schemaName, relativePath] of Object.entries(entries)) {
    if (!existsSync(path.join(root, relativePath))) {
      fail(`missing schema file: ${relativePath}`);
      continue;
    }
    const schema = readJson(relativePath);
    if (!schema.$id || !schema.$schema) {
      fail(`${relativePath} must define $id and $schema`);
    }
    if (options.enforceMetadata && !metadataExemptSchemaNames.has(schemaName)) {
      for (const requiredMetadata of ['schemaId', 'specVersion', 'migration']) {
        if (!schema.required?.includes(requiredMetadata)) {
          fail(`${relativePath} must require ${requiredMetadata}`);
        }
      }
    }
    loadedSchemas.set(schemaName, schema);
  }
  return loadedSchemas;
}
