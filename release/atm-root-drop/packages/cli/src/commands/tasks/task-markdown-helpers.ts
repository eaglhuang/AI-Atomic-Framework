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
