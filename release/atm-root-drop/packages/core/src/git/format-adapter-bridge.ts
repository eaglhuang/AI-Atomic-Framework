import { execFileSync } from 'node:child_process';
import {
  defaultAdapterRegistry,
  fallbackFileLockAdapter,
  jsonRecordAdapter,
  pathToAtomMapAdapter,
  textRangeAdapter,
  type AdapterRegistry
} from '../broker/adapters/index.ts';
import { brokerAdapterMigration, type ConflictKey, type FileDescriptor, type MutationRequest } from '../broker/types.ts';
import type { GitDiffEntry } from './diff-mutation-request.ts';

export interface GitDiffAdapterBridgeOptions {
  readonly cwd: string;
  readonly baseRef: string;
  readonly targetRef: string;
  readonly entries: readonly GitDiffEntry[];
  readonly actorId?: string;
  readonly taskId?: string | null;
  readonly registry?: AdapterRegistry;
  readonly gitExecutable?: string;
}

export interface GitDiffBridgeDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly filePath: string;
  readonly action: 'inspect-json' | 'inspect-atom-map' | 'inspect-text-diff' | 'serialize-file';
}

export interface GitDiffBridgeResultEntry {
  readonly filePath: string;
  readonly adapterId: string;
  readonly conflictKeys: readonly ConflictKey[];
  readonly requests: readonly MutationRequest[];
  readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
  readonly failClosed: boolean;
}

export interface GitDiffAdapterBridgeResult {
  readonly entries: readonly GitDiffBridgeResultEntry[];
  readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
}

export function bridgeGitDiffEntriesToAdapterConflictKeys(input: GitDiffAdapterBridgeOptions): GitDiffAdapterBridgeResult {
  const registry = input.registry ?? defaultAdapterRegistry();
  const results: GitDiffBridgeResultEntry[] = [];
  const diagnostics: GitDiffBridgeDiagnostic[] = [];
  for (const entry of input.entries) {
    const bridged = bridgeSingleEntry({
      ...input,
      entry,
      registry
    });
    results.push(bridged);
    diagnostics.push(...bridged.diagnostics);
  }
  return { entries: results, diagnostics };
}

