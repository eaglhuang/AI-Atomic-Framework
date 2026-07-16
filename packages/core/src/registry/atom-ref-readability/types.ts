import path from 'node:path';
import { existsSync } from 'node:fs';

export interface AtomRefSweepOptions {
  readonly repos: readonly string[];
  readonly apply: boolean;
  readonly generatedAt?: string;
}

export interface AtomRefSweepResult {
  readonly schemaId: 'atm.atomRefSweep';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly apply: boolean;
  readonly repos: readonly RepoReadabilityReport[];
}

export interface RepoReadabilityReport {
  readonly repoPath: string;
  readonly ok: boolean;
  readonly registryPath: string | null;
  readonly atomCount: number;
  readonly mapCount: number;
  readonly memberAtomCount: number;
  readonly callsiteCount: number;
  readonly violationCount: number;
  readonly generatedRefPaths: readonly string[];
  readonly reportPaths: readonly string[];
  readonly violations: readonly AtomCallsiteViolation[];
  readonly rewrittenCallsites: readonly AtomCallsiteRewrite[];
  readonly skipped: readonly string[];
}

export interface AtomCatalogEntry {
  readonly kind: 'atom' | 'map';
  readonly id: string;
  readonly refName: string;
  readonly logicalName: string;
  readonly purpose: string;
  readonly sourcePaths: readonly string[];
  readonly members: readonly string[];
  readonly entrypoints: readonly string[];
}

export interface RegistryLocationRecord {
  readonly codePaths?: unknown;
  readonly specPath?: unknown;
  readonly reportPath?: unknown;
}

export interface RegistrySelfVerificationRecord {
  readonly sourcePaths?: {
    readonly code?: unknown;
  };
}

export interface RegistryEntryRecord {
  readonly atomId?: unknown;
  readonly mapId?: unknown;
  readonly logicalName?: unknown;
  readonly purpose?: unknown;
  readonly location?: RegistryLocationRecord;
  readonly selfVerification?: RegistrySelfVerificationRecord;
}

export interface RegistryDocumentRecord {
  readonly entries?: unknown;
}

export interface MapSpecMemberRecord {
  readonly atomId?: unknown;
}

export interface MapSpecQualityTargetsRecord {
  readonly pilotName?: unknown;
  readonly equivalenceFixtures?: unknown;
}

export interface MapSpecReplacementRecord {
  readonly legacyUris?: unknown;
}

export interface MapSpecRecord {
  readonly description?: unknown;
  readonly logicalName?: unknown;
  readonly members?: unknown;
  readonly entrypoints?: unknown;
  readonly qualityTargets?: MapSpecQualityTargetsRecord;
  readonly replacement?: MapSpecReplacementRecord;
}

export interface AtomCallsite {
  readonly file: string;
  readonly line: number;
  readonly callee: 'runAtm' | 'runAtmMap';
  readonly firstArgument: string;
}

export interface AtomCallsiteViolation extends AtomCallsite {
  readonly code: string;
  readonly detail: string;
}

export interface AtomCallsiteRewrite extends AtomCallsite {
  readonly from: string;
  readonly to: string;
}

export function asRecord<T extends object>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : null;
}

export const atomIdPattern = /^ATM-[A-Z0-9]+-\d{4}$/;
export const atomIdLikePattern = /ATM-[A-Z0-9]+-\d{4}/;
export const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
export const ignoredDirectoryNames = new Set([
  '.git',
  '.atm',
  '.atm-temp',
  'node_modules',
  'library',
  'Library',
  'temp',
  'Temp',
  'dist',
  'build',
  'release'
]);

export function generatedPathsForRepo(repoPath: string): string[] {
  if (isFrameworkRepo(repoPath)) {
    return ['packages/core/src/registry/atom-runtime.generated.ts'];
  }
  return ['atomic_workbench/refs/atom-refs.ts', 'atomic_workbench/refs/map-refs.ts'];
}

export function isFrameworkRepo(repoPath: string): boolean {
  return existsSync(path.join(repoPath, 'packages', 'core', 'src', 'registry'));
}
