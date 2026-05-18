import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameworkVersion } from './commands/shared.ts';

export type KnownBadSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface KnownBadVersionEntry {
  versionRange: string;
  reason: string;
  replacementVersion: string;
  severity: KnownBadSeverity;
  addedAt: string;
}

export interface KnownBadVersionManifest {
  schemaVersion: 'atm.knownBadVersions.v0.1';
  entries: KnownBadVersionEntry[];
}

export type KnownBadMode = 'no-manifest' | 'ok' | 'known-bad' | 'parse-error' | 'invalid-range';

export interface KnownBadCheckResult {
  ok: boolean;
  mode: KnownBadMode;
  currentVersion: string;
  manifestPath: string | null;
  match: (KnownBadVersionEntry & { reasonSummary: string }) | null;
}

export function resolveKnownBadManifestPath(): string | null {
  if (process.env.ATM_KNOWN_BAD_VERSIONS_PATH) {
    return path.resolve(process.env.ATM_KNOWN_BAD_VERSIONS_PATH);
  }

  const root = process.env.ATM_KNOWN_BAD_ROOT
    ? path.resolve(process.env.ATM_KNOWN_BAD_ROOT)
    : resolveKnownBadRoot();
  const manifestPath = path.join(root, 'known-bad-versions.json');
  return existsSync(manifestPath) ? manifestPath : null;
}

export function resolveKnownBadRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    moduleDir,
    path.resolve(moduleDir, '..'),
    path.resolve(moduleDir, '../..'),
    path.resolve(moduleDir, '../../..')
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'known-bad-versions.json'))) {
      return candidate;
    }
  }

  return path.resolve(moduleDir, '../../..');
}

export function readBundledCliVersion(): string {
  if (process.env.ATM_KNOWN_BAD_VERSION) {
    return process.env.ATM_KNOWN_BAD_VERSION;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, 'package.json'),
    path.join(moduleDir, '..', 'package.json'),
    path.join(moduleDir, '..', '..', 'package.json'),
    path.join(moduleDir, '..', '..', '..', 'package.json')
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }

  return frameworkVersion;
}

export function checkStartupKnownBadVersion(): KnownBadCheckResult {
  const manifestPath = resolveKnownBadManifestPath();
  const currentVersion = readBundledCliVersion();

  if (!manifestPath) {
    return { ok: true, mode: 'no-manifest', currentVersion, manifestPath: null, match: null };
  }

  let manifest: KnownBadVersionManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as KnownBadVersionManifest;
  } catch {
    return { ok: false, mode: 'parse-error', currentVersion, manifestPath, match: null };
  }

  if (!Array.isArray(manifest.entries)) {
    return { ok: false, mode: 'parse-error', currentVersion, manifestPath, match: null };
  }

  for (const entry of manifest.entries) {
    if (!isSupportedKnownBadRange(entry.versionRange)) {
      return { ok: false, mode: 'invalid-range', currentVersion, manifestPath, match: null };
    }
    if (matchesKnownBadRange(currentVersion, entry.versionRange)) {
      return {
        ok: false,
        mode: 'known-bad',
        currentVersion,
        manifestPath,
        match: {
          ...entry,
          reasonSummary: summarizeReason(entry.reason)
        }
      };
    }
  }

  return { ok: true, mode: 'ok', currentVersion, manifestPath, match: null };
}

export function isKnownBadReadOnlyCommand(commandName: string, commandArgs: readonly string[]): boolean {
  if (commandName === 'doctor' || commandName === 'help') return true;
  const readOnlyCommands = new Set([
    'atm-chart',
    'budget',
    'explain',
    'guide',
    'next',
    'orient',
    'registry-diff',
    'status',
    'validate',
    'verify'
  ]);
  if (readOnlyCommands.has(commandName)) return true;

  const subcommand = commandArgs.find((arg) => !arg.startsWith('-'));
  if (commandName === 'migrate') return subcommand === 'plan' || subcommand === 'verify';
  if (commandName === 'upgrade') return subcommand === 'plan' || commandArgs.includes('--scan');
  if (commandName === 'integration') return subcommand === 'verify';
  return false;
}

export function isSupportedKnownBadRange(range: string): boolean {
  try {
    parseKnownBadRange(range);
    return true;
  } catch {
    return false;
  }
}

export function isSemverVersion(version: string): boolean {
  return parseSemver(version) !== null;
}

export function matchesKnownBadRange(version: string, range: string): boolean {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return false;

  const parsedRange = parseKnownBadRange(range);
  return parsedRange.every((part) => {
    const comparison = compareSemver(parsedVersion, part.version);
    if (part.operator === '=') return comparison === 0;
    if (part.operator === '>') return comparison > 0;
    if (part.operator === '>=') return comparison >= 0;
    if (part.operator === '<') return comparison < 0;
    if (part.operator === '<=') return comparison <= 0;
    return false;
  });
}

function parseKnownBadRange(range: string) {
  const trimmed = range.trim();
  if (!trimmed) throw new Error('empty range');

  const tokens = trimmed.split(/\s+/);
  return tokens.map((token) => {
    const comparatorMatch = token.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!comparatorMatch) throw new Error(`invalid range token: ${token}`);
    const operator = comparatorMatch[1] || '=';
    const version = parseSemver(comparatorMatch[2]);
    if (!version) throw new Error(`invalid semver version: ${token}`);
    return { operator, version };
  });
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function summarizeReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137)}...`;
}
