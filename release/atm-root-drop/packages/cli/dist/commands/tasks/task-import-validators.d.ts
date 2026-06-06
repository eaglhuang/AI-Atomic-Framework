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
 * 正規化任務 ID（去引號、轉大寫）。
 * 對應 tasks.ts L5133（原 normalizeTaskId）。
 */
export declare function normalizeTaskId(raw: string): string;
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
 * 非 strict 模式回傳 severity='warning'；strict 模式回傳 severity='error'。
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
