import { ajv, fail, formatErrors, schemas } from './context.ts';

export function validateCoreSchemaContracts() {
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
      headShaAtCommitStart: 'abc123schema-before',
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
      ownerPid: 12345,
      createdAt: '2026-06-19T00:00:00.000Z'
    };
    if (!branchCommitQueueSchema(queueLock)) {
      fail(`branch commit queue schema must accept lock record evidence: ${formatErrors(branchCommitQueueSchema.errors)}`);
    }
  }
}
