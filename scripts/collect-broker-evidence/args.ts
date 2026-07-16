import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ArgMap } from './types.ts';

export function getArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[arg] = true;
      continue;
    }
    args[arg] = next;
    index += 1;
  }
  return args;
}

export function parseDefaultRunDir(value: string | boolean | undefined): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  const repoFallback = path.join(process.cwd(), '.atm', 'history', 'evidence', 'broker-runs');
  const externalFallback = path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'broker-collision-evidence',
    'runs'
  );
  if (existsSync(repoFallback)) {
    return repoFallback;
  }
  if (existsSync(externalFallback)) {
    return externalFallback;
  }
  throw new Error(`Unable to find run directory. Checked: ${repoFallback}, ${externalFallback}`);
}

export function parseTeamRunDir(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const dir = path.resolve(value);
  if (!existsSync(dir)) {
    throw new Error(`team-run directory does not exist: ${dir}`);
  }
  return dir;
}

export function parseOutputDir(value: string | boolean | undefined, runDir: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return path.join(path.dirname(runDir), 'broker-evidence-bundle');
}

export function printHelp(): void {
  const lines = [
    'collect-broker-evidence',
    '',
    'Usage:',
    '  node --strip-types scripts/collect-broker-evidence.ts [--run-dir <dir>] [--team-run-dir <dir>] [--output-dir <dir>] [--atm-root <path>] [--run-ids a,b] [--task-ids TASK-...]',
    '',
    'Default behavior:',
    '- run-dir: current repo .atm/history/evidence/broker-runs if it exists, otherwise',
    '  legacy fallback %USERPROFILE%\\3KLife\\docs\\ai_atomic_framework\\broker-collision-evidence\\runs',
    '- output-dir: <run-dir-parent>/broker-evidence-bundle',
    '- Output files: broker-evidence-bundle.json and broker-evidence-bundle.md in output-dir',
    '- team-run-dir: optional atm.teamRun.v1 runtime directory; brokerLane is summarized as run rows',
    ''
  ];
  console.log(lines.join('\n'));
}

export function parseCsvOption(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  return value.split(',').map((value) => value.trim()).filter(Boolean);
}

export function parseOutputFile(value: string | boolean | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return fallback;
}

