import type { ReplacementMode } from './constants.ts';
export type ReplacementModeValue = typeof ReplacementMode[keyof typeof ReplacementMode];
export type ReplacementModeWithEvidence = Exclude<ReplacementModeValue, 'draft'>;
export interface ReplacementTransitionInput {
    readonly from: ReplacementModeValue;
    readonly to: ReplacementModeValue;
    readonly evidenceRefs: readonly string[];
    readonly canonicalMapId: string;
    readonly repositoryRoot: string;
}
export interface ReplacementLaneEvidenceInput {
    readonly evidenceRefs?: unknown;
    readonly reason?: unknown;
}
export interface ReplacementLaneOptions {
    readonly repositoryRoot?: string;
    readonly now?: unknown;
    readonly actor?: unknown;
}
export interface EvidenceDocumentRecord {
    readonly schemaId?: string;
    readonly mapId?: string;
    readonly passed?: boolean;
    readonly targetKind?: string;
    readonly verificationStatus?: string;
    readonly status?: string;
    readonly reportId?: string;
    readonly decision?: string;
    readonly advisoryUnavailable?: boolean;
    readonly target?: {
        readonly kind?: string;
        readonly id?: string | null;
    } | null;
    readonly queueRecord?: {
        readonly status?: string;
        readonly proposal?: {
            readonly target?: {
                readonly mapId?: string | null;
            } | null;
        } | null;
    } | null;
    readonly proposal?: {
        readonly target?: {
            readonly mapId?: string | null;
        } | null;
    } | null;
    readonly transitions?: unknown[];
    readonly canonicalMapId?: string;
    readonly generatedAt?: string;
    readonly specVersion?: string;
}
export interface LoadedEvidenceDocument {
    readonly path: string;
    readonly absolutePath: string;
    readonly document: EvidenceDocumentRecord | null;
    readonly error: string | null;
}
export interface EvidenceCheckResult {
    readonly passed: boolean;
    readonly path: string | null;
}
export interface ReplacementLaneValidationResult {
    readonly ok: boolean;
    readonly issues?: readonly string[];
}
export interface TransitionAppendInput {
    readonly mapId: string;
    readonly generatedAt: string;
    readonly transitionRecord: Record<string, unknown>;
}
export declare function asRecord<T extends object>(value: unknown): T | null;
