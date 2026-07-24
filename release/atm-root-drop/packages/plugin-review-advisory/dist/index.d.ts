import type { ConversationPatchDraftReport } from '@ai-atomic-framework/plugin-sdk';
import { mapConversationPatchDraftsToMachineFindings } from './conversation-machine-findings.ts';
export { checkPromotionSafetyGates } from './promotion-gates.ts';
export type { PromotionSafetyGateName, PromotionSafetyFinding, PromotionSafetyGateResult, PromotionSafetyContext, ProposalForSafetyCheck } from './promotion-gates.ts';
export { mapConversationPatchDraftsToMachineFindings };
export declare const pluginReviewAdvisoryPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-review-advisory";
    readonly packageRole: "semantic-review-advisory-provider";
    readonly packageVersion: "0.0.0";
};
export type AdvisoryProviderMode = 'stub' | 'agent-bridge' | 'external-cli';
export type AdvisorySeverity = 'high' | 'medium' | 'low' | 'info';
export type AdvisoryStatus = 'ok' | 'warn' | 'advisory-unavailable';
export interface AdvisoryProviderInfo {
    mode: AdvisoryProviderMode;
    providerId: string;
    providerVersion?: string;
    transport?: string;
}
export interface ReviewAdvisoryFinding {
    id: string;
    severity: AdvisorySeverity;
    trigger: 'semantic-anomaly' | 'behavior-route-risk' | 'policy-coverage-gap' | 'provider-health' | 'machine-finding';
    scope?: 'atom' | 'map' | 'proposal' | 'diff' | 'registry' | 'queue' | 'runtime';
    action: 'none' | 'monitor' | 'needs-review' | 'request-human-review' | 'provider-retry';
    routeHint?: string;
    message: string;
    evidenceRefs?: string[];
    metadata?: Record<string, unknown>;
}
export interface ReviewAdvisoryTarget {
    kind: 'atom' | 'map' | 'proposal' | 'diff' | 'scope';
    id?: string;
    sourcePaths?: string[];
}
export interface ReviewAdvisoryReport {
    schemaVersion: '1.0.0';
    reportId: string;
    status: AdvisoryStatus;
    provider: AdvisoryProviderInfo;
    generatedAt: string;
    target: ReviewAdvisoryTarget;
    summary: Record<AdvisorySeverity, number>;
    findings: ReviewAdvisoryFinding[];
    supplementalContext?: {
        humanReviewQueue?: {
            attachable: boolean;
            queuePath?: string;
            proposalId?: string;
            queueRecordStatus?: string;
        };
    };
    standardsSpecReceipt?: StandardsSpecReviewReceipt;
    advisoryUnavailable: boolean;
    needsReview: boolean;
    unavailableReasons?: string[];
}
export type StandardsSpecReviewDisposition = 'accepted' | 'resolved' | 'unresolved' | 'waived';
export interface StandardsSpecReviewReceipt {
    schemaId: 'atm.standardsSpecReviewReceipt.v1';
    taskId: string;
    baseRef: string;
    candidateRef: string;
    candidateDigest: string;
    standardsDigest: string;
    specDigest: string;
    provider: AdvisoryProviderInfo;
    reviewedAt: string;
    dispositions: Array<{
        findingId: string;
        axis: 'standards' | 'spec';
        disposition: StandardsSpecReviewDisposition;
        reason?: string;
    }>;
}
export interface ReviewAdvisoryReportInit {
    reportId: string;
    status?: AdvisoryStatus;
    provider: AdvisoryProviderInfo;
    generatedAt?: string;
    target: ReviewAdvisoryTarget;
    findings?: ReviewAdvisoryFinding[];
    unavailableReasons?: string[];
    standardsSpecReceipt?: StandardsSpecReviewReceipt;
}
export declare function createReviewAdvisoryReport(init: ReviewAdvisoryReportInit): ReviewAdvisoryReport;
export declare function createConversationPatchDraftAdvisoryReport(input: {
    reportId: string;
    patchDraftReport: ConversationPatchDraftReport;
    generatedAt?: string;
    target?: ReviewAdvisoryTarget;
}): ReviewAdvisoryReport;
export declare function createUnavailableAdvisoryReport(input: {
    reportId: string;
    provider: AdvisoryProviderInfo;
    target: ReviewAdvisoryTarget;
    reason: string;
}): ReviewAdvisoryReport;
export declare function createStubReviewAdvisoryReport(input: {
    profile: 'pass' | 'warn' | 'unavailable';
    reportId: string;
    target: ReviewAdvisoryTarget;
}): ReviewAdvisoryReport;
export declare function appendMachineFindings(report: ReviewAdvisoryReport, machineFindings: Array<{
    id: string;
    severity?: AdvisorySeverity;
    message: string;
    routeHint?: string;
    evidenceRef?: string;
    evidenceRefs?: string[];
    metadata?: Record<string, unknown>;
}>): ReviewAdvisoryReport;
export declare function attachStandardsSpecReviewReceipt(report: ReviewAdvisoryReport, receipt: StandardsSpecReviewReceipt): ReviewAdvisoryReport;
export declare function inspectStandardsSpecReviewReceipt(input: {
    report: ReviewAdvisoryReport | null | undefined;
    taskId: string;
    candidateDigest: string;
}): {
    ok: true;
} | {
    ok: false;
    reason: string;
    unresolvedFindingIds: string[];
};
export declare function normalizeProviderPayload(payload: unknown, fallback: {
    reportId: string;
    provider: AdvisoryProviderInfo;
    target: ReviewAdvisoryTarget;
}): {
    ok: true;
    report: ReviewAdvisoryReport;
} | {
    ok: false;
    issues: string[];
    report: ReviewAdvisoryReport;
};
declare const _default: {
    pluginReviewAdvisoryPackage: {
        readonly packageName: "@ai-atomic-framework/plugin-review-advisory";
        readonly packageRole: "semantic-review-advisory-provider";
        readonly packageVersion: "0.0.0";
    };
    createReviewAdvisoryReport: typeof createReviewAdvisoryReport;
    createConversationPatchDraftAdvisoryReport: typeof createConversationPatchDraftAdvisoryReport;
    createUnavailableAdvisoryReport: typeof createUnavailableAdvisoryReport;
    createStubReviewAdvisoryReport: typeof createStubReviewAdvisoryReport;
    appendMachineFindings: typeof appendMachineFindings;
    attachStandardsSpecReviewReceipt: typeof attachStandardsSpecReviewReceipt;
    inspectStandardsSpecReviewReceipt: typeof inspectStandardsSpecReviewReceipt;
    mapConversationPatchDraftsToMachineFindings: typeof mapConversationPatchDraftsToMachineFindings;
    normalizeProviderPayload: typeof normalizeProviderPayload;
};
export default _default;
