/**
 * task-import-validators.ts
 *
 * L2 原子化切片（TASK-AAO-0064）：從 tasks.ts 搬移的純函式，
 * 涵蓋 YAML/frontmatter 解析、路徑正規化、嚴格路徑啟發式驗證。
 *
 * 規則：
 * - 此模組只含純函式（無 fs 副作用，hashSection 除外使用 Node crypto）
 * - extractTaskDeclaredFiles 含 Record 迭代但無磁碟 I/O
 * - 禁止從此模組反向 import tasks.ts
 */
export interface FrontMatter {
    readonly data: Record<string, unknown>;
    readonly endIndex: number;
    readonly headingLine: number;
}
/**
 * 從 markdown 文字提取 YAML frontmatter。
 * 對應 tasks.ts L4879（原 extractFrontMatter）。
 */
export declare function extractFrontMatter(text: string): FrontMatter | null;
/**
 * 將 YAML 值解析為字串陣列。
 * 對應 tasks.ts L4946（原 parseYamlList）。
 */
export declare function parseYamlList(value: unknown): readonly string[];
/**
 * 將 unknown 值轉成可選字串（null 代表空值）。
 * 對應 tasks.ts L4965（原 normalizeOptionalString）。
 */
export declare function normalizeOptionalString(value: unknown): string | null;
/**
 * 清除 YAML 純量值頭尾引號。
 * 對應 tasks.ts L4969（原 normalizeYamlScalar，同名搬移）。
 */
export declare function normalizeYamlScalar(value: string): string;
/**
 * 解析 markdown 表格一列的各 cell。
 * 對應 tasks.ts L5085（原 parseMarkdownTableCells）。
 */
export declare function parseMarkdownTableCells(value: string): readonly string[];
/**
 * 將 TaskImportStatus 字串值正規化。
 * 對應 tasks.ts L5117（原 coerceStatus）。
 */
export declare function coerceStatus(value: string): 'planned' | 'open' | 'in_progress' | 'reserved' | 'ready' | 'running' | 'review' | 'blocked' | 'abandoned' | 'done';
/**
 * 正規化任務 ID（去空白與反引號包裝）。保留 authored casing。
 * TASK-AAO-0139: 不再 force-uppercase；比對請用 taskIdsEqual。
 */
export declare function normalizeTaskId(raw: string): string;
/** Case-insensitive task-id equality while preserving stored casing. */
export declare function taskIdsEqual(left: string, right: string): boolean;
/** Find a staged relative path that matches expected path ignoring case. */
export declare function findCaseInsensitiveRelativePath(paths: Iterable<string>, expected: string): string | null;
export declare function taskIdsInclude(ids: readonly string[], taskId: string): boolean;
/**
 * 計算區段內容的 sha256 前綴 hash（16 字元）。
 * 對應 tasks.ts L5137（原 hashSection）。
 */
export declare function hashSection(content: string): string;
/**
 * 從 taskDocument 欄位提取所有宣告的檔案路徑集合。
 * 對應 tasks.ts L3302（原 extractTaskDeclaredFiles）。
 */
export declare function extractTaskDeclaredFiles(taskDocument: Record<string, unknown>): string[];
/**
 * 檢測路徑字串是否含有句邊英文虛詞、markdown 符號或行尾標點等污染特徵。
 *
 * 偵測規則：
 * 1. 英文虛詞（整詞匹配）：the / for / of / closure / packet / and / with
 * 2. markdown 符號：行首 "- " / "* " / "# "
 * 3. 行尾標點：結尾為逗號、句號、冒號或半形問號
 * 4. 只含空白（正規化後為空）
 *
 * Stop Condition（TASK-AAO-0064 規格）：
 * - CJK 字元（U+4E00–U+9FFF 等）不觸發任何規則
 * - 帶有 CJK 的路徑直接回傳 null（視為安全）
 */
export declare function validateStrictPathHeuristic(entry: string): string | null;
/**
 * 批次驗證 deliverables 陣列，回傳違規條目清單。
 * Deliverable declarations are authoritative close metadata, so malformed
 * values always produce an import-blocking error. `strictMode` remains in the
 * signature for caller compatibility while legacy plans are migrated.
 */
export declare function validateDeliverablesList(deliverables: readonly string[], strictMode: boolean): readonly {
    readonly entry: string;
    readonly reason: string;
    readonly severity: 'warning' | 'error';
}[];
export interface ContextFile {
    readonly path: string;
    readonly reason: string;
}
export interface ContextPattern {
    readonly referencePath: string;
    readonly referenceTaskId: string;
    readonly description: string;
}
export interface ContextMap {
    readonly primary?: readonly ContextFile[];
    readonly secondary?: readonly ContextFile[];
    readonly tests?: readonly ContextFile[];
    readonly patterns?: readonly ContextPattern[];
}
export declare function parseContextMap(raw: unknown): ContextMap | undefined;
export declare const ATOMIZATION_DEFAULT_MAX_LINES = 600;
export interface AtomizationLineLimitWaiver {
    readonly reason?: unknown;
    readonly expiresAt?: unknown;
}
export interface AtomizationLinePolicyConfig {
    readonly maxLines?: unknown;
    readonly waiver?: AtomizationLineLimitWaiver | null;
}
export interface AtomizationLinePolicy {
    readonly maxLines: number;
    readonly defaultMaxLines: number;
    readonly source: 'default' | 'config' | 'override';
    readonly waiverRequired: boolean;
    readonly waiverValid: boolean;
    readonly waiverExpiresAt: string | null;
}
export declare function resolveAtomizationLinePolicy(input?: {
    readonly config?: {
        readonly atomization?: AtomizationLinePolicyConfig;
    } | null;
    readonly overrideMaxLines?: number | null;
    readonly now?: Date;
}): AtomizationLinePolicy;
import type { TaskCardImportDiagnostic } from './result-contracts.ts';
export declare const EXTRACTION_FIRST_LINE_BUDGET = 600;
/**
 * Extraction-first patrol (TASK-AAO-FABLE-006/007): when a card's scopePaths
 * touch an existing module over EXTRACTION_FIRST_LINE_BUDGET lines and the
 * card declares no `atomizationImpact.extractionCandidates`, emit an advisory
 * warning. Never blocking — the human may still choose inline, but the choice
 * must be visible on the card.
 */
export declare function buildExtractionFirstPatrolDiagnostics(input: {
    readonly scopePaths: readonly string[];
    readonly hasExtractionCandidates: boolean;
    readonly resolveLineCount: (relativePath: string) => number | null;
}): TaskCardImportDiagnostic[];
