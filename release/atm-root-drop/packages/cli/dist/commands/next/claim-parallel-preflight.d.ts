import { type BrokerQueueAdmission } from './broker-queue-admission.ts';
import { type ProposalLaneAdmission } from './proposal-lane.ts';
import type { NextClaimIntent } from './claim-readiness.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';
export declare function runClaimParallelPreflight(input: {
    readonly cwd: string;
    readonly claimableTask: ImportedTaskSummary;
    readonly actorId: string;
    readonly claimIntent: NextClaimIntent;
    readonly claimAllowedFiles: readonly string[];
}): Promise<{
    readonly parallelAdvisory: Record<string, unknown> | undefined;
    readonly brokerQueueAdmission: BrokerQueueAdmission | undefined;
    readonly proposalLaneAdmission: ProposalLaneAdmission | undefined;
    readonly claimAllowedFiles: readonly string[];
}>;
