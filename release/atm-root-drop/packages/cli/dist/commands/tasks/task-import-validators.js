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
import { createHash } from 'node:crypto';
// ─── 搬移的 9 個純函式（behavior-preserving，簽章/行為完全不變） ──────────
/**
 * 從 markdown 文字提取 YAML frontmatter。
 * 對應 tasks.ts L4879（原 extractFrontMatter）。
 */
export function extractFrontMatter(text) {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
    if (!match)
        return null;
    const block = match[1];
    const data = {};
    let currentKey = null;
    let currentObjectKey = null;
    let currentObjectListKey = null;
    for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine;
        if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
            const colonIndex = line.indexOf(':');
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();
            currentKey = key;
            currentObjectKey = value.length === 0 ? key : null;
            currentObjectListKey = null;
            data[key] = value;
            continue;
        }
        const objectFieldMatch = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (currentObjectKey && objectFieldMatch) {
            const objectValue = data[currentObjectKey];
            const objectRecord = objectValue && typeof objectValue === 'object' && !Array.isArray(objectValue)
                ? objectValue
                : {};
            const key = objectFieldMatch[1];
            const value = objectFieldMatch[2].trim();
            objectRecord[key] = value;
            data[currentObjectKey] = objectRecord;
            currentObjectListKey = value.length === 0 ? key : null;
            continue;
        }
        if (currentObjectKey && currentObjectListKey && /^ {4}-\s+/.test(line)) {
            const objectRecord = data[currentObjectKey];
            const value = line.replace(/^ {4}-\s+/, '').trim();
            const existing = objectRecord[currentObjectListKey];
            objectRecord[currentObjectListKey] = Array.isArray(existing)
                ? [...existing, value]
                : typeof existing === 'string' && existing.length > 0
                    ? [existing, value]
                    : [value];
            data[currentObjectKey] = objectRecord;
            continue;
        }
        if (currentKey && /^\s*-\s+/.test(line)) {
            const value = line.replace(/^\s*-\s+/, '').trim();
            const existing = data[currentKey];
            if (Array.isArray(existing)) {
                data[currentKey] = [...existing, value];
            }
            else if (typeof existing === 'string' && existing.length === 0) {
                data[currentKey] = [value];
            }
            else if (typeof existing === 'string') {
                data[currentKey] = [existing, value];
            }
            else {
                data[currentKey] = [value];
            }
        }
    }
    const endIndex = match.index + match[0].length;
    const headingLineMatch = /\n#\s+(.+)/.exec(text.slice(endIndex));
    const headingLine = headingLineMatch
        ? text.slice(0, endIndex + headingLineMatch.index + 1).split(/\r?\n/).length
        : text.slice(0, endIndex).split(/\r?\n/).length;
    return { data, endIndex, headingLine };
}
/**
 * 將 YAML 值解析為字串陣列。
 * 對應 tasks.ts L4946（原 parseYamlList）。
 */
export function parseYamlList(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value
            .filter((entry) => typeof entry === 'string')
            .map(normalizeYamlScalar)
            .filter(Boolean);
    if (typeof value !== 'string')
        return [];
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed
            .slice(1, -1)
            .split(',')
            .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
    }
    return [normalizeYamlScalar(trimmed)].filter(Boolean);
}
/**
 * 將 unknown 值轉成可選字串（null 代表空值）。
 * 對應 tasks.ts L4965（原 normalizeOptionalString）。
 */
export function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? normalizeYamlScalar(value) : null;
}
/**
 * 清除 YAML 純量值頭尾引號。
 * 對應 tasks.ts L4969（原 normalizeYamlScalar，同名搬移）。
 */
