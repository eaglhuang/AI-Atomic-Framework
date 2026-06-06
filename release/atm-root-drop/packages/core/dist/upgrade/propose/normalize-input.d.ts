/**
 * normalize-input.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * Input 規範化相關函式：把外部傳入的 upgrade proposal inputs 轉成
 * 標準化的內部格式，供 proposeAtomicUpgrade 使用。
 */
export declare const INPUT_KIND_PRIORITY: Map<string, number>;
export declare function inferInputKind(kindOrSchemaId: any): "quality-comparison" | "rollback-proof" | "review-advisory" | "map-equivalence" | "hash-diff" | "execution-evidence" | "non-regression" | "registry-candidate" | "polymorph-impact" | "propagation-report" | "human-review" | "retirement-proof";
export declare function unwrapKnownInputDocument(document: any): any;
export declare function resolveInputSchemaId(kind: any, document: any): any;
export declare function createInputSummary(kind: any): "hash-diff input" | "execution-evidence input" | "non-regression input" | "quality-comparison input" | "registry-candidate input" | "map-equivalence input" | "polymorph-impact input" | "propagation-report input" | "review-advisory input" | "human-review input" | "rollback-proof input" | "retirement-proof input" | "upgrade-input";
export declare function normalizeInputDocument(input: any): {
    kind: string;
    path: any;
    document: any;
};
export declare function findInput(inputs: any, expectedKind: any): any;
export declare function requireInput(inputs: any, expectedKind: any): any;
export declare function buildInputRefs(inputs: any): any[];
