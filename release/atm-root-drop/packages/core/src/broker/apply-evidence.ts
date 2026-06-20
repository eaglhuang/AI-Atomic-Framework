import type { BrokerMutationEvidenceEntry, BrokerOperationRunRecordEnvelope, MergePlan, MigrationRecord } from './types.ts';

export interface StewardPermissionBoundary {
  readonly fileWrite: readonly string[];
  readonly gitWrite: false;
  readonly taskLifecycle: false;
  readonly selfClose: false;
}

export interface StewardApplyEvidence {
  readonly schemaId: 'atm.stewardApplyEvidence.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly stewardId: string;
  readonly mergePlanId: string;
  readonly proposalIds: readonly string[];
  readonly targetFiles: readonly string[];
  readonly appliedFiles: readonly string[];
  readonly fileBeforeHashes: Readonly<Record<string, string>>;
  readonly fileAfterHashes: Readonly<Record<string, string>>;
  readonly permissions: StewardPermissionBoundary;
  readonly applyMethod: MergePlan['applyMethod'];
  readonly verdict: 'applied' | 'blocked';
  readonly blockedReasons?: readonly string[];
  readonly mutationEvidence?: readonly BrokerMutationEvidenceEntry[];
  readonly brokerOperationRun?: BrokerOperationRunRecordEnvelope;
}

export const defaultStewardApplyMigration: MigrationRecord = {
  strategy: 'none',
  fromVersion: null,
  notes: 'neutral write steward apply'
};

export function buildStewardApplyEvidence(input: {
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposalIds: readonly string[];
  readonly targetFiles: readonly string[];
  readonly appliedFiles: readonly string[];
  readonly fileBeforeHashes: Readonly<Record<string, string>>;
  readonly fileAfterHashes: Readonly<Record<string, string>>;
  readonly verdict: StewardApplyEvidence['verdict'];
  readonly blockedReasons?: readonly string[];
  readonly mutationEvidence?: readonly BrokerMutationEvidenceEntry[];
  readonly brokerOperationRun?: BrokerOperationRunRecordEnvelope;
}): StewardApplyEvidence {
  return {
    schemaId: 'atm.stewardApplyEvidence.v1',
    specVersion: '0.1.0',
    migration: defaultStewardApplyMigration,
    stewardId: input.stewardId,
    mergePlanId: input.mergePlan.mergePlanId,
    proposalIds: [...input.proposalIds].sort((left, right) => left.localeCompare(right)),
    targetFiles: [...input.targetFiles].sort((left, right) => left.localeCompare(right)),
    appliedFiles: [...input.appliedFiles].sort((left, right) => left.localeCompare(right)),
    fileBeforeHashes: input.fileBeforeHashes,
    fileAfterHashes: input.fileAfterHashes,
    permissions: {
      fileWrite: [...input.targetFiles].sort((left, right) => left.localeCompare(right)),
      gitWrite: false,
      taskLifecycle: false,
      selfClose: false
    },
    applyMethod: input.mergePlan.applyMethod,
    verdict: input.verdict,
    blockedReasons: input.blockedReasons ? [...input.blockedReasons] : undefined,
    // Omit the field entirely when not supplied so existing deepEqual-based
    // evidence tests (which do not expect the key) keep passing.
    ...(input.mutationEvidence ? { mutationEvidence: [...input.mutationEvidence] } : {}),
    ...(input.brokerOperationRun ? { brokerOperationRun: input.brokerOperationRun } : {})
  };
}
