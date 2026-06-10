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
export function collectKeyValue(sections: readonly HeadingSection[], key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const section of sections) {
    for (const line of section.lines) {
      const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
      if (match && match[1].toLowerCase() === keyLower) {
        return match[2];
      }
    }
  }
  return null;
}

/**
 * Collects a key-value pair from raw line lists.
 */
export function collectKeyValueFromLines(lines: readonly string[], key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const line of lines) {
    const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
    if (match && match[1].toLowerCase() === keyLower) {
      return match[2].trim();
    }
  }
  return null;
}

/**
 * Packs table metadata into structural TaskImportRecord-compatible format.
 * hashSection 由呼叫方透過 createContext 傳入，避免循環依賴。
 */
export function createTaskFromTableMetadata(input: {
  readonly metadata: TaskTableMetadata;
  readonly planRelativePath: string;
  readonly importedAt: string;
  readonly hashSection: (text: string) => string;
}): TaskImportRecordShape {
  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: input.metadata.workItemId,
    title: input.metadata.title,
    status: input.metadata.status,
    milestone: input.metadata.milestone,
    dependencies: input.metadata.dependencies,
    acceptance: [],
    deliverables: input.metadata.deliverables,
    tags: [],
    notes: null,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: input.metadata.title,
      headingLine: input.metadata.headingLine,
      hash: input.hashSection(input.metadata.rowText)
    },
    importedAt: input.importedAt
  };
}

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

export const MAX_DISPATCH_METADATA_BYTES = 8192;

const DISPATCH_PATTERN_KEYS = ['dispatch_pattern', 'dispatchPattern'] as const;
const CONDITION_REVIEW_KEYS = ['condition_review', 'conditionReview'] as const;
const PHASE_KEY_ALIASES: Record<string, 'phase0' | 'phase1'> = {
  phase_0: 'phase0',
  phase0: 'phase0',
  phase_1: 'phase1',
  phase1: 'phase1'
};

/**
 * Parse bounded dispatch metadata from a task-card markdown document.
 * Uses block-aware YAML parsing because flat extractFrontMatter corrupts nested dispatch_pattern trees.
 */
export function parseDispatchMetadataFromPlanText(planText: string): TaskDispatchMetadata {
  const block = extractFrontMatterBlock(planText);
  if (!block) {
    return {};
  }

  const lines = block.split(/\r?\n/);
  const dispatchSubtree = extractYamlSubtreeLines(lines, DISPATCH_PATTERN_KEYS);
  const dispatchEnvelope = dispatchSubtree ? parseIndentedYamlSubtree(dispatchSubtree) : undefined;
  const dispatchRaw = unwrapDispatchPatternEnvelope(dispatchEnvelope);
  const dispatchPattern = dispatchRaw ? normalizeDispatchPatternRecord(dispatchRaw) : undefined;

  let conditionReview = parseTopLevelStringList(lines, CONDITION_REVIEW_KEYS);
  if ((!conditionReview || conditionReview.length === 0) && dispatchRaw) {
    const nested = dispatchRaw.condition_review ?? dispatchRaw.conditionReview;
    conditionReview = normalizeStringList(nested);
  }

  const mailboxAssignee = resolveMailboxAssignee({
    explicitAssignee: parseTopLevelScalar(lines, ['assignee', 'mailbox_assignee', 'mailboxAssignee']),
    dispatchPattern
  });

  const metadata: TaskDispatchMetadata = {
    ...(dispatchPattern ? { dispatchPattern } : {}),
    ...(conditionReview && conditionReview.length > 0 ? { conditionReview } : {}),
    ...(mailboxAssignee ? { mailboxAssignee } : {})
  };

  const payloadBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (payloadBytes > MAX_DISPATCH_METADATA_BYTES) {
    throw new Error(`dispatch metadata payload exceeds ${MAX_DISPATCH_METADATA_BYTES} bytes (${payloadBytes}).`);
  }

  return metadata;
}