export function normalizeYamlScalar(value) {
    return value.trim().replace(/^['"`]|['"`]$/g, '');
}
/**
 * 解析 markdown 表格一列的各 cell。
 * 對應 tasks.ts L5085（原 parseMarkdownTableCells）。
 */
export function parseMarkdownTableCells(value) {
    return value
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cleanCellText(cell));
}
/**
 * 將 TaskImportStatus 字串值正規化。
 * 對應 tasks.ts L5117（原 coerceStatus）。
 */
export function coerceStatus(value) {
    const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (normalized === 'todo' || normalized === 'planned')
        return 'planned';
    if (normalized === 'reserved')
        return 'reserved';
    if (normalized === 'ready')
        return 'ready';
    if (normalized === 'open' || normalized === 'pending')
        return 'open';
    if (normalized === 'in_progress' || normalized === 'wip' || normalized === 'doing')
        return 'in_progress';
    if (normalized === 'running')
        return 'running';
    if (normalized === 'review')
        return 'review';
    if (normalized === 'blocked' || normalized === 'waiting')
        return 'blocked';
    if (normalized === 'abandoned')
        return 'abandoned';
    if (normalized === 'done' || normalized === 'completed' || normalized === 'closed')
        return 'done';
    return 'planned';
}
/**
 * 正規化任務 ID（去引號、轉大寫）。
 * 對應 tasks.ts L5133（原 normalizeTaskId）。
 */
export function normalizeTaskId(raw) {
    return raw.trim().replace(/`/g, '').toUpperCase();
}
/**
 * 計算區段內容的 sha256 前綴 hash（16 字元）。
 * 對應 tasks.ts L5137（原 hashSection）。
 */
export function hashSection(content) {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
/**
 * 從 taskDocument 欄位提取所有宣告的檔案路徑集合。
 * 對應 tasks.ts L3302（原 extractTaskDeclaredFiles）。
 */
export function extractTaskDeclaredFiles(taskDocument) {
    const files = new Set();
    for (const key of ['scope', 'scopePaths', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts', 'outputs']) {
        collectTaskFileValues(taskDocument[key], files);
    }
    const source = taskDocument.source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        const sourceRecord = source;
        collectTaskFileValues(sourceRecord.path, files);
        collectTaskFileValues(sourceRecord.planPath, files);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}
// ─── 新增：L1 功能 — validateStrictPathHeuristic ──────────────────────────
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
export function validateStrictPathHeuristic(entry) {
    const trimmed = entry.trim();
    if (!trimmed)
        return 'empty-path';
    // CJK 安全豁免：路徑包含 CJK 字元則跳過啟發式判斷
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F]/.test(trimmed))
        return null;
    // markdown 符號：行首 "- " / "* " / "# "
    if (/^[-*#]\s/.test(trimmed))
        return 'markdown-prefix';
    // 行尾標點
    if (/[,.:?]$/.test(trimmed))
        return 'trailing-punctuation';
    // 英文虛詞整詞匹配（大小寫不限）
    if (/\b(the|for|of|closure|packet|and|with)\b/i.test(trimmed))
        return 'english-sentence-word';
    return null;
}
/**
 * 批次驗證 deliverables 陣列，回傳違規條目清單。
 * 非 strict 模式回傳 severity='warning'；strict 模式回傳 severity='error'。
 */
export function validateDeliverablesList(deliverables, strictMode) {
    const violations = [];
    for (const entry of deliverables) {
        const reason = validateStrictPathHeuristic(entry);
        if (reason) {
            violations.push({ entry, reason, severity: strictMode ? 'error' : 'warning' });
        }
    }
    return violations;
}
// ─── 私有 helper（被本模組函式使用） ─────────────────────────────────────────
function cleanCellText(value) {
    return value
        .replace(/`/g, '')
        .replace(/<br\s*\/?>/gi, ', ')
        .trim();
}
function collectTaskFileValues(value, files) {
    if (typeof value === 'string') {
        const normalized = normalizeRelativePath(value);
        if (normalized)
            files.add(normalized);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectTaskFileValues(entry, files);
        }
    }
}
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
export function parseContextMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }
    const obj = raw;
    const result = {};
    if ('primary' in obj) {
        result.primary = parseContextFiles(obj.primary);
    }
    if ('secondary' in obj) {
        result.secondary = parseContextFiles(obj.secondary);
    }
    if ('tests' in obj) {
        result.tests = parseContextFiles(obj.tests);
    }
    if ('patterns' in obj) {
        result.patterns = parseContextPatterns(obj.patterns);
    }
    if (result.primary === undefined && result.secondary === undefined && result.tests === undefined && result.patterns === undefined) {
        return undefined;
    }
    return result;
}
function parseContextFiles(val) {
    if (!Array.isArray(val)) {
        return undefined;
    }
    const items = [];
    for (const item of val) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const i = item;
            const path = typeof i.path === 'string' ? i.path.trim() : '';
            const reason = typeof i.reason === 'string' ? i.reason.trim() : '';
            if (path && reason) {
                items.push({ path, reason });
            }
        }
    }
    return items;
}
function parseContextPatterns(val) {
    if (!Array.isArray(val)) {
        return undefined;
    }
    const items = [];
    for (const item of val) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const i = item;
            const referencePath = typeof i.referencePath === 'string' ? i.referencePath.trim() : '';
            const referenceTaskId = typeof i.referenceTaskId === 'string' ? i.referenceTaskId.trim() : '';
            const description = typeof i.description === 'string' ? i.description.trim() : '';
            if (referencePath && referenceTaskId && description) {
                items.push({ referencePath, referenceTaskId, description });
            }
        }
    }
    return items;
}
