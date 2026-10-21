import { readFileSync } from 'node:fs';
import path from 'node:path';

type HelpResult = { exitCode: number; parsed: { evidence?: Record<string, any> } };
export type HelpRunner = (args: string[], cwd: string) => Promise<HelpResult>;
export const helpSnapshotCommands = ['explain', 'broker', 'next', 'orient', 'start', 'guide', 'registry', 'upgrade'] as const;
export const helpSnapshotDirectory = 'tests/cli-fixtures/help-snapshots';

export function readHelpSnapshots(root: string): Record<string, unknown> {
  return Object.fromEntries(['command-list', ...helpSnapshotCommands]
    .map((command) => [command, JSON.parse(readFileSync(path.join(root, helpSnapshotDirectory, `${command}.json`), 'utf8'))]));
}

export function helpUsageMatches(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(canonicalHelpUsage(actual ?? null)) === JSON.stringify(canonicalHelpUsage(expected));
}

function canonicalHelpUsage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalHelpUsage);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalHelpUsage(entry)]));
  }
  return value;
}

export function helpSnapshotMatches(command: string, actual: unknown, expected: unknown): boolean {
  if (command === 'command-list') {
    const normalize = (value: any) => [...value.commands].sort((left: string, right: string) => left.localeCompare(right));
    return helpUsageMatches(normalize(actual), normalize(expected));
  }
  return helpUsageMatches(actual, expected);
}

export function listedHelpCommands(evidence: Record<string, any> | undefined): string[] {
  return (Array.isArray(evidence?.commands) ? evidence.commands : [])
    .map((entry: any) => typeof entry === 'string' ? entry : entry.command)
    .filter(Boolean)
    .sort((left: string, right: string) => left.localeCompare(right));
}

export async function currentHelpSnapshot(command: string, root: string, run: HelpRunner): Promise<unknown> {
  const result = await run(command === 'command-list' ? ['--help'] : [command, '--help'], root);
  if (result.exitCode !== 0) throw new Error(`${command} --help failed`);
  return command === 'command-list'
    ? { commands: listedHelpCommands(result.parsed.evidence) }
    : result.parsed.evidence?.usage ?? null;
}

export async function inspectHelpSnapshots(root: string, run: HelpRunner, log: (message: string) => void): Promise<string[]> {
  const drift: string[] = [];
  for (const [command, expected] of Object.entries(readHelpSnapshots(root))) {
    const actual = await currentHelpSnapshot(command, root, run);
    log(JSON.stringify({ command, usage: actual }));
    if (!helpSnapshotMatches(command, actual, expected)) drift.push(command);
  }
  return drift;
}
