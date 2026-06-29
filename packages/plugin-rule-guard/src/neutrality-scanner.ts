import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

export const defaultNeutralityPolicyRelativePath = 'docs/governance/docs-neutrality-policy.json';

export interface NeutralityScope {
  readonly path?: string;
  readonly pathPrefix?: string;
  readonly excludePrefixes?: readonly string[];
  readonly extensions?: readonly string[];
}

export interface NeutralityPolicy {
  readonly policyPath: string;
  readonly protectedFiles: readonly string[];
  readonly protectedScopes: readonly NeutralityScope[];
  readonly bannedTerms: readonly string[];
  readonly bannedPathPatterns: readonly string[];
  readonly ignoredPrefixes: readonly string[];
}

export interface NeutralityTarget {
  readonly fullPath: string;
  readonly relativePath: string;
}

export interface NeutralityViolation {
  readonly kind: 'term' | 'path';
  readonly file: string;
  readonly line?: number;
  readonly matchedRule: string;
}

export interface NeutralityReport {
  readonly schemaId: 'atm.neutralityReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly atomId: string;
  readonly legacyPlanningId: string;
  readonly repositoryRoot: string;
  readonly policyPath: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly totals: {
    readonly scannedFiles: number;
    readonly termViolations: number;
    readonly pathViolations: number;
    readonly violations: number;
  };
  readonly scope: {
    readonly protectedFiles: readonly string[];
    readonly protectedScopes: readonly NeutralityScope[];
  };
  readonly violations: readonly NeutralityViolation[];
}

export interface ScanNeutralityTextResult {
  readonly ok: boolean;
  readonly relativePath: string;
  readonly violations: readonly NeutralityViolation[];
  readonly bannedTerms: readonly string[];
}

export interface NeutralityScannerOptions {
  readonly repositoryRoot?: string;
  readonly policyPath?: string;
  readonly policy?: NeutralityPolicy;
}

export function loadNeutralityPolicy(options: NeutralityScannerOptions = {}): NeutralityPolicy {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const policyPath = path.resolve(repositoryRoot, options.policyPath ?? defaultNeutralityPolicyRelativePath);
  const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
  return {
    policyPath: toPosixPath(path.relative(repositoryRoot, policyPath)),
    protectedFiles: Array.isArray(parsed.protectedFiles) ? parsed.protectedFiles : [],
    protectedScopes: Array.isArray(parsed.protectedScopes) ? parsed.protectedScopes : [],
    bannedTerms: Array.isArray(parsed.bannedTerms) ? parsed.bannedTerms : [],
    bannedPathPatterns: Array.isArray(parsed.bannedPathPatterns) ? parsed.bannedPathPatterns : [],
    ignoredPrefixes: Array.isArray(parsed.ignoredPrefixes) ? parsed.ignoredPrefixes : []
  };
}

export function scanNeutralityRepository(options: NeutralityScannerOptions = {}): NeutralityReport {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const policy = options.policy ?? loadNeutralityPolicy({
    repositoryRoot,
    policyPath: options.policyPath
  });
  const targets = enumerateNeutralityTargets(repositoryRoot, policy);
  const termViolations: NeutralityViolation[] = [];
  const pathViolations: NeutralityViolation[] = [];

  for (const target of targets) {
    pathViolations.push(...scanPathViolations(target.relativePath, policy.bannedPathPatterns));
    termViolations.push(...scanTextViolations(target, policy.bannedTerms));
  }

  const violations = [...termViolations, ...pathViolations]
    .sort((left, right) => `${left.file}:${left.kind}:${left.matchedRule}:${left.line ?? 0}`.localeCompare(`${right.file}:${right.kind}:${right.matchedRule}:${right.line ?? 0}`));
  const report: NeutralityReport = {
    schemaId: 'atm.neutralityReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'ATM-CORE-0003 deterministic neutrality scan report.'
    },
    atomId: 'ATM-CORE-0003',
    legacyPlanningId: 'ATM-CORE-0003',
    repositoryRoot: toPosixPath(repositoryRoot),
    policyPath: policy.policyPath,
    ok: violations.length === 0,
    exitCode: violations.length === 0 ? 0 : 1,
    totals: {
      scannedFiles: targets.length,
      termViolations: termViolations.length,
      pathViolations: pathViolations.length,
      violations: violations.length
    },
    scope: {
      protectedFiles: [...policy.protectedFiles],
      protectedScopes: policy.protectedScopes.map((scope: NeutralityScope) => ({ ...scope }))
    },
    violations
  };
  return report;
}

export function formatGitHubAnnotations(report: NeutralityReport): string[] {
  return (report.violations || []).map((violation: NeutralityViolation) => {
    const location = typeof violation.line === 'number'
      ? `file=${violation.file},line=${violation.line}`
      : `file=${violation.file}`;
    return `::error ${location}::Neutrality ${violation.kind} violation (${violation.matchedRule})`;
  });
}

