export interface RunnerBuildScopeManifest {
  readonly schemaId: 'atm.runnerBuildScope.v1';
  readonly specVersion: string;
  readonly policy: {
    readonly mode: string;
    readonly generatedArtifactWriter: string;
    readonly sourceAgentRule: string;
  };
  readonly runnerAffectingSourceRoots: readonly string[];
  readonly buildChainScripts: readonly string[];
  readonly buildConfigPaths: readonly string[];
  readonly rootLaunchers: readonly string[];
  readonly schemaRoots: readonly string[];
  readonly generatedArtifacts: readonly string[];
  readonly nonCorePlanningUtilities: readonly string[];
}

export type AtmCoreScopeKind = 'atm-core' | 'generated-artifact' | 'non-core-planning' | 'outside-atm-core';

export interface AtmCoreScopeClassification {
  readonly path: string;
  readonly kind: AtmCoreScopeKind;
  readonly matchedPattern: string | null;
  readonly stewardOnly: boolean;
}

export interface AtmCoreScopeDiagnostic {
  readonly code: 'ATM_CORE_SCOPE_UNDECLARED_WRITE' | 'ATM_CORE_SCOPE_RELEASE_WRITE_STEWARD_ONLY';
  readonly path: string;
  readonly message: string;
  readonly matchedPattern: string | null;
}

export interface AtmCoreScopeReport {
  readonly schemaId: 'atm.atmCoreScopeReport.v1';
  readonly classifications: readonly AtmCoreScopeClassification[];
  readonly diagnostics: readonly AtmCoreScopeDiagnostic[];
  readonly runnerSyncNeeded: boolean;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern.endsWith('/')) return normalizedFile.startsWith(normalizedPattern);
  if (!normalizedPattern.includes('*')) return normalizedFile === normalizedPattern;
  const escaped = normalizedPattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`).test(normalizedFile);
}

function firstMatch(filePath: string, patterns: readonly string[]): string | null {
  return patterns.find((pattern) => matchesPattern(filePath, pattern)) ?? null;
}

export function runnerAffectingPatterns(manifest: RunnerBuildScopeManifest): readonly string[] {
  return [
    ...manifest.runnerAffectingSourceRoots,
    ...manifest.buildChainScripts,
    ...manifest.buildConfigPaths,
    ...manifest.rootLaunchers,
    ...manifest.schemaRoots
  ];
}

export function classifyAtmCorePath(
  manifest: RunnerBuildScopeManifest,
  filePath: string
): AtmCoreScopeClassification {
  const path = normalizePath(filePath);
  const generatedMatch = firstMatch(path, manifest.generatedArtifacts);
  if (generatedMatch) {
    return { path, kind: 'generated-artifact', matchedPattern: generatedMatch, stewardOnly: true };
  }

  const planningMatch = firstMatch(path, manifest.nonCorePlanningUtilities);
  if (planningMatch) {
    return { path, kind: 'non-core-planning', matchedPattern: planningMatch, stewardOnly: false };
  }

  const runnerMatch = firstMatch(path, runnerAffectingPatterns(manifest));
  if (runnerMatch) {
    return { path, kind: 'atm-core', matchedPattern: runnerMatch, stewardOnly: false };
  }

  return { path, kind: 'outside-atm-core', matchedPattern: null, stewardOnly: false };
}

export function analyzeAtmCoreScope(
  manifest: RunnerBuildScopeManifest,
  filePaths: readonly string[]
): AtmCoreScopeReport {
  const classifications = filePaths.map((filePath) => classifyAtmCorePath(manifest, filePath));
  const diagnostics = classifications.flatMap((classification): AtmCoreScopeDiagnostic[] => {
    if (classification.kind === 'generated-artifact') {
      return [{
        code: 'ATM_CORE_SCOPE_RELEASE_WRITE_STEWARD_ONLY',
        path: classification.path,
        message: 'release artifacts are generated outputs and must be published by the runner sync steward',
        matchedPattern: classification.matchedPattern
      }];
    }
    if (classification.kind === 'outside-atm-core') {
      return [{
        code: 'ATM_CORE_SCOPE_UNDECLARED_WRITE',
        path: classification.path,
        message: 'path is not declared in runner build scope manifest',
        matchedPattern: null
      }];
    }
    return [];
  });

  return {
    schemaId: 'atm.atmCoreScopeReport.v1',
    classifications,
    diagnostics,
    runnerSyncNeeded: classifications.some((classification) => classification.kind === 'atm-core')
  };
}
