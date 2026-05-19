import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeProject } from '../../../core/src/guidance/index.ts';

export interface RuntimeAdapterReadinessSummary {
  readonly pythonOnlyHost: boolean;
  readonly languageOnlyHost: boolean;
  readonly needsRuntimeAdapterHint: boolean;
  readonly detectedLanguages: readonly string[];
  readonly bundledLanguageAdapters: readonly string[];
  readonly bundledProjectAdapters: readonly string[];
  readonly pythonLanguageAdapterAvailable: boolean;
  readonly missingLanguageAdapters: readonly string[];
  readonly candidateRankingAllowed: boolean;
  readonly atomBirthApplyDeferred: boolean;
  readonly missingCapability: string | null;
  readonly suggestedAction: string | null;
  readonly explanation: string | null;
}

export function inspectRuntimeAdapterReadiness(repositoryRoot: string): RuntimeAdapterReadinessSummary {
  const orientation = probeProject(repositoryRoot);
  const pythonOnlyHost = orientation.detectedLanguages.includes('Python')
    && !orientation.detectedLanguages.includes('JavaScript')
    && !orientation.detectedLanguages.includes('TypeScript');
  const languageOnlyHost = orientation.detectedLanguages.length > 0
    && !orientation.detectedLanguages.includes('JavaScript')
    && !orientation.detectedLanguages.includes('TypeScript');
  const bundledLanguageAdapters = listBundledPackageNames((packageDirName) => packageDirName.startsWith('language-'));
  const bundledProjectAdapters = listBundledPackageNames((packageDirName) =>
    packageDirName.startsWith('adapter-') || packageDirName === 'plugin-governance-local'
  );
  const pythonLanguageAdapterAvailable =
    bundledLanguageAdapters.some((packageName) => /python/i.test(packageName))
    || hasLocalLanguagePythonPackage();
  const missingLanguageAdapters = orientation.detectedLanguages.filter((language) =>
    !hasBundledLanguageAdapter(language, bundledLanguageAdapters)
  );

  if (!languageOnlyHost) {
    return {
      pythonOnlyHost: false,
      languageOnlyHost: false,
      needsRuntimeAdapterHint: false,
      detectedLanguages: orientation.detectedLanguages,
      bundledLanguageAdapters,
      bundledProjectAdapters,
      pythonLanguageAdapterAvailable,
      missingLanguageAdapters,
      candidateRankingAllowed: false,
      atomBirthApplyDeferred: false,
      missingCapability: null,
      suggestedAction: null,
      explanation: null
    };
  }

  return {
    pythonOnlyHost,
    languageOnlyHost: true,
    needsRuntimeAdapterHint: missingLanguageAdapters.length > 0,
    detectedLanguages: orientation.detectedLanguages,
    bundledLanguageAdapters,
    bundledProjectAdapters,
    pythonLanguageAdapterAvailable,
    missingLanguageAdapters,
    candidateRankingAllowed: true,
    atomBirthApplyDeferred: missingLanguageAdapters.length > 0,
    missingCapability: missingLanguageAdapters.length > 0 ? 'language-adapter' : null,
    suggestedAction: missingLanguageAdapters.length > 0
      ? `ATM detected ${missingLanguageAdapters.join(', ')} source but no bundled language adapter for that language. Continue with guide/orient, candidate ranking, source inventory, police evidence, or docs-first work; defer atom birth/apply until a matching adapter is installed or implemented.`
      : 'The bundled language adapter can drive source inventory and dry-run atomize/infect plans. Atom apply still requires evidence and review gates.',
    explanation: missingLanguageAdapters.length > 0
      ? 'A non-JavaScript host language was detected without a matching bundled language adapter. This is an expected adapter gap, not host-repo corruption; discovery routes stay available while apply routes remain deferred.'
      : 'A non-JavaScript host language was detected and a matching bundled language adapter is available. Candidate ranking, dry-run atomize/infect, and source inventory are supported; apply still flows through review and police gates.'
  };
}

function hasLocalLanguagePythonPackage(): boolean {
  const packagesRoot = resolveFrameworkPackagesRoot();
  if (!existsSync(packagesRoot)) return false;
  const candidateDir = path.join(packagesRoot, 'language-python');
  if (!existsSync(candidateDir)) return false;
  const packageJsonPath = path.join(candidateDir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  const packageName = readPackageName(packageJsonPath);
  return packageName === '@ai-atomic-framework/language-python';
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

function hasBundledLanguageAdapter(language: string, bundledLanguageAdapters: readonly string[]): boolean {
  const normalizedLanguage = normalizeLanguageKey(language);
  if (normalizedLanguage === 'javascript' || normalizedLanguage === 'typescript') {
    return bundledLanguageAdapters.some((packageName) => /language-js/i.test(packageName));
  }
  return bundledLanguageAdapters.some((packageName) => packageName.toLowerCase().includes(`language-${normalizedLanguage}`));
}

function normalizeLanguageKey(language: string): string {
  return language.toLowerCase().replace(/[^a-z0-9]+/g, '');
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
