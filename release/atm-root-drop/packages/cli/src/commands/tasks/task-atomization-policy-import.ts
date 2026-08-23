/**
 * task-atomization-policy-import.ts
 *
 * ATM-GOV-0406 bounded extraction from task-import-validators.ts.
 *
 * One cohesive unit: the import-time reading of a card's context map and the
 * atomization line policy derived from it, plus the extraction-first patrol that
 * the same policy answers. These belong together because the patrol budget is
 * the policy's default, and nothing here touches disk — the caller injects the
 * line-count resolver.
 *
 * The public surface is unchanged: task-import-validators.ts re-exports every
 * symbol below, so existing importers keep their import path.
 */

import type { TaskCardImportDiagnostic } from './result-contracts.ts';
// ─── Context Map 巢狀結構解析 ─────────────────────────────────────────

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

export function parseContextMap(raw: unknown): ContextMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const result: {
    primary?: ContextFile[];
    secondary?: ContextFile[];
    tests?: ContextFile[];
    patterns?: ContextPattern[];
  } = {};

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

export function resolveAtomizationLinePolicy(input: {
  readonly config?: { readonly atomization?: AtomizationLinePolicyConfig } | null;
  readonly overrideMaxLines?: number | null;
  readonly now?: Date;
} = {}): AtomizationLinePolicy {
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
  return buildAtomizationLinePolicy(maxLines as number, 'config', input.config?.atomization?.waiver ?? null, now);
}

function buildAtomizationLinePolicy(
  maxLines: number,
  source: AtomizationLinePolicy['source'],
  waiver: AtomizationLineLimitWaiver | null | undefined,
  now: Date
): AtomizationLinePolicy {
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function parseContextFiles(val: unknown): ContextFile[] | undefined {
  if (!Array.isArray(val)) {
    return undefined;
  }
  const items: ContextFile[] = [];
  for (const item of val) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const i = item as Record<string, unknown>;
      const path = typeof i.path === 'string' ? i.path.trim() : '';
      const reason = typeof i.reason === 'string' ? i.reason.trim() : '';
      if (path && reason) {
        items.push({ path, reason });
      }
    }
  }
  return items;
}

function parseContextPatterns(val: unknown): ContextPattern[] | undefined {
  if (!Array.isArray(val)) {
    return undefined;
  }
  const items: ContextPattern[] = [];
  for (const item of val) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const i = item as Record<string, unknown>;
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

// ─── TASK-AAO-FABLE-007：extraction-first 匯入巡邏（純 policy，I/O 由呼叫端注入） ──


export const EXTRACTION_FIRST_LINE_BUDGET = ATOMIZATION_DEFAULT_MAX_LINES;

/**
 * Extraction-first patrol (TASK-AAO-FABLE-006/007): when a card's scopePaths
 * touch an existing module over EXTRACTION_FIRST_LINE_BUDGET lines and the
 * card declares no `atomizationImpact.extractionCandidates`, emit an advisory
 * warning. Never blocking — the human may still choose inline, but the choice
 * must be visible on the card.
 */
export function buildExtractionFirstPatrolDiagnostics(input: {
  readonly scopePaths: readonly string[];
  readonly hasExtractionCandidates: boolean;
  readonly resolveLineCount: (relativePath: string) => number | null;
}): TaskCardImportDiagnostic[] {
  if (input.hasExtractionCandidates) return [];
  const oversized = input.scopePaths
    .map((entry) => String(entry).trim().replace(/\\/g, '/'))
    .filter((entry) => entry && /\.[A-Za-z0-9]+$/.test(entry) && !/[*{}]/.test(entry))
    .map((entry) => ({ path: entry, lines: input.resolveLineCount(entry) }))
    .filter((entry): entry is { path: string; lines: number } => typeof entry.lines === 'number' && entry.lines > EXTRACTION_FIRST_LINE_BUDGET);
  if (oversized.length === 0) return [];
  return [{
    code: 'ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE',
    severity: 'warning',
    field: 'atomizationImpact',
    message: `Scope touches ${oversized.length} module(s) over ${EXTRACTION_FIRST_LINE_BUDGET} lines but the card declares no atomizationImpact.extractionCandidates. Extraction-first is the ATM default: propose an atom/atom-map extraction (see .agents/skills/atm-atom-map-refactor), or record disposition "inline" with an inlineReason approved by a human.`,
    candidates: oversized.map((entry) => `${entry.path} (${entry.lines} lines)`)
  }];
}
