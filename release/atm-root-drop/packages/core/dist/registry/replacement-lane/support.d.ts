import type { ReplacementModeValue, TransitionAppendInput } from './types.ts';
export declare function normalizeReplacementMode(value: string): ReplacementModeValue;
export declare function isReplacementModeValue(value: string): value is ReplacementModeValue;
export declare function requiresEvidence(mode: ReplacementModeValue): mode is "active" | "shadow" | "canary" | "legacy-retired";
export declare function normalizeEvidenceRefs(value: unknown): string[];
export declare function mergeStringArrays(...groups: unknown[]): string[];
export declare function normalizeReason(value: unknown, fallback: string): string;
export declare function normalizeActor(value: unknown): string;
export declare function normalizeTimestamp(value: unknown): string;
export declare function defaultTransitionReason(from: string, to: string): string;
export declare function resolveRegistryLifecycleStatus(targetMode: ReplacementModeValue, currentStatus: string): string;
export declare function appendTransitionRecord(existingLog: unknown, input: TransitionAppendInput): {
    canonicalMapId: string;
    generatedAt: string;
    transitions: unknown[];
    schemaId: string;
    mapId?: string;
    passed?: boolean;
    targetKind?: string;
    verificationStatus?: string;
    status?: string;
    reportId?: string;
    decision?: string;
    advisoryUnavailable?: boolean;
    target?: {
        readonly kind?: string;
        readonly id?: string | null;
    } | null;
    queueRecord?: {
        readonly status?: string;
        readonly proposal?: {
            readonly target?: {
                readonly mapId?: string | null;
            } | null;
        } | null;
    } | null;
    proposal?: {
        readonly target?: {
            readonly mapId?: string | null;
        } | null;
    } | null;
    specVersion: string;
};
export declare function readJson(filePath: string): any;
export declare function writeJson(filePath: string, value: unknown): void;
export declare function createReplacementLaneError(code: string, message: string, details: Record<string, unknown>): Error & {
    code: string;
    details: Record<string, unknown>;
};
