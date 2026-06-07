export interface MigrationRecord {
  readonly strategy: 'none' | 'additive' | 'breaking';
  readonly fromVersion: string | null;
  readonly notes: string;
}

export interface WriteIntentAtomRef {
  readonly atomId: string;
  readonly atomCid: string;
  readonly operation: 'create' | 'modify' | 'delete';
}

export interface SharedSurfacesRecord {
  readonly generators: readonly string[];
  readonly projections: readonly string[];
  readonly registries: readonly string[];
  readonly validators: readonly string[];
  readonly artifacts: readonly string[];
}

export interface WriteIntent {
  readonly schemaId: 'atm.writeIntent.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly targetFiles: readonly string[];
  readonly atomRefs: readonly WriteIntentAtomRef[];
  readonly sharedSurfaces: SharedSurfacesRecord;
  readonly requestedLane: 'auto' | 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
}

export interface ProposalAtomRef {
  readonly atomId: string;
  readonly atomCid: string;
}

export interface PatchAnchor {
  readonly kind: string;
  readonly hint: string;
}

export interface PatchProposal {
  readonly schemaId: 'atm.patchProposal.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly proposalId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly fileBeforeHash: string;
  readonly targetFile: string;
  readonly atomRefs: readonly ProposalAtomRef[];
  readonly anchors: readonly PatchAnchor[];
  readonly intent: string;
  readonly patch: string;
  readonly validators: readonly string[];
  readonly rollback: string;
}

export interface ConflictDetail {
  readonly kind: 'cid' | 'file-range' | 'generator' | 'projection' | 'validator' | 'artifact' | 'lease';
  readonly detail: string;
}

export interface BrokerDecision {
  readonly schemaId: 'atm.brokerDecision.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly intentId: string;
  readonly taskId: string;
  readonly verdict: 'parallel-safe' | 'needs-physical-split' | 'blocked-cid-conflict' | 'blocked-shared-surface' | 'serial' | 'blocked-active-lease';
  readonly lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked';
  readonly conflicts: readonly ConflictDetail[];
  readonly stewardId?: string | null;
  readonly applyMethod: 'patch-apply' | 'ast-rewrite' | 'git-three-way-fallback' | 'steward-authored-final-patch' | 'none';
  readonly reason: string;
}

export interface MergePlan {
  readonly schemaId: 'atm.mergePlan.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly mergePlanId: string;
  readonly inputProposals: readonly string[];
  readonly verdict: 'parallel-safe' | 'needs-steward' | 'blocked-cid-conflict' | 'blocked-shared-surface';
  readonly conflicts: readonly ConflictDetail[];
  readonly applyMethod: 'patch-apply' | 'ast-rewrite' | 'git-three-way-fallback' | 'steward-authored-final-patch';
  readonly requiredEvidence: readonly string[];
}

export interface BreakGlassCidCheck {
  readonly verdict: 'disjoint' | 'conflict';
  readonly leadAtomCid: string;
  readonly donorAtomCid: string;
}

export interface BreakGlassAcceptanceSplit {
  readonly leadTaskAcceptance: readonly string[];
  readonly donorTaskAcceptance: readonly string[];
}

export interface BreakGlassHandoff {
  readonly schemaId: 'atm.breakGlassHandoff.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly reason: 'write-agent-unavailable' | 'steward-pool-exhausted' | 'emergency-unblock';
  readonly captainApproval: true;
  readonly leadActorId: string;
  readonly donorActorId: string;
  readonly leadTaskId: string;
  readonly donorTaskId: string;
  readonly cidCheck: BreakGlassCidCheck;
  readonly transferredIntent: string;
  readonly expandedScope: readonly string[];
  readonly forbiddenExpansion: readonly string[];
  readonly acceptanceSplit: BreakGlassAcceptanceSplit;
  readonly rollback: string;
}