function bridgeSingleEntry(input: GitDiffAdapterBridgeOptions & { readonly entry: GitDiffEntry; readonly registry: AdapterRegistry }): GitDiffBridgeResultEntry {
  const snapshots = readEntrySnapshots(input);
  const preferred = selectPreferredAdapter(snapshots.file, snapshots.beforeContent, snapshots.afterContent);
  if (preferred === pathToAtomMapAdapter) {
    return buildStructuredBridgeResult({
      filePath: input.entry.filePath,
      adapterId: pathToAtomMapAdapter.id,
      diagnostics: [],
      requests: buildAtomMapRequests({
        filePath: input.entry.filePath,
        actorId: input.actorId ?? 'git-bridge',
        taskId: input.taskId ?? null,
        beforeContent: snapshots.beforeContent,
        afterContent: snapshots.afterContent
      }),
      parseContent: snapshots.afterContent ?? snapshots.beforeContent ?? '{}',
      adapter: pathToAtomMapAdapter
    }, input.entry.filePath);
  }
  if (preferred === jsonRecordAdapter) {
    try {
      return buildStructuredBridgeResult({
        filePath: input.entry.filePath,
        adapterId: jsonRecordAdapter.id,
        diagnostics: [],
        requests: buildJsonRecordRequests({
          filePath: input.entry.filePath,
          actorId: input.actorId ?? 'git-bridge',
          taskId: input.taskId ?? null,
          beforeContent: snapshots.beforeContent,
          afterContent: snapshots.afterContent
        }),
        parseContent: snapshots.afterContent ?? snapshots.beforeContent ?? '{}',
        adapter: jsonRecordAdapter
      }, input.entry.filePath);
    } catch (error) {
      return failClosedResult(input.entry.filePath, fallbackFileLockAdapter.id, [
        {
          code: 'ATM_GIT_ADAPTER_JSON_PARSE_FAILED',
          message: `JSON adapter bridge failed to parse ${input.entry.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          filePath: input.entry.filePath,
          action: 'inspect-json'
        }
      ]);
    }
  }
  const textHunks = readUnifiedZeroHunks({
    cwd: input.cwd,
    baseRef: input.baseRef,
    targetRef: input.targetRef,
    filePath: input.entry.filePath,
    gitExecutable: input.gitExecutable
  });
  if (textHunks.length > 0 && (snapshots.afterContent ?? snapshots.beforeContent) !== null) {
    return buildStructuredBridgeResult({
      filePath: input.entry.filePath,
      adapterId: textRangeAdapter.id,
      diagnostics: [],
      requests: buildTextRangeRequests({
        filePath: input.entry.filePath,
        actorId: input.actorId ?? 'git-bridge',
        taskId: input.taskId ?? null,
        hunks: textHunks
      }),
      parseContent: snapshots.afterContent ?? snapshots.beforeContent ?? '',
      adapter: textRangeAdapter
    }, input.entry.filePath);
  }
  return failClosedResult(input.entry.filePath, fallbackFileLockAdapter.id, textHunks.length === 0
    ? [{
        code: 'ATM_GIT_ADAPTER_TEXT_RANGE_UNAVAILABLE',
        message: `No structured adapter or text hunk range could be derived for ${input.entry.filePath}; falling back to whole-file conflict key.`,
        filePath: input.entry.filePath,
        action: 'inspect-text-diff'
      }]
    : []);
}

function buildStructuredBridgeResult(input: {
  readonly filePath: string;
  readonly adapterId: string;
  readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
  readonly requests: readonly MutationRequest[];
  readonly parseContent: string;
  readonly adapter: typeof jsonRecordAdapter | typeof pathToAtomMapAdapter | typeof textRangeAdapter;
}, filePath: string): GitDiffBridgeResultEntry {
  const parsed = input.adapter.parse({ filePath, content: input.parseContent });
  const conflictKeys = dedupeConflictKeys(input.requests.flatMap((request) =>
    input.adapter.getConflictKeys(input.adapter.normalize(request), parsed)
  ));
  return {
    filePath: input.filePath,
    adapterId: input.adapterId,
    conflictKeys,
    requests: input.requests,
    diagnostics: input.diagnostics,
    failClosed: false
  };
}

function failClosedResult(filePath: string, adapterId: string, diagnostics: readonly GitDiffBridgeDiagnostic[]): GitDiffBridgeResultEntry {
  const request = makeRequest({
    filePath,
    actorId: 'git-bridge',
    taskId: null,
    op: 'replace',
    target: filePath,
    value: null
  });
  const parsed = fallbackFileLockAdapter.parse({ filePath, content: '' });
  return {
    filePath,
    adapterId,
    conflictKeys: fallbackFileLockAdapter.getConflictKeys(fallbackFileLockAdapter.normalize(request), parsed),
    requests: [request],
    diagnostics,
    failClosed: true
  };
}

function selectPreferredAdapter(file: FileDescriptor, beforeContent: string | null, afterContent: string | null) {
  if (pathToAtomMapAdapter.supports(file)) {
    return pathToAtomMapAdapter;
  }
  if (jsonRecordAdapter.supports(file)) {
    return jsonRecordAdapter;
  }
  if (beforeContent !== null || afterContent !== null) {
    return textRangeAdapter;
  }
  return fallbackFileLockAdapter;
}

function buildJsonRecordRequests(input: {
  readonly filePath: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
}): readonly MutationRequest[] {
  const beforeValue = input.beforeContent ? JSON.parse(input.beforeContent) : null;
  const afterValue = input.afterContent ? JSON.parse(input.afterContent) : null;
  const pointers = diffJsonPointers(beforeValue, afterValue);
  return (pointers.length > 0 ? pointers : ['']).map((pointer, index) =>
    makeRequest({
      filePath: input.filePath,
      actorId: input.actorId,
      taskId: input.taskId,
      op: 'upsert',
      target: pointer,
      value: readValueAtPointer(afterValue, pointer)
    }, index)
  );
}

function buildAtomMapRequests(input: {
  readonly filePath: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
}): readonly MutationRequest[] {
  const beforeValue = input.beforeContent ? JSON.parse(input.beforeContent) as Record<string, unknown> : {};
  const afterValue = input.afterContent ? JSON.parse(input.afterContent) as Record<string, unknown> : {};
  const requests: MutationRequest[] = [];
  const beforeMappings = indexAtomMapRows(beforeValue.mappings);
  const afterMappings = indexAtomMapRows(afterValue.mappings);
  const rowKeys = new Set<string>([...beforeMappings.keys(), ...afterMappings.keys()]);
  let index = 0;
  for (const rowKey of rowKeys) {
    const beforeRow = beforeMappings.get(rowKey) ?? null;
    const afterRow = afterMappings.get(rowKey) ?? null;
    if (stableJson(beforeRow) === stableJson(afterRow)) {
      continue;
    }
    requests.push(makeRequest({
      filePath: input.filePath,
      actorId: input.actorId,
      taskId: input.taskId,
      op: 'replace',
      target: rowKey,
      value: afterRow
    }, index));
    index += 1;
  }
  const metadataKeys = new Set<string>([
    ...Object.keys(beforeValue).filter((key) => key !== 'mappings'),
    ...Object.keys(afterValue).filter((key) => key !== 'mappings')
  ]);
  for (const key of metadataKeys) {
    if (stableJson(beforeValue[key]) === stableJson(afterValue[key])) {
      continue;
    }
    requests.push(makeRequest({
      filePath: input.filePath,
      actorId: input.actorId,
      taskId: input.taskId,
      op: 'upsert',
      target: key,
      value: afterValue[key]
    }, index));
    index += 1;
  }
  return requests.length > 0 ? requests : [makeRequest({
    filePath: input.filePath,
    actorId: input.actorId,
    taskId: input.taskId,
    op: 'upsert',
    target: 'mappings',
    value: afterValue.mappings ?? []
  }, 0)];
}

function buildTextRangeRequests(input: {
  readonly filePath: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly hunks: readonly { start: number; end: number }[];
}): readonly MutationRequest[] {
  return input.hunks.map((hunk, index) =>
    makeRequest({
      filePath: input.filePath,
      actorId: input.actorId,
      taskId: input.taskId,
      op: 'replaceRange',
      target: `${hunk.start}:${hunk.end}`
    }, index)
  );
}

function diffJsonPointers(beforeValue: unknown, afterValue: unknown, pointer = ''): string[] {
  if (stableJson(beforeValue) === stableJson(afterValue)) {
    return [];
  }
  if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
    const keys = new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]);
    const pointers = [...keys].flatMap((key) =>
      diffJsonPointers((beforeValue as Record<string, unknown>)[key], (afterValue as Record<string, unknown>)[key], `${pointer}/${escapePointerToken(key)}`)
    );
    return pointers.length > 0 ? pointers : [pointer];
  }
  if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
    const length = Math.max(beforeValue.length, afterValue.length);
    const pointers = Array.from({ length }, (_, index) =>
      diffJsonPointers(beforeValue[index], afterValue[index], `${pointer}/${index}`)
    ).flat();
    return pointers.length > 0 ? pointers : [pointer];
  }
  return [pointer];
}

function readValueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') {
    return root;
  }
  let current = root;
  for (const token of pointer.split('/').slice(1).map(unescapePointerToken)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      current = current[Number.parseInt(token, 10)];
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function indexAtomMapRows(value: unknown): Map<string, unknown> {
  const result = new Map<string, unknown>();
  if (!Array.isArray(value)) {
    return result;
  }
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const pathPattern = String((row as Record<string, unknown>).path_pattern ?? '');
    const atomId = String((row as Record<string, unknown>).atom_id ?? '');
    if (!pathPattern || !atomId) continue;
    result.set(`${pathPattern}::${atomId}`, row);
  }
  return result;
}

function readEntrySnapshots(input: GitDiffAdapterBridgeOptions & { readonly entry: GitDiffEntry }) {
  const beforeRef = input.entry.status === 'added' ? null : `${input.baseRef}:${input.entry.previousFilePath ?? input.entry.filePath}`;
  const afterRef = input.entry.status === 'deleted' ? null : `${input.targetRef}:${input.entry.filePath}`;
  const beforeContent = beforeRef ? readGitBlob(input.cwd, beforeRef, input.gitExecutable) : null;
  const afterContent = afterRef ? readGitBlob(input.cwd, afterRef, input.gitExecutable) : null;
  const file: FileDescriptor = {
    filePath: input.entry.filePath,
    content: afterContent ?? beforeContent ?? ''
  };
  return { beforeContent, afterContent, file };
}

function readGitBlob(cwd: string, blobRef: string, gitExecutable = 'git'): string | null {
  try {
    return execFileSync(gitExecutable, ['show', blobRef], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    return null;
  }
}

function readUnifiedZeroHunks(input: {
  readonly cwd: string;
  readonly baseRef: string;
  readonly targetRef: string;
  readonly filePath: string;
  readonly gitExecutable?: string;
}): readonly { start: number; end: number }[] {
  try {
    const output = execFileSync(input.gitExecutable ?? 'git', [
      'diff',
      '--unified=0',
      '--no-color',
      input.baseRef,
      input.targetRef,
      '--',
      input.filePath
    ], {
      cwd: input.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const hunks: Array<{ start: number; end: number }> = [];
    const regex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
    for (const match of output.matchAll(regex)) {
      const rawStart = Number.parseInt(match[1], 10);
      const rawLength = match[2] ? Number.parseInt(match[2], 10) : 1;
      const length = Number.isFinite(rawLength) ? rawLength : 1;
      const start = rawStart === 0 ? 1 : rawStart;
      const end = rawStart === 0
        ? Math.max(1, length)
        : Math.max(start, start + Math.max(length - 1, 0));
      hunks.push({ start, end });
    }
    return hunks;
  } catch {
    return [];
  }
}

function makeRequest(input: {
  readonly filePath: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly op: string;
  readonly target: string;
  readonly value?: unknown;
}, index = 0): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId: `git-bridge-${index}-${input.filePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file'}`,
    actorId: input.actorId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    filePath: input.filePath,
    op: input.op,
    target: input.target,
    value: input.value
  };
}

function dedupeConflictKeys(keys: readonly ConflictKey[]): readonly ConflictKey[] {
  const seen = new Set<string>();
  const result: ConflictKey[] = [];
  for (const key of keys) {
    const id = `${key.scope}::${key.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(key);
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => [
      key,
      sortJson((value as Record<string, unknown>)[key])
    ]));
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