export interface ScanNeutralityTextInput {
  readonly relativePath?: string;
  readonly content?: string;
}

export function scanNeutralityText(input: ScanNeutralityTextInput, options: NeutralityScannerOptions = {}): ScanNeutralityTextResult {
  const policy = options.policy ?? loadNeutralityPolicy({
    repositoryRoot: options.repositoryRoot ?? repoRoot,
    policyPath: options.policyPath
  });
  const relativePath = toPosixPath(input?.relativePath ?? '<inline>');
  const content = String(input?.content ?? '');
  const termViolations = scanInlineTextViolations(content, relativePath, policy.bannedTerms);
  const pathViolations = scanPathViolations(relativePath, policy.bannedPathPatterns);
  return {
    ok: termViolations.length === 0 && pathViolations.length === 0,
    relativePath,
    violations: [...termViolations, ...pathViolations],
    bannedTerms: [...policy.bannedTerms]
  };
}

function enumerateNeutralityTargets(repositoryRoot: string, policy: NeutralityPolicy): NeutralityTarget[] {
  const output: NeutralityTarget[] = [];
  walkDirectory(repositoryRoot, repositoryRoot, policy.ignoredPrefixes, output);
  return output.filter((target) => isProtectedTarget(target.relativePath, policy));
}

function walkDirectory(repositoryRoot: string, currentDir: string, ignoredPrefixes: readonly string[], output: NeutralityTarget[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = toPosixPath(path.relative(repositoryRoot, fullPath));
    if (shouldIgnore(relativePath, ignoredPrefixes)) {
      continue;
    }
    if (entry.isDirectory()) {
      walkDirectory(repositoryRoot, fullPath, ignoredPrefixes, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    output.push({
      fullPath,
      relativePath
    });
  }
}

function isProtectedTarget(relativePath: string, policy: NeutralityPolicy): boolean {
  if (policy.protectedFiles.includes(relativePath)) {
    return true;
  }
  return policy.protectedScopes.some((scope: NeutralityScope) => matchesScope(relativePath, scope));
}

function matchesScope(relativePath: string, scope: NeutralityScope): boolean {
  const normalizedPath = toPosixPath(relativePath);
  const includeMatch = scope.pathPrefix
    ? normalizedPath.startsWith(scope.pathPrefix)
    : (scope.path ? (normalizedPath === scope.path || normalizedPath.startsWith(`${scope.path}/`)) : false);
  if (!includeMatch) {
    return false;
  }
  if (Array.isArray(scope.excludePrefixes) && scope.excludePrefixes.some((prefix: string) => normalizedPath.startsWith(prefix))) {
    return false;
  }
  if (!Array.isArray(scope.extensions) || scope.extensions.length === 0) {
    return true;
  }
  return scope.extensions.some((extension: string) => normalizedPath.endsWith(extension));
}

function scanTextViolations(target: NeutralityTarget, bannedTerms: readonly string[]): NeutralityViolation[] {
  const content = readFileSync(target.fullPath, 'utf8');
  return scanInlineTextViolations(content, target.relativePath, bannedTerms);
}

function scanInlineTextViolations(content: string, relativePath: string, bannedTerms: readonly string[]): NeutralityViolation[] {
  const normalizedContent = content.toLowerCase();
  const violations: NeutralityViolation[] = [];

  for (const term of bannedTerms) {
    const normalizedTerm = String(term || '').toLowerCase();
    if (!normalizedTerm) {
      continue;
    }
    let startIndex = 0;
    while (startIndex < normalizedContent.length) {
      const matchedIndex = normalizedContent.indexOf(normalizedTerm, startIndex);
      if (matchedIndex < 0) {
        break;
      }
      violations.push({
        kind: 'term',
        file: relativePath,
        line: lineNumberForIndex(content, matchedIndex),
        matchedRule: term
      });
      startIndex = matchedIndex + normalizedTerm.length;
    }
  }

  return violations;
}

function scanPathViolations(relativePath: string, bannedPathPatterns: readonly string[]): NeutralityViolation[] {
  const normalizedPath = toPosixPath(relativePath);
  return (bannedPathPatterns || [])
    .filter((pattern: string) => matchesPathPattern(normalizedPath, pattern))
    .map((pattern: string) => ({
      kind: 'path',
      file: normalizedPath,
      matchedRule: pattern
    }));
}

function matchesPathPattern(relativePath: string, pattern: string): boolean {
  if (pattern === '<non-ascii-filename>') {
    return /[^\x00-\x7F]/u.test(path.posix.basename(relativePath));
  }
  return relativePath.includes(pattern);
}

function shouldIgnore(relativePath: string, ignoredPrefixes: readonly string[]): boolean {
  return (ignoredPrefixes || []).some((prefix: string) => relativePath === prefix.replace(/\/$/, '') || relativePath.startsWith(prefix));
}

function lineNumberForIndex(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/u).length;
}

function toPosixPath(inputPath: string | null | undefined): string {
  return String(inputPath || '').replace(/\\/g, '/');
}
