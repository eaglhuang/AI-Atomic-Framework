export declare const MICRO_EVIDENCE_RECEIPT_SCHEMA_ID = "atm.microEvidenceReceipt.v1";
export declare const VALIDATION_RECEIPT_INDEX_SCHEMA_ID = "atm.validationReceiptIndex.v1";
export type ValidationReceiptStatus = 'passed' | 'failed' | 'timeout';
export interface ValidationReceiptScopeFile {
    readonly path: string;
    readonly sha256: string | null;
    readonly mtimeMs: number | null;
    readonly size: number | null;
    readonly missing: boolean;
}
export interface ValidationReceiptScope {
    readonly strategy: 'conservative-files';
    readonly files: readonly ValidationReceiptScopeFile[];
}
export interface MicroEvidenceReceipt {
    readonly schemaId: typeof MICRO_EVIDENCE_RECEIPT_SCHEMA_ID;
    readonly receiptId: string;
    readonly validatorName: string;
    readonly command: string;
    readonly status: ValidationReceiptStatus;
    readonly ok: boolean;
    readonly environment: {
        readonly platform: string;
        readonly nodeVersion: string;
    };
    readonly base: {
        readonly gitHead: string | null;
    };
    readonly payloadDigest: string;
    readonly scopeDigest: string;
    readonly reuseKey: string;
    readonly createdAt: string;
    readonly result: Record<string, unknown>;
    readonly scope: ValidationReceiptScope;
}
export interface ValidationReceiptWriteResult {
    readonly receipt: MicroEvidenceReceipt;
    readonly receiptPath: string;
    readonly indexPath: string;
    readonly attempts: number;
}
export interface ValidationReceiptReuseResult {
    readonly reusable: boolean;
    readonly receipt: MicroEvidenceReceipt | null;
    readonly reason: string | null;
    readonly receiptPath: string | null;
}
export declare function validationReceiptStoreRoot(cwd: string): string;
export declare function validationReceiptIndexPath(cwd: string, reuseKey: string): string;
export declare function validationReceiptContentPath(cwd: string, receiptId: string): string;
export declare function buildValidationReceiptInput(input: {
    cwd: string;
    validatorName: string;
    command: string;
    status: ValidationReceiptStatus;
    ok: boolean;
    gitHead: string | null;
    result: Record<string, unknown>;
    scopePaths: readonly string[];
    createdAt?: string;
}): MicroEvidenceReceipt;
export declare function writeValidationReceipt(cwd: string, receipt: MicroEvidenceReceipt): ValidationReceiptWriteResult;
export declare function readReusableValidationReceipt(input: {
    cwd: string;
    validatorName: string;
    command: string;
    gitHead: string | null;
    scopePaths: readonly string[];
}): ValidationReceiptReuseResult;
export declare function garbageCollectValidationReceipts(input: {
    cwd: string;
    keepLatestPerKey?: number;
}): {
    removed: readonly string[];
};
