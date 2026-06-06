import path from 'node:path';

export type TaskIntentSource = 'integration-hook' | 'atm-skill' | 'cli-deterministic';
export type RequestedTaskAction = 'analyze' | 'implement' | 'redo' | 'reopen' | 'close' | 'audit' | 'cleanup';

export interface TaskIntent {
  readonly schemaId: 'atm.taskIntent.v1';
  readonly userPrompt: string | null;
  readonly explicitTaskIds: readonly string[];
  readonly mentionedTaskIds: readonly string[];
  readonly mentionedPlanPaths: readonly string[];
  readonly taskRootHints: readonly string[];
  readonly targetRepoHints: readonly string[];
  readonly requestedAction: RequestedTaskAction | null;
  readonly confidence: number;
  readonly source: TaskIntentSource;
  readonly ordinalScope: { readonly kind: 'first'; readonly count: number } | null;
  readonly queueRequested: boolean;
  readonly taskScopeMentioned: boolean;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueInOrder(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function expandTaskIdReferenceAliases(taskIdReference: string): readonly string[] {
  const normalized = taskIdReference
    .trim()
    .toUpperCase()
    .replace(/_/g, '-')
    .replace(/^[`"'(]+|[`"'):;,]+$/g, '');
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);
  if (normalized.startsWith('TASK-')) {
    aliases.add(normalized.slice('TASK-'.length));
  } else if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(normalized)) {
    aliases.add(`TASK-${normalized}`);
  }
  return [...aliases];
}

function isQueueRequestedPrompt(prompt: string): boolean {
  return /\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u6240\u6709(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9|\u5f8c\u9762(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5f8c\u7e8c(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5269\u9918(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u63a5\u4e0b\u4f86(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u9010\u4e00(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u4e00\u5f35\u5f35(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u6574\u4efd\u8a08\u756b|\u6574\u500b\u8a08\u756b|all(?:[\s\S]{0,80})task\s+cards|all(?:[\s\S]{0,80})tasks|remaining(?:[\s\S]{0,80})(?:task\s+cards|tasks)|later(?:[\s\S]{0,80})(?:task\s+cards|tasks)|one\s+by\s+one(?:[\s\S]{0,80})(?:task\s+cards|tasks)|entire\s+plan|whole\s+plan|through\s+all/i.test(prompt);
}

function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null {
  if (/\u91cd\u505a|redo/i.test(prompt)) return 'redo';
  if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt)) return 'reopen';
  if (/\u95dc\u9589|\u5b8c\u6210|close|done/i.test(prompt)) return 'close';
  if (/audit|\u7a3d\u6838|\u6aa2\u8a0e/i.test(prompt)) return 'audit';
  if (/cleanup|\u6e05\u7406/i.test(prompt)) return 'cleanup';
  if (/implement|\u5be6\u4f5c|\u958b\u767c/i.test(prompt)) return 'implement';
  if (/\u5206\u6790|analy[sz]e/i.test(prompt)) return 'analyze';
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// ======================== 搬移的 11 個純解析/正規化函式 ========================

// 1. parseMarkdownFrontmatter
export function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listMatch = /^\s*-\s+(.+?)\s*$/.exec(rawLine);
    if (listMatch && currentListKey) {
      const current = Array.isArray(result[currentListKey]) ? result[currentListKey] as string[] : [];
      current.push(listMatch[1].trim());
      result[currentListKey] = current;
      continue;
    }
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) {
      if (rawLine.trim()) currentListKey = null;
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    if (!key) continue;
    if (!value) {
      result[key] = [];
      currentListKey = key;
      continue;
    }
    result[key] = value;
    currentListKey = null;
  }
  return result;
}

// 2. normalizeTaskRouteStatus
export function normalizeTaskRouteStatus(status: string): string {
  return String(status ?? '').trim().toLowerCase();
}

// 3. normalizeOptionalBoolean
export function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'required' || normalized === 'allow') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'deny' || normalized === 'forbid') return false;
  return null;
}

// 4. normalizeSearchText
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/%25/g, 'percent')
    .replace(/[ \t\r\n"'`*_~[\]{}<>:\uFF1A,\uFF0C\u3002.!\uFF01?\uFF1F]+/g, '')
    .trim();
}

// 5. normalizeTaskIntent
export function normalizeTaskIntent(value: Record<string, unknown>, fallbackSource: TaskIntentSource): TaskIntent {
  const userPrompt = normalizeOptionalString(value.userPrompt);
  const explicitTaskIds = uniqueInOrder([
    ...readStringArray(value.taskIds),
    ...readStringArray(value.tasks)
  ].map((entry) => entry.toUpperCase()));
  const mentionedTaskIds = uniqueSorted(readStringArray(value.mentionedTaskIds).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
  const mentionedPlanPaths = readStringArray(value.mentionedPlanPaths);
  const taskRootHints = readStringArray(value.taskRootHints);
  const targetRepoHints = readStringArray(value.targetRepoHints);
  const prompt = userPrompt ?? '';
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt,
    explicitTaskIds,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: normalizeRequestedTaskAction(value.requestedAction) ?? detectRequestedTaskAction(prompt),
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    source: normalizeTaskIntentSource(value.source) ?? fallbackSource,
    ordinalScope: normalizeOrdinalScope(value.ordinalScope),
    queueRequested: value.queueRequested === true || isQueueRequestedPrompt(prompt),
    taskScopeMentioned: value.taskScopeMentioned === true
      || explicitTaskIds.length > 0
      || mentionedTaskIds.length > 0
      || mentionedPlanPaths.length > 0
      || taskRootHints.length > 0
  };
}

// 6. normalizeOrdinalScope
export function normalizeOrdinalScope(value: unknown): { readonly kind: 'first'; readonly count: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'first' || typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count < 1) return null;
  return { kind: 'first', count: Math.min(record.count, 50) };
}

// 7. normalizeTaskIntentSource
export function normalizeTaskIntentSource(value: unknown): TaskIntentSource | null {
  return value === 'integration-hook' || value === 'atm-skill' || value === 'cli-deterministic' ? value : null;
}

// 8. normalizeRequestedTaskAction
export function normalizeRequestedTaskAction(value: unknown): RequestedTaskAction | null {
  return value === 'analyze' || value === 'implement' || value === 'redo' || value === 'reopen' || value === 'close' || value === 'audit' || value === 'cleanup'
    ? value
    : null;
}

// 9. normalizeOptionalTaskPath
export function normalizeOptionalTaskPath(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const candidate = normalized.replace(/^[`"'(]+|[`"'):;,]+$/g, '');
  if (!candidate) return null;
  if (/^[A-Za-z]:\//.test(candidate) || candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return null;
  }
  return candidate.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

// 10. readStringArray
export function readStringArray(value: unknown): readonly string[] {
  return splitListValue(value);
}

// 11. splitListValue
export function splitListValue(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return uniqueSorted(value.flatMap((entry) => splitListValue(entry)));
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const inlineArray = /^\[(.*)\]$/.exec(trimmed);
  const source = inlineArray ? inlineArray[1] : trimmed;
  if (source.includes(',') || inlineArray) {
    return uniqueSorted(source
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean));
  }
  return [trimmed.replace(/^['"]|['"]$/g, '')].filter(Boolean);
}
