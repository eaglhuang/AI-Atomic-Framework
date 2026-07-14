import type { ClosurePacketValidationIssue } from './validator-contract.ts';
export declare function summarizeSha256ActualValue(value: unknown): string;
export declare function pushSha256ValidationIssue(issues: {
    missing: string[];
    invalidFormat: ClosurePacketValidationIssue[];
}, path: string, value: unknown): void;
