import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

export const defaultNeutralityPolicyRelativePath = 'docs/governance/docs-neutrality-policy.json';

export function loadNeutralityPolicy(options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const policyPath = path.resolve(repositoryRoot, options.policyPath ?? defaultNeutralityPolicyRelativePath);
  const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
  return {
    ...parsed,
    policyPath: toPosixPath(path.relative(repositoryRoot, policyPath)),
    protectedFiles: Array.isArray(parsed.protectedFiles) ? parsed.protectedFiles : [],
    protectedScopes: Array.isArray(parsed.protectedScopes) ? parsed.protectedScopes : [],
    bannedTerms: Array.isArray(parsed.bannedTerms) ? parsed.bannedTerms : [],
    bannedPathPatterns: Array.isArray(parsed.bannedPathPatterns) ? parsed.bannedPathPatterns : [],
    ignoredPrefixes: Array.isArray(parsed.ignoredPrefixes) ? parsed.ignoredPrefixes : []
  };
}

export function scanNeutralityRepository(options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const policy = options.policy ?? loadNeutralityPolicy({
    repositoryRoot,
    policyPath: options.policyPath
  });
  const targets = enumerateNeutralityTargets(repositoryRoot, policy);
  const termViolations = [];
  const pathViolations = [];

  for (const target of targets) {
    pathViolations.push(...scanPathViolations(target.relativePath, policy.bannedPathPatterns));
    termViolations.push(...scanTextViolations(target, policy.bannedTerms));
  }

  const violations = [...termViolations, ...pathViolations]
    .sort((left, right) => `${left.file}:${left.kind}:${left.matchedRule}:${left.line ?? 0}`.localeCompare(`${right.file}:${right.kind}:${right.matchedRule}:${right.line ?? 0}`));
  const report = {
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
      protectedScopes: policy.protectedScopes.map((scope: any) => ({ ...scope }))
    },
    violations
  };
  return report;
}

export function formatGitHubAnnotations(report: any) {
  return (report.violations || []).map((violation: any) => {
    const location = typeof violation.line === 'number'
      ? `file=${violation.file},line=${violation.line}`
      : `file=${violation.file}`;
    return `::error ${location}::Neutrality ${violation.kind} violation (${violation.matchedRule})`;
  });
}

export function scanNeutralityText(input: any, options: any = {}) {
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

function enumerateNeutralityTargets(repositoryRoot: any, policy: any) {
  const output: any[] = [];
  walkDirectory(repositoryRoot, repositoryRoot, policy.ignoredPrefixes, output);
  return output.filter((target) => isProtectedTarget(target.relativePath, policy));
}

function walkDirectory(repositoryRoot: any, currentDir: any, ignoredPrefixes: any, output: any) {
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

function isProtectedTarget(relativePath: any, policy: any) {
  if (policy.protectedFiles.includes(relativePath)) {
    return true;
  }
  return policy.protectedScopes.some((scope: any) => matchesScope(relativePath, scope));
}

function matchesScope(relativePath: any, scope: any) {
  const normalizedPath = toPosixPath(relativePath);
  const includeMatch = scope.pathPrefix
    ? normalizedPath.startsWith(scope.pathPrefix)
    : normalizedPath === scope.path || normalizedPath.startsWith(`${scope.path}/`);
  if (!includeMatch) {
    return false;
  }
  if (Array.isArray(scope.excludePrefixes) && scope.excludePrefixes.some((prefix: any) => normalizedPath.startsWith(prefix))) {
    return false;
  }
  if (!Array.isArray(scope.extensions) || scope.extensions.length === 0) {
    return true;
  }
  return scope.extensions.some((extension: any) => normalizedPath.endsWith(extension));
}

function scanTextViolations(target: any, bannedTerms: any) {
  const content = readFileSync(target.fullPath, 'utf8');
  return scanInlineTextViolations(content, target.relativePath, bannedTerms);
}

function scanInlineTextViolations(content: any, relativePath: any, bannedTerms: any) {
  const normalizedContent = content.toLowerCase();
  const violations: any[] = [];

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

function scanPathViolations(relativePath: any, bannedPathPatterns: any) {
  const normalizedPath = toPosixPath(relativePath);
  return (bannedPathPatterns || [])
    .filter((pattern: any) => matchesPathPattern(normalizedPath, pattern))
    .map((pattern: any) => ({
      kind: 'path',
      file: normalizedPath,
      matchedRule: pattern
    }));
}

function matchesPathPattern(relativePath: any, pattern: any) {
  if (pattern === '<non-ascii-filename>') {
    return /[^\x00-\x7F]/u.test(path.posix.basename(relativePath));
  }
  return relativePath.includes(pattern);
}

function shouldIgnore(relativePath: any, ignoredPrefixes: any) {
  return (ignoredPrefixes || []).some((prefix: any) => relativePath === prefix.replace(/\/$/, '') || relativePath.startsWith(prefix));
}

function lineNumberForIndex(text: any, index: any) {
  return text.slice(0, index).split(/\r?\n/u).length;
}

function toPosixPath(inputPath: any) {
  return String(inputPath || '').replace(/\\/g, '/');
}
