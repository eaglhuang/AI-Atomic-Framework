import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeProject } from '../../../core/src/guidance/index.ts';

export interface RuntimeAdapterReadinessSummary {
  readonly pythonOnlyHost: boolean;
  readonly needsRuntimeAdapterHint: boolean;
  readonly detectedLanguages: readonly string[];
  readonly bundledLanguageAdapters: readonly string[];
  readonly bundledProjectAdapters: readonly string[];
  readonly pythonLanguageAdapterAvailable: boolean;
  readonly candidateRankingAllowed: boolean;
  readonly atomBirthApplyDeferred: boolean;
  readonly missingCapability: 'python-language-adapter' | null;
  readonly suggestedAction: string | null;
  readonly explanation: string | null;
}

export function inspectRuntimeAdapterReadiness(repositoryRoot: string): RuntimeAdapterReadinessSummary {
  const orientation = probeProject(repositoryRoot);
  const pythonOnlyHost = orientation.detectedLanguages.includes('Python')
    && !orientation.detectedLanguages.includes('JavaScript')
    && !orientation.detectedLanguages.includes('TypeScript');
  const bundledLanguageAdapters = listBundledPackageNames((packageDirName) => packageDirName.startsWith('language-'));
  const bundledProjectAdapters = listBundledPackageNames((packageDirName) =>
    packageDirName.startsWith('adapter-') || packageDirName === 'plugin-governance-local'
  );
  const pythonLanguageAdapterAvailable = bundledLanguageAdapters.some((packageName) => /python/i.test(packageName));

  if (!pythonOnlyHost) {
    return {
      pythonOnlyHost: false,
      needsRuntimeAdapterHint: false,
      detectedLanguages: orientation.detectedLanguages,
      bundledLanguageAdapters,
      bundledProjectAdapters,
      pythonLanguageAdapterAvailable,
      candidateRankingAllowed: false,
      atomBirthApplyDeferred: false,
      missingCapability: null,
      suggestedAction: null,
      explanation: null
    };
  }

  return {
    pythonOnlyHost: true,
    needsRuntimeAdapterHint: true,
    detectedLanguages: orientation.detectedLanguages,
    bundledLanguageAdapters,
    bundledProjectAdapters,
    pythonLanguageAdapterAvailable,
    candidateRankingAllowed: true,
    atomBirthApplyDeferred: true,
    missingCapability: pythonLanguageAdapterAvailable ? null : 'python-language-adapter',
    suggestedAction: pythonLanguageAdapterAvailable
      ? 'Select and wire the Python runtime/language adapter for this repository before expecting ATM atom birth or apply routes to mutate Python surfaces.'
      : 'This ATM release does not bundle a dedicated Python language adapter/plugin yet. Continue with candidate ranking, source inventory, and docs-first analysis, and treat atom birth/apply as deferred until a Python adapter/plugin is selected or implemented.',
    explanation: pythonLanguageAdapterAvailable
      ? 'Python entrypoints were detected. Candidate ranking can continue, but atom birth/apply should wait until the Python runtime adapter is selected for this host.'
      : 'Python entrypoints were detected, but this ATM release currently ships editor integrations plus local governance/local-git support without a dedicated Python language adapter/plugin.'
  };
}

function listBundledPackageNames(includePackageDir: (packageDirName: string) => boolean): readonly string[] {
  const packagesRoot = resolveFrameworkPackagesRoot();
  if (!existsSync(packagesRoot)) {
    return [];
  }
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && includePackageDir(entry.name))
    .map((entry) => readPackageName(path.join(packagesRoot, entry.name, 'package.json')) ?? `@ai-atomic-framework/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function resolveFrameworkPackagesRoot() {
  const commandsDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(commandsDirectory, '..', '..', '..', '..', 'packages');
}

function readPackageName(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { readonly name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}
