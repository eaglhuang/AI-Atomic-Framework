import { fail } from './context.ts';

export function findDuplicateAtmBacklogIds(markdown: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const match of markdown.matchAll(/\|\s*(ATM-BUG-\d{4}-\d{2}-\d{2}-\d{3})\s*\|/g)) {
    const id = match[1];
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates].sort();
}

export function assertNoDuplicateAtmBacklogIds(markdown: string, label: string): void {
  const duplicates = findDuplicateAtmBacklogIds(markdown);
  if (duplicates.length > 0) {
    fail(`${label} contains duplicate ATM backlog ID(s): ${duplicates.join(', ')}`);
  }
}