export function assertDispatchMetadataMaterializable(metadata: TaskDispatchMetadata, workItemId: string): readonly string[] {
  const issues: string[] = [];
  if (!metadata.dispatchPattern) {
    return issues;
  }
  if (!metadata.dispatchPattern.phase1?.lane) {
    issues.push(`${workItemId}: dispatchPattern.phase1.lane is required for mailbox materialization when dispatchPattern is present.`);
  }
  if (!metadata.mailboxAssignee) {
    issues.push(`${workItemId}: mailboxAssignee could not be resolved from assignee or phase1 lane.`);
  }
  return issues;
}

function extractFrontMatterBlock(planText: string): string | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(planText);
  return match ? match[1] : null;
}

function extractYamlSubtreeLines(lines: readonly string[], rootKeys: readonly string[]): string[] | null {
  const keyPattern = new RegExp(`^(${rootKeys.join('|')})\\s*:`);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (keyPattern.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return null;
  }

  const startLine = lines[start];
  const inlineValue = startLine.slice(startLine.indexOf(':') + 1).trim();
  if (inlineValue.length > 0) {
    return [startLine];
  }

  const baseIndent = startLine.search(/\S/);
  const collected = [startLine];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      collected.push(line);
      continue;
    }
    const indent = line.search(/\S/);
    if (indent <= baseIndent && /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line.trim())) {
      break;
    }
    collected.push(line);
  }
  return collected;
}

function parseTopLevelScalar(lines: readonly string[], keys: readonly string[]): string | null {
  const keyPattern = new RegExp(`^(${keys.join('|')})\\s*:\\s*(.+)$`);
  for (const line of lines) {
    const match = keyPattern.exec(line);
    if (match) {
      return unquoteYamlScalar(match[2]);
    }
  }
  return null;
}

function parseTopLevelStringList(lines: readonly string[], keys: readonly string[]): readonly string[] {
  const subtree = extractYamlSubtreeLines(lines, keys);
  if (!subtree) {
    return [];
  }
  const scalarLine = subtree[0];
  const inlineValue = scalarLine.slice(scalarLine.indexOf(':') + 1).trim();
  if (inlineValue.length > 0) {
    return [unquoteYamlScalar(inlineValue)];
  }
  const listItems = parseYamlListSubtree(subtree.slice(1));
  if (listItems.length > 0) {
    return normalizeStringList(listItems);
  }
  return normalizeStringList(parseIndentedYamlSubtree(subtree).items);
}

function parseYamlListSubtree(lines: readonly string[]): unknown[] {
  const items: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(unquoteYamlScalar(trimmed.slice(2).trim()));
    }
  }
  return items;
}

function parseIndentedYamlSubtree(lines: readonly string[]): Record<string, unknown> {
  const nodes = lines
    .map((line) => ({ indent: line.search(/\S/), text: line }))
    .filter((entry) => entry.indent >= 0 && entry.text.trim().length > 0);
  const parsed = parseIndentedYamlNodes(nodes, 0, nodes[0]?.indent ?? 0);
  return parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : {};
}

function parseIndentedYamlNodes(
  nodes: readonly { indent: number; text: string }[],
  start: number,
  baseIndent: number
): { value: unknown; next: number } {
  const objectValue: Record<string, unknown> = {};
  let index = start;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node.indent < baseIndent) {
      break;
    }
    if (node.indent > baseIndent) {
      index += 1;
      continue;
    }

    const listMatch = /^-\s+(.*)$/.exec(node.text.trim());
    if (listMatch) {
      const listItems: unknown[] = [];
      while (index < nodes.length) {
        const listNode = nodes[index];
        const itemMatch = /^-\s+(.*)$/.exec(listNode.text.trim());
        if (!itemMatch || listNode.indent !== node.indent) {
          break;
        }
        listItems.push(unquoteYamlScalar(itemMatch[1]));
        index += 1;
      }
      return { value: listItems, next: index };
    }

    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(node.text.trim());
    if (!keyMatch) {
      index += 1;
      continue;
    }
    const key = keyMatch[1];
    const inlineValue = keyMatch[2].trim();
    if (inlineValue.length > 0) {
      objectValue[key] = unquoteYamlScalar(inlineValue);
      index += 1;
      continue;
    }

    if (index + 1 < nodes.length && nodes[index + 1].indent > node.indent) {
      const child = parseIndentedYamlNodes(nodes, index + 1, nodes[index + 1].indent);
      objectValue[key] = child.value;
      index = child.next;
      continue;
    }

    objectValue[key] = '';
    index += 1;
  }

  return { value: objectValue, next: index };
}

