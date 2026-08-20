import { createHash } from 'node:crypto';

const TASK_CARD_LIFECYCLE_FIELDS = new Set([
  'status', 'completed_at', 'completed_by_agent', 'closedAt', 'closedByActor',
  'closedByCommand', 'lastTransitionId', 'lastTransitionAt', 'delivery_commit'
]);

export function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/**
 * The task-card contract intentionally excludes lifecycle bookkeeping so a
 * closeback cannot invalidate the validators that were sealed from the same
 * planning content. Every contract producer and consumer must use this seam.
 */
export function semanticTaskCardDigest(source: string): string {
  const semanticLines = source.split(/\r?\n/).filter((line) => {
    const key = /^([A-Za-z][A-Za-z0-9_]*):/.exec(line)?.[1];
    return key === undefined || !TASK_CARD_LIFECYCLE_FIELDS.has(key);
  });
  return digestText(semanticLines.join('\n'));
}
