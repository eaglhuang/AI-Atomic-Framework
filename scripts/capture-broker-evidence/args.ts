import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ArgMap, ArgValue } from './types.ts';

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

    const previous = args[arg];
    const value = next;
    if (Array.isArray(previous)) {
      previous.push(value);
    } else if (previous === undefined) {
      args[arg] = value;
    } else if (previous === true) {
      args[arg] = [value];
    } else {
      args[arg] = [previous, value];
    }
    index += 1;
  }
  return args;
}

export function asStringList(value: ArgValue | undefined): string[] {
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value)
    ? value.map((entry) => entry.trim()).filter(Boolean)
    : [value.trim()].filter(Boolean);
}

export function asStringCsvList(value: ArgValue | undefined): string[] {
  const values = asStringList(value);
  return values
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function asInt(value: ArgValue | undefined, fallback: number): number {
  if (value === undefined || value === true) {
    return fallback;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid integer: ${raw}`);
  }
  return Math.floor(parsed);
}

export function asBoolean(value: ArgValue | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? true : value.length > 0 && String(value[0]).toLowerCase() !== 'false';
  }
  if (value === true) {
    return true;
  }
  return String(value).toLowerCase() !== 'false';
}

export function parseDefaultRunDirs(value: ArgValue | undefined): string[] {
  const explicit = [] as string[];
  const values = asStringList(value);
  const missing: string[] = [];

  for (const entry of values) {
    for (const part of entry.split(',')) {
      const resolved = path.resolve(part.trim());
      if (!resolved) {
        continue;
      }
      if (existsSync(resolved)) {
        explicit.push(resolved);
      } else {
        missing.push(part.trim());
      }
    }
  }

  if (explicit.length > 0) {
    if (missing.length > 0) {
      throw new Error(`Specified run directory not found: ${missing.join(', ')}`);
    }
    const dedupe = new Set(explicit);
    return [...dedupe];
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
  const runDirs: string[] = [];

  if (existsSync(repoFallback)) {
    runDirs.push(repoFallback);
  }
  if (existsSync(externalFallback)) {
    runDirs.push(externalFallback);
  }
  if (runDirs.length === 0) {
    throw new Error(`Unable to find run directory. Checked: ${repoFallback}, ${externalFallback}`);
  }
  return runDirs;
}

export function parseTeamRunDirs(value: ArgValue | undefined): string[] {
  const values = asStringList(value);
  if (values.length === 0) {
    return [];
  }
  const dirs: string[] = [];
  const missing: string[] = [];
  for (const entry of values) {
    for (const part of entry.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const resolved = path.resolve(trimmed);
      if (existsSync(resolved)) {
        dirs.push(resolved);
      } else {
        missing.push(trimmed);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Specified team-run directory not found: ${missing.join(', ')}`);
  }
  return [...new Set(dirs)];
}

export function parseOutputDir(value: ArgValue | undefined, outputHint: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return path.resolve(process.cwd(), outputHint);
}

export function parseOutputFile(value: ArgValue | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return fallback;
}