function unwrapDispatchPatternEnvelope(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  const nested = raw.dispatch_pattern ?? raw.dispatchPattern;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return raw;
}

function normalizeDispatchPatternRecord(raw: Record<string, unknown>): TaskDispatchPattern | undefined {
  const shape = normalizeOptionalScalar(raw.shape);
  const rationale = normalizeOptionalScalar(raw.rationale);
  const parallelWith = normalizeOptionalScalar(raw.parallel_with ?? raw.parallelWith);
  const phase0 = normalizeDispatchPhase(raw.phase_0 ?? raw.phase0);
  const phase1 = normalizeDispatchPhase(raw.phase_1 ?? raw.phase1);

  if (!shape && !rationale && !parallelWith && !phase0 && !phase1) {
    return undefined;
  }

  return {
    ...(shape ? { shape } : {}),
    ...(rationale ? { rationale } : {}),
    ...(parallelWith ? { parallelWith } : {}),
    ...(phase0 ? { phase0 } : {}),
    ...(phase1 ? { phase1 } : {})
  };
}

function normalizeDispatchPhase(raw: unknown): TaskDispatchPhase | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const lane = normalizeOptionalScalar(record.lane);
  const allowedFiles = normalizeStringList(record.allowed_files ?? record.allowedFiles);
  const forbiddenFiles = normalizeStringList(record.forbidden_files ?? record.forbiddenFiles);
  const commitLayout = normalizeStringList(record.commit_layout ?? record.commitLayout);
  const output = normalizeOptionalScalar(record.output);
  const allowedFilesStrict = parseBooleanScalar(record.allowed_files_strict ?? record.allowedFilesStrict);
  const commitBudget = parseNumberScalar(record.commit_budget ?? record.commitBudget);

  if (!lane && allowedFiles.length === 0 && forbiddenFiles.length === 0 && commitLayout.length === 0 && !output
    && allowedFilesStrict === undefined && commitBudget === undefined) {
    return undefined;
  }

  return {
    ...(lane ? { lane } : {}),
    ...(allowedFiles.length > 0 ? { allowedFiles } : {}),
    ...(forbiddenFiles.length > 0 ? { forbiddenFiles } : {}),
    ...(allowedFilesStrict !== undefined ? { allowedFilesStrict } : {}),
    ...(commitBudget !== undefined ? { commitBudget } : {}),
    ...(commitLayout.length > 0 ? { commitLayout } : {}),
    ...(output ? { output } : {})
  };
}

function normalizeStringList(value: unknown): readonly string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? unquoteYamlScalar(entry) : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [unquoteYamlScalar(value)];
  }
  return [];
}

function normalizeOptionalScalar(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? unquoteYamlScalar(value) : null;
}

function parseBooleanScalar(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return undefined;
}

function parseNumberScalar(value: unknown): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^['"`]|['"`]$/g, '');
}

function resolveMailboxAssignee(input: {
  readonly explicitAssignee: string | null;
  readonly dispatchPattern?: TaskDispatchPattern;
}): string | null {
  if (input.explicitAssignee) {
    return input.explicitAssignee;
  }
  const lane = input.dispatchPattern?.phase1?.lane ?? input.dispatchPattern?.phase0?.lane ?? null;
  if (!lane) {
    return null;
  }
  const builderMatch = /\bbuilder\s+(\d{3})\b/i.exec(lane) ?? /\b(\d{3})\b/.exec(lane);
  return builderMatch ? builderMatch[1] : null;
}
