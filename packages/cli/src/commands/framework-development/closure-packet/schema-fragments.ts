import type { FrameworkMode, FrameworkRepoIdentity } from '../closure-packet-schema.ts';

export interface ClosurePacketCommandRun {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly runnerVersion: string;
}

export interface ClosurePacketTargetCommitDelta {
  readonly currentCommitSha: string | null;
  readonly parentCommitShas: readonly string[];
  readonly governedTreeSha: string | null;
  readonly changedFiles: readonly string[];
}

export interface ClosurePacketRequiredGatesSnapshot {
  readonly schemaId: 'atm.requiredGatesSnapshot.v1';
  readonly generatedAt: string;
  readonly source: 'frameworkStatus.requiredGates';
  readonly ruleVersion: string;
  readonly frameworkMode: FrameworkMode;
  readonly repoRole: 'framework' | 'host';
  readonly changedFiles: readonly string[];
  readonly criticalChangedFiles: readonly string[];
  readonly requiredGates: readonly string[];
}

export interface ClosurePacketReconcileAttestation {
  readonly schemaId: 'atm.reconcileAttestation.v1';
  readonly deliveryCommit: string;
  readonly reconciledAt: string;
  readonly reconciledByActor: string;
  readonly reason: string;
}

export interface ClosurePacketRepairMetadata {
  readonly schemaId: 'atm.closurePacketRepair.v1';
  readonly repairedAt: string;
  readonly repairedByCommand: 'atm tasks repair-closure';
  readonly originalPacketCommitSha: string | null;
  readonly repairedTargetCommitSha: string | null;
  readonly evidencePath: string;
}

export interface HistoricalDeliveryProvenance {
  readonly schemaId: 'atm.historicalDeliveryProvenance.v1';
  readonly deliveryCommitSha: string;
  readonly taskMatchedFiles: readonly string[];
  readonly governanceFiles: readonly string[];
  readonly allowedRunnerOutputFiles: readonly string[];
  readonly outOfScopeSourceFiles: readonly string[];
  readonly waivedOutOfScopeFiles: readonly string[];
  readonly waiverReason: string | null;
}

export interface ClosurePacketTeamSummary {
  readonly schemaId: 'atm.closurePacketTeamSummary.v1';
  readonly capturedAt: string;
  readonly source: {
    readonly kind: 'team-run';
    readonly teamRunPath: string;
  };
  readonly teamRunId: string;
  readonly captainDecision: unknown;
  readonly agentReports: readonly unknown[];
  readonly patrolFindings: readonly unknown[];
  readonly evidenceCuratorSummary: unknown;
  readonly teamSummary: unknown;
}

export interface ClosurePacket {
  readonly schemaId: 'atm.closurePacket.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly targetRepoIdentity: FrameworkRepoIdentity;
  readonly targetCommit: string | null;
  readonly governedTreeSha: string | null;
  readonly targetCommitDelta: ClosurePacketTargetCommitDelta;
  readonly closedByCommand: 'atm tasks close';
  readonly commandRuns: readonly ClosurePacketCommandRun[];
  readonly validationPasses: readonly string[];
  readonly evidenceFreshness: 'fresh' | 'historical-reference' | 'draft';
  readonly requiredGates: readonly string[];
  readonly requiredGatesSnapshot: ClosurePacketRequiredGatesSnapshot;
  readonly evidencePath: string;
  readonly closedAt: string;
  readonly closedByActor: string;
  readonly sessionId: string | null;
  readonly attestation?: ClosurePacketReconcileAttestation | null;
  readonly repair?: ClosurePacketRepairMetadata | null;
  readonly historicalDeliveryProvenance?: HistoricalDeliveryProvenance | null;
  readonly teamSummary?: ClosurePacketTeamSummary | null;
  readonly recoveredFromMissingPacket?: boolean;
}
