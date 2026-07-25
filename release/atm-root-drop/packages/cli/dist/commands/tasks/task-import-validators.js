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
import { isBroadSuiteCommandOrKey, projectLegacyCommandValidators } from '../test-catalog.js';
export { parseAcceptanceEvidenceMap } from './acceptance-evidence-import.js';
export function normalizeTaskCausalGraphContract(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const list = (...keys) => {
        for (const key of keys) {
            const candidate = record[key];
            if (Array.isArray(candidate))
                return [...new Set(candidate.filter((entry) => typeof entry === 'string').map(normalizeYamlScalar))];
            if (typeof candidate === 'string' && candidate.trim())
                return [...new Set(parseYamlList(candidate))];
        }
        return [];
    };
    return {
        causalDependencies: list('causalDependencies', 'causal_dependencies', 'depends_on'),
        startConditions: list('startConditions', 'start_conditions'),
        softRelations: list('softRelations', 'soft_relations', 'related'),
        changedPublicSeams: list('changedPublicSeams', 'changed_public_seams', 'publicSeams', 'public_seams'),
        causalImpactEdges: list('causalImpactEdges', 'causal_impact_edges', 'impactEdges', 'impact_edges'),
        parallelFrontierInputs: list('parallelFrontierInputs', 'parallel_frontier_inputs', 'frontierInputs', 'frontier_inputs'),
        validatorReferences: list('validatorReferences', 'validator_references', 'validators'),
        phaseOwner: normalizeOptionalString(record.phaseOwner ?? record.phase_owner)
    };
}
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
    let currentObjectListItem = null;
    for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine;
        if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
            const colonIndex = line.indexOf(':');
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();
            currentKey = key;
            currentObjectKey = value.length === 0 ? key : null;
            currentObjectListKey = null;
            currentObjectListItem = null;
            data[key] = value;
            continue;
        }
        // Nested fields/lists on a top-level object-array item
        // (for example testContributions[i].coversAcceptance).
        const nestedObjectFieldMatch = /^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (currentObjectListItem && nestedObjectFieldMatch && !/^\s*-\s+/.test(line)) {
            const key = nestedObjectFieldMatch[1];
            const value = nestedObjectFieldMatch[2].trim();
            currentObjectListItem[key] = value.length === 0 ? [] : normalizeYamlScalar(value);
            currentObjectListKey = value.length === 0 ? key : null;
            continue;
        }
        if (currentObjectListItem && currentObjectListKey && /^\s+-\s+/.test(line)) {
            const value = line.replace(/^\s+-\s+/, '').trim();
            const existing = currentObjectListItem[currentObjectListKey];
            currentObjectListItem[currentObjectListKey] = Array.isArray(existing)
                ? [...existing, normalizeYamlScalar(value)]
                : [normalizeYamlScalar(value)];
            continue;
        }
        const objectFieldMatch = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (currentObjectKey && objectFieldMatch) {
            const objectValue = data[currentObjectKey];
            if (Array.isArray(objectValue)) {
                // Keep array-shaped top-level keys intact; nested item fields are
                // handled above via currentObjectListItem.
                continue;
            }
            const objectRecord = objectValue && typeof objectValue === 'object'
                ? objectValue
                : {};
            const key = objectFieldMatch[1];
            const value = objectFieldMatch[2].trim();
            objectRecord[key] = value;
            data[currentObjectKey] = objectRecord;
            currentObjectListKey = value.length === 0 ? key : null;
            currentObjectListItem = null;
            continue;
        }
        const objectListObjectMatch = /^ {4}-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (currentObjectKey && currentObjectListKey && objectListObjectMatch) {
            const objectRecord = data[currentObjectKey];
            const key = objectListObjectMatch[1];
            const value = normalizeYamlScalar(objectListObjectMatch[2]);
            const item = { [key]: value };
            const existing = objectRecord[currentObjectListKey];
            objectRecord[currentObjectListKey] = Array.isArray(existing) ? [...existing, item] : [item];
            data[currentObjectKey] = objectRecord;
            currentObjectListItem = item;
            continue;
        }
        const objectListObjectFieldMatch = /^ {6}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (currentObjectKey && currentObjectListKey && currentObjectListItem && objectListObjectFieldMatch) {
            const key = objectListObjectFieldMatch[1];
            const value = normalizeYamlScalar(objectListObjectFieldMatch[2]);
            currentObjectListItem[key] = value;
            continue;
        }
        if (currentObjectKey && currentObjectListKey && /^ {4}-\s+/.test(line)) {
            const objectRecord = data[currentObjectKey];
            if (Array.isArray(objectRecord)) {
                continue;
            }
            const value = line.replace(/^ {4}-\s+/, '').trim();
            const existing = objectRecord[currentObjectListKey];
            objectRecord[currentObjectListKey] = Array.isArray(existing)
                ? [...existing, value]
                : typeof existing === 'string' && existing.length > 0
                    ? [existing, value]
                    : [value];
            data[currentObjectKey] = objectRecord;
            currentObjectListItem = null;
            continue;
        }
        if (currentKey && /^\s*-\s+/.test(line)) {
            const objectItemMatch = /^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
            if (objectItemMatch) {
                const item = {
                    [objectItemMatch[1]]: normalizeYamlScalar(objectItemMatch[2])
                };
                const existing = data[currentKey];
                data[currentKey] = Array.isArray(existing)
                    ? [...existing, item]
                    : typeof existing === 'string' && existing.length === 0
                        ? [item]
                        : typeof existing === 'string'
                            ? [existing, item]
                            : [item];
                currentObjectKey = currentKey;
                currentObjectListKey = null;
                currentObjectListItem = item;
                continue;
            }
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
            currentObjectListItem = null;
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
 * 正規化任務 ID（去空白與反引號包裝）。保留 authored casing。
 * TASK-AAO-0139: 不再 force-uppercase；比對請用 taskIdsEqual。
 */
export function normalizeTaskId(raw) {
    return raw.trim().replace(/`/g, '');
}
/** Case-insensitive task-id equality while preserving stored casing. */
export function taskIdsEqual(left, right) {
    return normalizeTaskId(left).toLowerCase() === normalizeTaskId(right).toLowerCase();
}
/** Find a staged relative path that matches expected path ignoring case. */
export function findCaseInsensitiveRelativePath(paths, expected) {
    const target = expected.replace(/\\/g, '/').toLowerCase();
    for (const entry of paths) {
        const normalized = entry.replace(/\\/g, '/');
        if (normalized.toLowerCase() === target)
            return normalized;
    }
    return null;
}
export function taskIdsInclude(ids, taskId) {
    return ids.some((id) => taskIdsEqual(id, taskId));
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
    // markdown 符號：行首 "- " / "* " / "# "
    if (/^[-*#]\s/.test(trimmed))
        return 'markdown-prefix';
    // 行尾標點
    if (/[,.:?]$/.test(trimmed))
        return 'trailing-punctuation';
    // A deliverable is a repository path declaration, not a narrative label.
    // CJK is valid in file names, so path shape rather than language determines
    // whether the declaration is safe to import.
    if (/\s/.test(trimmed))
        return 'whitespace-narrative';
    if (/[/\\]/.test(trimmed) || /[*?\[\]]/.test(trimmed))
        return null;
    if (/^\.?[A-Za-z0-9_@][A-Za-z0-9_.@-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(trimmed))
        return null;
    if (/^(?:Dockerfile|Makefile|LICENSE|NOTICE|README)$/i.test(trimmed))
        return null;
    return 'not-path-shaped';
}
/**
 * 批次驗證 deliverables 陣列，回傳違規條目清單。
 * Deliverable declarations are authoritative close metadata, so malformed
 * values always produce an import-blocking error. `strictMode` remains in the
 * signature for caller compatibility while legacy plans are migrated.
 */
export function validateDeliverablesList(deliverables, strictMode) {
    const violations = [];
    for (const entry of deliverables) {
        const reason = validateStrictPathHeuristic(entry);
        if (reason) {
            violations.push({ entry, reason, severity: 'error' });
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
export const ATOMIZATION_DEFAULT_MAX_LINES = 600;
export function resolveAtomizationLinePolicy(input = {}) {
    const now = input.now ?? new Date();
    const overrideMaxLines = input.overrideMaxLines ?? null;
    if (overrideMaxLines !== null) {
        assertPositiveInteger(overrideMaxLines, 'overrideMaxLines');
        return buildAtomizationLinePolicy(overrideMaxLines, 'override', input.config?.atomization?.waiver ?? null, now);
    }
    const configured = input.config?.atomization?.maxLines;
    if (configured === undefined || configured === null) {
        return buildAtomizationLinePolicy(ATOMIZATION_DEFAULT_MAX_LINES, 'default', input.config?.atomization?.waiver ?? null, now);
    }
    const maxLines = typeof configured === 'string' ? Number(configured) : configured;
    if (!Number.isInteger(maxLines)) {
        throw new Error('atomization.maxLines must be an integer');
    }
    return buildAtomizationLinePolicy(maxLines, 'config', input.config?.atomization?.waiver ?? null, now);
}
function buildAtomizationLinePolicy(maxLines, source, waiver, now) {
    assertPositiveInteger(maxLines, 'atomization.maxLines');
    const waiverRequired = maxLines > ATOMIZATION_DEFAULT_MAX_LINES;
    const waiverExpiresAt = typeof waiver?.expiresAt === 'string' && waiver.expiresAt.trim() ? waiver.expiresAt.trim() : null;
    const waiverValid = !waiverRequired || Boolean(waiverExpiresAt && Date.parse(waiverExpiresAt) > now.getTime());
    if (waiverRequired && !waiverValid) {
        throw new Error(`atomization.maxLines ${maxLines} exceeds default ${ATOMIZATION_DEFAULT_MAX_LINES}; raising the limit requires atomization.waiver.expiresAt in the future`);
    }
    return {
        maxLines,
        defaultMaxLines: ATOMIZATION_DEFAULT_MAX_LINES,
        source,
        waiverRequired,
        waiverValid,
        waiverExpiresAt
    };
}
function assertPositiveInteger(value, label) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive integer`);
    }
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
export const EXTRACTION_FIRST_LINE_BUDGET = ATOMIZATION_DEFAULT_MAX_LINES;
/**
 * Extraction-first patrol (TASK-AAO-FABLE-006/007): when a card's scopePaths
 * touch an existing module over EXTRACTION_FIRST_LINE_BUDGET lines and the
 * card declares no `atomizationImpact.extractionCandidates`, emit an advisory
 * warning. Never blocking — the human may still choose inline, but the choice
 * must be visible on the card.
 */
export function buildExtractionFirstPatrolDiagnostics(input) {
    if (input.hasExtractionCandidates)
        return [];
    const oversized = input.scopePaths
        .map((entry) => String(entry).trim().replace(/\\/g, '/'))
        .filter((entry) => entry && /\.[A-Za-z0-9]+$/.test(entry) && !/[*{}]/.test(entry))
        .map((entry) => ({ path: entry, lines: input.resolveLineCount(entry) }))
        .filter((entry) => typeof entry.lines === 'number' && entry.lines > EXTRACTION_FIRST_LINE_BUDGET);
    if (oversized.length === 0)
        return [];
    return [{
            code: 'ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE',
            severity: 'warning',
            field: 'atomizationImpact',
            message: `Scope touches ${oversized.length} module(s) over ${EXTRACTION_FIRST_LINE_BUDGET} lines but the card declares no atomizationImpact.extractionCandidates. Extraction-first is the ATM default: propose an atom/atom-map extraction (see .agents/skills/atm-atom-map-refactor), or record disposition "inline" with an inlineReason approved by a human.`,
            candidates: oversized.map((entry) => `${entry.path} (${entry.lines} lines)`)
        }];
}
export function parseCausalValidatorCardFields(input) {
    const data = input.frontmatter && typeof input.frontmatter === 'object' ? input.frontmatter : {};
    const testContributions = parseTestContributions(data.testContributions ?? data.test_contributions);
    const requiredTestCaseIds = uniqueStrings(parseYamlList(data.requiredTestCaseIds ?? data.required_test_case_ids));
    const phaseTestCaseIds = uniqueStrings(parseYamlList(data.phaseTestCaseIds ?? data.phase_test_case_ids));
    const advisoryTestCaseIds = uniqueStrings(parseYamlList(data.advisoryTestCaseIds ?? data.advisory_test_case_ids));
    const legacyValidators = uniqueStrings(input.validators ?? parseYamlList(data.validators));
    const usesCausalContract = testContributions.length > 0
        || requiredTestCaseIds.length > 0
        || phaseTestCaseIds.length > 0
        || advisoryTestCaseIds.length > 0;
    return {
        testContributions,
        requiredTestCaseIds,
        phaseTestCaseIds,
        advisoryTestCaseIds,
        legacyValidators,
        legacyProjection: usesCausalContract ? [] : projectLegacyCommandValidators(legacyValidators),
        usesCausalContract
    };
}
export function validateCausalValidatorContractImport(input) {
    const fields = parseCausalValidatorCardFields(input);
    const diagnostics = [];
    const errors = [];
    const acceptance = uniqueStrings(input.acceptance ?? []);
    const impactEdges = uniqueStrings(input.causalImpactEdges
        ?? normalizeTaskCausalGraphContract(input.frontmatter?.causalGraph ?? input.frontmatter?.causal_graph).causalImpactEdges);
    if (!fields.usesCausalContract) {
        if (fields.legacyProjection.length > 0) {
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_LEGACY_VALIDATOR_PROJECTION',
                severity: 'warning',
                field: 'validators',
                message: `Command-only validators were projected to ${fields.legacyProjection.length} advisory legacy case id(s) for migration. Prefer requiredTestCaseIds / testContributions for new cards.`
            });
        }
        return { fields, diagnostics, errors };
    }
    const contributionCaseIds = new Set(fields.testContributions.map((entry) => entry.caseId));
    const resolvableRequired = new Set([
        ...contributionCaseIds,
        ...fields.requiredTestCaseIds
    ]);
    for (const caseId of fields.requiredTestCaseIds) {
        if (!contributionCaseIds.has(caseId) && !looksLikeCaseId(caseId)) {
            const text = `requiredTestCaseIds entry "${caseId}" is not a resolvable case id`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_UNRESOLVED',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    if (acceptance.length > 0 || impactEdges.length > 0) {
        if (fields.requiredTestCaseIds.length === 0 && fields.testContributions.length === 0) {
            const text = 'Acceptance criteria or causal impact edges require resolvable required test cases';
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_MISSING',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    for (const [index, criterion] of acceptance.entries()) {
        const aliases = acceptanceAliases(criterion, index);
        const covered = fields.testContributions.some((entry) => entry.coversAcceptance.some((token) => aliases.has(normalizeCoverageToken(token)))) || (fields.requiredTestCaseIds.length > 0 && fields.testContributions.length === 0);
        if (!covered && fields.testContributions.length > 0) {
            const text = `Acceptance criterion "${criterion}" has no resolvable required case coverage`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_ACCEPTANCE_CASE_UNRESOLVED',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const edge of impactEdges) {
        const covered = fields.testContributions.some((entry) => entry.coversImpactEdges.some((token) => normalizeCoverageToken(token) === normalizeCoverageToken(edge))) || (fields.requiredTestCaseIds.length > 0 && fields.testContributions.length === 0);
        if (!covered && fields.testContributions.length > 0) {
            const text = `Causal impact edge "${edge}" has no resolvable required case coverage`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_IMPACT_EDGE_CASE_UNRESOLVED',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const contribution of fields.testContributions) {
        if (contribution.responsibility !== 'task-required')
            continue;
        const suiteLike = isBroadSuiteCommandOrKey(contribution.caseId)
            || (contribution.semanticKey ? isBroadSuiteCommandOrKey(contribution.semanticKey) : false);
        const hasEdge = Boolean(contribution.dependencyEdge || contribution.contractEdge || contribution.resourceKey || contribution.contributionResourceKey);
        if (suiteLike && !hasEdge) {
            const text = `Full-suite case "${contribution.caseId}" cannot be task-required without a dependency, contract, or resource edge`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const caseId of fields.requiredTestCaseIds) {
        if (!isBroadSuiteCommandOrKey(caseId))
            continue;
        const contribution = fields.testContributions.find((entry) => entry.caseId === caseId);
        const hasEdge = Boolean(contribution?.dependencyEdge
            || contribution?.contractEdge
            || contribution?.resourceKey
            || contribution?.contributionResourceKey);
        if (!hasEdge) {
            const text = `Full-suite requiredTestCaseId "${caseId}" cannot be task-required without a dependency, contract, or resource edge`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    if (resolvableRequired.size === 0 && (acceptance.length > 0 || impactEdges.length > 0)) {
        const text = 'Declared acceptance or impact edges lack resolvable required case ids';
        if (!errors.includes(text)) {
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_MISSING',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    return { fields, diagnostics, errors };
}
function parseTestContributions(raw) {
    let source = raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            source = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(source))
        return [];
    const items = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        const caseId = normalizeOptionalString(record.caseId ?? record.case_id);
        if (!caseId)
            continue;
        const responsibilityRaw = normalizeOptionalString(record.responsibility) ?? 'task-required';
        const responsibility = responsibilityRaw === 'phase-suite' || responsibilityRaw === 'advisory'
            ? responsibilityRaw
            : 'task-required';
        items.push({
            caseId,
            targetGroupId: normalizeOptionalString(record.targetGroupId ?? record.target_group_id),
            semanticKey: normalizeOptionalString(record.semanticKey ?? record.semantic_key),
            coversAcceptance: uniqueStrings(parseYamlList(record.coversAcceptance ?? record.covers_acceptance)),
            coversImpactEdges: uniqueStrings(parseYamlList(record.coversImpactEdges ?? record.covers_impact_edges)),
            expectedRedPredicate: normalizeOptionalString(record.expectedRedPredicate ?? record.expected_red_predicate),
            contributionResourceKey: normalizeOptionalString(record.contributionResourceKey ?? record.contribution_resource_key),
            responsibility,
            dependencyEdge: normalizeOptionalString(record.dependencyEdge ?? record.dependency_edge),
            contractEdge: normalizeOptionalString(record.contractEdge ?? record.contract_edge),
            resourceKey: normalizeOptionalString(record.resourceKey ?? record.resource_key)
        });
    }
    return items;
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}
function looksLikeCaseId(value) {
    return /^(test_int_|test_task_|legacy_cmd_)[A-Za-z0-9_.:-]+$/.test(value);
}
function normalizeCoverageToken(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function acceptanceAliases(criterion, index) {
    const aliases = new Set([
        normalizeCoverageToken(criterion),
        `acc-${index + 1}`,
        `acceptance-${index + 1}`
    ]);
    const explicit = /^(ACC[-_ ]?\d+)\b/i.exec(criterion.trim());
    if (explicit)
        aliases.add(normalizeCoverageToken(explicit[1].replace(/\s+/g, '-')));
    return aliases;
}
