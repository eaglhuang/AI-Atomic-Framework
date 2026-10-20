import type { BrokerConflictMatrix, BrokerDecision, ConflictDetail, ProposalAdmissionEvidence, WriteBrokerRegistryDocument, WriteIntent } from '../types.js';
import type { SerialQueueReason } from '../serial-queue/contracts.js';
/** Only proven, ready write/write conflicts may wait; hard guards run before this classifier. */
export declare function hotSerialBlockers(intent: WriteIntent, registry: WriteBrokerRegistryDocument, base: ProposalAdmissionEvidence): readonly string[];
export declare function coldSerialBlockers(intent: WriteIntent, registry: WriteBrokerRegistryDocument): readonly string[];
export declare function serialDecision(intent: WriteIntent, base: ProposalAdmissionEvidence, matrix: BrokerConflictMatrix, reason: string, blockers: readonly string[], conflicts?: readonly ConflictDetail[], queueReason?: SerialQueueReason): BrokerDecision;
export declare function pendingSerialDecision(intent: WriteIntent, registry: WriteBrokerRegistryDocument, base: ProposalAdmissionEvidence, matrix: BrokerConflictMatrix, revalidatedTicketId?: string): BrokerDecision | null;
