import { execFileSync } from 'node:child_process';
import { CliError } from '../../shared.ts';
import type { IndexEntry } from './index-restoration.ts';

/** Whole-index capture budgets, independent of Git's smaller argv batches. */
export const INDEX_SNAPSHOT_READ_LIMITS = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxEntries: 500_000,
  timeoutMs: 30_000
});

function snapshotFailure(reason: string, facts: Record<string, unknown> = {}): CliError {
  return new CliError('ATM_GIT_COMMIT_FAILED', 'A complete Git index snapshot could not be captured safely.', {
    exitCode: 1,
    details: {
      nestedFailure: { boundary: 'index-snapshot', reason, ...facts },
      limits: INDEX_SNAPSHOT_READ_LIMITS,
      snapshotCaptured: false,
      nextSafeAction: 'Inspect the Git/index state and any existing commit-attempt receipt before retrying. Resolve the reported snapshot failure; do not substitute a partial index.'
    }
  });
}

/** Parse only a complete, lossless stage-zero snapshot; never return a prefix. */
export function parseIndexSnapshotOutput(output: Buffer): Map<string, IndexEntry> {
  if (output.length > INDEX_SNAPSHOT_READ_LIMITS.maxBytes) throw snapshotFailure('output-limit', { bytes: output.length });
  if (output.length !== 0 && output[output.length - 1] !== 0) throw snapshotFailure('unterminated-record');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output);
  } catch {
    throw snapshotFailure('invalid-utf8');
  }
  const entries = new Map<string, IndexEntry>();
  let start = 0;
  let objectIdLength: number | undefined;
  while (start < text.length) {
    if (entries.size >= INDEX_SNAPSHOT_READ_LIMITS.maxEntries) throw snapshotFailure('entry-limit', { entries: entries.size });
    const end = text.indexOf('\0', start);
    const row = text.slice(start, end);
    const separator = row.indexOf('\t');
    const metadata = row.slice(0, separator).match(/^(100644|100755|120000|160000) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])$/);
    if (separator < 0 || !metadata) throw snapshotFailure('malformed-record', { record: entries.size + 1 });
    const [, mode, objectId, stage] = metadata;
    if (stage !== '0') throw snapshotFailure('unmerged-index', { record: entries.size + 1 });
    if (/^0+$/.test(objectId) || (objectIdLength !== undefined && objectId.length !== objectIdLength)) throw snapshotFailure('invalid-object-id');
    objectIdLength = objectId.length;
    const filePath = row.slice(separator + 1);
    if (filePath.split('/').some((part) => part === '' || part === '.' || part === '..')) throw snapshotFailure('invalid-path');
    if (entries.has(filePath)) throw snapshotFailure('duplicate-path');
    entries.set(filePath, { mode, objectId, stage });
    start = end + 1;
  }
  return entries;
}

export function readCompleteIndexSnapshot(cwd: string): Map<string, IndexEntry> {
  let output: Buffer;
  try {
    output = execFileSync(process.env.ATM_GIT_EXECUTABLE || 'git', ['-C', cwd, 'ls-files', '--stage', '-z'], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      maxBuffer: INDEX_SNAPSHOT_READ_LIMITS.maxBytes,
      timeout: INDEX_SNAPSHOT_READ_LIMITS.timeoutMs,
      killSignal: 'SIGKILL'
    });
  } catch (error) {
    const failure = error as { code?: unknown; status?: unknown; signal?: unknown };
    throw snapshotFailure('process-failed', {
      processCode: typeof failure.code === 'string' ? failure.code.slice(0, 80) : null,
      status: typeof failure.status === 'number' && Number.isFinite(failure.status) ? failure.status : null,
      signal: typeof failure.signal === 'string' ? failure.signal.slice(0, 80) : null
    });
  }
  return parseIndexSnapshotOutput(output);
}
