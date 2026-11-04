import type { RunnerSelectionQualificationCaseResult, RunnerSelectionQualificationReport, RunnerSelectionVerificationCase, RunnerSelectionVerificationPorts } from './runner-selection-verification-ports.js';
export declare function verifyRunnerSelection(input: {
    readonly ports: RunnerSelectionVerificationPorts;
    readonly generatedAt: string;
    readonly policyVersion?: string;
    readonly sealedIndependentReport?: boolean;
    readonly ownerApprovedPromotionRecord?: boolean;
}): RunnerSelectionQualificationReport;
export declare function verifyRunnerSelectionCase(verificationCase: RunnerSelectionVerificationCase, generatedAt: string): RunnerSelectionQualificationCaseResult;
