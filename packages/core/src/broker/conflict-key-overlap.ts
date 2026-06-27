import type { ConflictKey } from './types.ts';

interface ParsedScopedKey {
  readonly scope: ConflictKey['scope'];
  readonly filePath: string | null;
  readonly start?: number;
  readonly end?: number;
  readonly rawTail: string;
}

function parseScopedKey(conflictKey: ConflictKey): ParsedScopedKey {
  if (conflictKey.scope === 'file') {
    return {
      scope: conflictKey.scope,
      filePath: conflictKey.key,
      rawTail: conflictKey.key
    };
  }

  const match = /^(record|range|scalar):(.+?)::(.+)$/.exec(conflictKey.key);
  if (match) {
    if (conflictKey.scope === 'range' || conflictKey.scope === 'line') {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(match[3]);
      if (rangeMatch) {
        return {
          scope: conflictKey.scope,
          filePath: match[2],
          start: Number.parseInt(rangeMatch[1], 10),
          end: Number.parseInt(rangeMatch[2], 10),
          rawTail: match[3]
        };
      }
    }
    return {
      scope: conflictKey.scope,
      filePath: match[2],
      rawTail: match[3]
    };
  }

  return {
    scope: conflictKey.scope,
    filePath: null,
    rawTail: conflictKey.key
  };
}

function sameFile(left: ParsedScopedKey, right: ParsedScopedKey): boolean {
  return left.filePath !== null && left.filePath === right.filePath;
}

export function conflictKeysOverlap(left: ConflictKey, right: ConflictKey): boolean {
  const a = parseScopedKey(left);
  const b = parseScopedKey(right);

  if (a.scope === 'file' || b.scope === 'file') {
    return a.filePath !== null && b.filePath !== null && a.filePath === b.filePath;
  }

  if ((a.scope === 'range' || a.scope === 'line') && (b.scope === 'range' || b.scope === 'line')) {
    return sameFile(a, b) && a.start !== undefined && a.end !== undefined && b.start !== undefined && b.end !== undefined
      ? a.start <= b.end && b.start <= a.end
      : false;
  }

  if (a.scope === 'record' && b.scope === 'record') {
    return left.key === right.key;
  }

  if (a.scope === 'scalar' && b.scope === 'scalar') {
    return left.key === right.key;
  }

  if (a.scope === 'semantic' && b.scope === 'semantic') {
    return left.key === right.key;
  }

  return left.key === right.key;
}
