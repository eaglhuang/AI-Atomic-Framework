import type { StringSet } from './types.ts';

export function uniq(values: readonly string[] | undefined | null): StringSet {
  return new Set(Array.isArray(values) ? values.filter((entry): entry is string => !!entry).map((entry) => entry.trim()).filter(Boolean) : []);
}

export function collectTags(requestId: string): { scenarios: string[]; tasks: string[] } {
  const parts = requestId.split(':');
  const result = { scenarios: new Set<string>(), tasks: new Set<string>() };
  if (parts.length >= 2 && parts[0] === 'bench') {
    result.scenarios.add(parts[1] ?? 'n/a');
  }
  for (const part of parts) {
    if (part.startsWith('TASK-')) {
      result.tasks.add(part);
    }
  }
  return {
    scenarios: [...result.scenarios],
    tasks: [...result.tasks]
  };
}

export function toCsv(values: StringSet): string {
  return [...values].sort((left, right) => left.localeCompare(right)).join(',') || 'n/a';
}

export function addStringValue(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    target.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      addStringValue(target, item);
    }
  }
}

export function collectObjectStringsByKey(value: unknown, keys: ReadonlySet<string>, target: Set<string>): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectStringsByKey(item, keys, target);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key)) {
      addStringValue(target, entry);
    }
    collectObjectStringsByKey(entry, keys, target);
  }
}

export function firstStringByKey(value: unknown, keys: ReadonlySet<string>): string | null {
  const values = new Set<string>();
  collectObjectStringsByKey(value, keys, values);
  return [...values][0] ?? null;
}


export function sanitizeRunId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}
