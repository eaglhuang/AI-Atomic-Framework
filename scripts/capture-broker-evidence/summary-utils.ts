import type { StringSet } from './types.ts';

export function deriveAdmissionStateFromBrokerLane(brokerLane: unknown): string | null {
  const brokerLaneObject = brokerLane && typeof brokerLane === 'object'
    ? brokerLane as Record<string, unknown>
    : null;
  const admission = brokerLaneObject?.admission;
  return firstStringByKey(admission, new Set(['state', 'admissionState']));
}

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

export function parseScenarioTag(requestId: string): string | null {
  const parts = requestId.split(':');
  if (parts.length >= 2 && parts[0] === 'bench') {
    return parts[1] ?? null;
  }
  return null;
}

export function parseTaskIdHint(requestId: string): string | null {
  const parts = requestId.split(':');
  for (const part of parts) {
    if (part.startsWith('TASK-')) {
      return part;
    }
  }
  return null;
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

export function collectTagsFromExperiment(requestId: string): { scenarios: string[]; tasks: string[] } {
  return {
    scenarios: [parseScenarioTag(requestId) ?? 'n/a'].filter((value) => value !== 'n/a' && value !== ''),
    tasks: [parseTaskIdHint(requestId)].filter((value) => Boolean(value)) as string[]
  };
}

