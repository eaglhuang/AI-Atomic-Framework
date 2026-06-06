export interface SemanticFingerprintPortRecord {
    readonly name: string;
    readonly kind: string;
    readonly required?: boolean;
}
export interface AtomicSpecSemanticFingerprintInput {
    readonly inputs?: readonly SemanticFingerprintPortRecord[];
    readonly outputs?: readonly SemanticFingerprintPortRecord[];
    readonly language?: {
        readonly primary?: string | null;
    };
    readonly validation?: {
        readonly evidenceRequired?: boolean | null;
    };
    readonly performanceBudget?: Readonly<Record<string, unknown>> | null;
}
export interface AtomicMapSemanticFingerprintInput {
    readonly entrypoints?: readonly string[];
    readonly qualityTargets?: Readonly<Record<string, string | number | boolean>>;
}
export declare function createAtomicSpecSemanticFingerprint(input: AtomicSpecSemanticFingerprintInput): string;
export declare function createAtomicMapSemanticFingerprint(input: AtomicMapSemanticFingerprintInput): string;
export declare function normalizeSemanticFingerprint(value: unknown): string | null;
export declare function semanticFingerprintPrefix(fingerprint: unknown, length?: number): string;
export declare class SemanticFingerprintError extends Error {
    constructor(code: string, message: string, details?: Record<string, unknown>);
    readonly code: string;
    readonly details: Record<string, unknown>;
}
