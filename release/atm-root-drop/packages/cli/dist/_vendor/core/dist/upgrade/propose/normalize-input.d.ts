/**
 * normalize-input.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * Input 規範化相關函式：把外部傳入的 upgrade proposal inputs 轉成
 * 標準化的內部格式，供 proposeAtomicUpgrade 使用。
 */
export declare const INPUT_KIND_PRIORITY: Map<string, number>;
type InputKind = 'hash-diff' | 'execution-evidence' | 'non-regression' | 'quality-comparison' | 'registry-candidate' | 'map-equivalence' | 'polymorph-impact' | 'propagation-report' | 'review-advisory' | 'human-review' | 'rollback-proof' | 'retirement-proof';
interface InputDocument {
    schemaId?: string;
    expectedReport?: Record<string, unknown>;
    evidence?: {
        propagationReport?: Record<string, unknown>;
        report?: Record<string, unknown>;
        decisionLog?: Record<string, unknown>;
    };
    reportId?: string;
    proofId?: string;
    evidenceId?: string;
    [key: string]: unknown;
}
interface RawInput {
    kind?: string;
    document?: Record<string, unknown>;
    report?: Record<string, unknown>;
    value?: Record<string, unknown>;
    path?: string;
    reportPath?: string;
    evidencePath?: string;
}
interface NormalizedInput {
    kind: InputKind;
    path: string;
    document: Record<string, unknown>;
}
interface InputRef {
    kind: InputKind;
    path: string;
    schemaId: string;
    summary: string;
    reportId?: string;
}
export declare function inferInputKind(kindOrSchemaId: string): InputKind;
export declare function unwrapKnownInputDocument(document: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined;
export declare function resolveInputSchemaId(kind: InputKind, document: InputDocument): string;
export declare function createInputSummary(kind: InputKind): string;
export declare function normalizeInputDocument(input: RawInput): NormalizedInput;
export declare function findInput(inputs: NormalizedInput[], expectedKind: InputKind): NormalizedInput | null;
export declare function requireInput(inputs: NormalizedInput[], expectedKind: InputKind): NormalizedInput;
export declare function buildInputRefs(inputs: NormalizedInput[]): InputRef[];
export {};
