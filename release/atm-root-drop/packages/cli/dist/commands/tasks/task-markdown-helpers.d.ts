/**
 * task-markdown-helpers.ts
 *
 * Markdown parsing / metadata-packing helpers extracted from tasks.ts.
 * These functions are pure (no side effects) and work with generic interfaces
 * to avoid circular dependency issues.
 */
/** 任何帶 heading + lines 的 section（不含 headingLine，與 tasks.ts local HeadingSection 相容） */
export interface HeadingSection {
    readonly heading: string;
    readonly lines: readonly string[];
}
/** TaskTableMetadata 的最小公因子（與 tasks.ts local 對齊） */
export interface TaskTableMetadata {
    readonly workItemId: string;
    readonly title: string;
    readonly status: string;
    readonly milestone: string | null;
    readonly dependencies: readonly string[];
    readonly deliverables: readonly string[];
    readonly rowText: string;
    readonly headingLine: number;
}
/**
 * createTaskFromTableMetadata 回傳的最小結構，
 * 不 import tasks.ts 的 TaskImportRecord（避免循環依賴），
 * 改由呼叫方做型別斷言。
 */
export interface TaskImportRecordShape {
    readonly schemaVersion: 'atm.workItem.v0.2';
    readonly workItemId: string;
    readonly title: string;
    readonly status: string;
    readonly milestone: string | null;
    readonly dependencies: readonly string[];
    readonly acceptance: readonly string[];
    readonly deliverables: readonly string[];
    readonly tags: readonly string[];
    readonly notes: null;
    readonly source: {
        readonly planPath: string;
        readonly sectionTitle: string;
        readonly headingLine: number;
        readonly hash: string;
    };
    readonly importedAt: string;
}
/**
 * Collects a key-value pair from markdown Heading Sections.
 */
export declare function collectKeyValue(sections: readonly HeadingSection[], key: string): string | null;
/**
 * Collects a key-value pair from raw line lists.
 */
export declare function collectKeyValueFromLines(lines: readonly string[], key: string): string | null;
/**
 * Packs table metadata into structural TaskImportRecord-compatible format.
 * hashSection 由呼叫方透過 createContext 傳入，避免循環依賴。
 */
export declare function createTaskFromTableMetadata(input: {
    readonly metadata: TaskTableMetadata;
    readonly planRelativePath: string;
    readonly importedAt: string;
    readonly hashSection: (text: string) => string;
}): TaskImportRecordShape;
/** Compact phase fence preserved for sidecar / mailbox materialization kickoff. */
export interface TaskDispatchPhase {
    readonly lane?: string | null;
    readonly allowedFiles?: readonly string[];
    readonly forbiddenFiles?: readonly string[];
    readonly allowedFilesStrict?: boolean;
    readonly commitBudget?: number | null;
    readonly commitLayout?: readonly string[];
    readonly output?: string | null;
}
/** Canonical dispatch metadata shape written to task ledger JSON. */
export interface TaskDispatchPattern {
    readonly shape?: string | null;
    readonly rationale?: string | null;
    readonly parallelWith?: string | null;
    readonly phase0?: TaskDispatchPhase;
    readonly phase1?: TaskDispatchPhase;
}
export interface TaskDispatchMetadata {
    readonly dispatchPattern?: TaskDispatchPattern;
    readonly conditionReview?: readonly string[];
    readonly mailboxAssignee?: string | null;
}
export declare const MAX_DISPATCH_METADATA_BYTES = 8192;
/**
 * Parse bounded dispatch metadata from a task-card markdown document.
 * Uses block-aware YAML parsing because flat extractFrontMatter corrupts nested dispatch_pattern trees.
 */
export declare function parseDispatchMetadataFromPlanText(planText: string): TaskDispatchMetadata;
export declare function assertDispatchMetadataMaterializable(metadata: TaskDispatchMetadata, workItemId: string): readonly string[];
