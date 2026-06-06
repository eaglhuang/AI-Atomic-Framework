import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { defaultMutationPolicy, type HostGate, type LegacyHotspot, type LegacyHotspotConfig, type MutationPolicy, type NoTouchZone, type ProjectOrientationReport, type StateSummary } from './guidance-packet.ts';

export interface ProjectProbeOptions {
  readonly hostGates?: readonly HostGate[];
  readonly noTouchZones?: readonly NoTouchZone[];
  readonly mutationPolicy?: Partial<MutationPolicy>;
}

export function probeProject(repositoryRoot: string, options: ProjectProbeOptions = {}): ProjectOrientationReport {
  const root = path.resolve(repositoryRoot);
  const packageJson = readJsonIfExists(path.join(root, 'package.json')) as Record<string, unknown> | null;
  const detectedLanguages = detectLanguages(root, packageJson);
  const packageManager = detectPackageManager(root);
  const testEntrypoints = detectTestEntrypoints(packageJson);
  const governanceFiles = detectGovernanceFiles(root);
  const availableAdapters = detectAvailableAdapters(root, packageJson);
  const registryState = summarizeState(root, [
    'atomic-registry.json',
    path.join('.atm', 'catalog', 'index', 'registry.json'),
    path.join('.atm', 'registry')
  ]);
  const mapState = summarizeState(root, [
    path.join('atomic_workbench', 'maps'),
    path.join('.atm', 'catalog', 'shards')
  ]);
  const atomState = summarizeState(root, [
    path.join('atomic_workbench', 'atoms'),
    path.join('packages', 'core', 'src')
  ]);
  const unknowns = buildUnknowns(root, packageJson, packageManager, testEntrypoints, governanceFiles, detectedLanguages);
  const hostGates = options.hostGates ?? [];
  const noTouchZones = options.noTouchZones ?? [];
  const mutationPolicy = {
    ...defaultMutationPolicy,
    ...(options.mutationPolicy ?? {})
  };
  const atmConfig = readAtmConfig(root);
  const configHotspots = extractConfigLegacyHotspots(atmConfig);
  const configNoTouchZones = extractConfigNoTouchZones(atmConfig);
  const configDefaultLegacyFlow = extractConfigDefaultLegacyFlow(atmConfig);
  const mergedNoTouchZones = [...noTouchZones, ...configNoTouchZones];
  const adapterStatus = governanceFiles.includes('.atm/config.json') || availableAdapters.length > 0
    ? {
        status: 'available' as const,
        reason: availableAdapters.length > 0 ? 'at least one adapter is available' : '.atm/config.json exists'
      }
    : {
        status: 'missing' as const,
        reason: 'no ATM config or adapter package was detected'
      };

  return {
    schemaId: 'atm.projectOrientationReport',
    specVersion: '0.1.0',
    repositoryRoot: root,
    detectedLanguages,
    packageManager,
    testEntrypoints,
    governanceFiles,
    adapterStatus,
    availableAdapters,
    registryState,
    mapState,
    atomState,
    legacyUriSupport: {
      supported: true,
      scheme: 'legacy',
      resolver: availableAdapters.includes('@ai-atomic-framework/adapter-local-git') ? '@ai-atomic-framework/adapter-local-git' : 'local-git-compatible'
    },
    hostGates,
    noTouchZones: mergedNoTouchZones,
    mutationPolicy,
    legacyHotspots: detectLegacyHotspots(root),
    configLegacyHotspots: configHotspots,
    releaseBlockers: buildReleaseBlockers(root, packageJson, detectedLanguages),
    releaseAdvisories: buildReleaseAdvisories(root, packageJson, detectedLanguages),
    defaultLegacyFlow: configDefaultLegacyFlow,
    unknowns
  };
}

function detectLanguages(root: string, packageJson: Record<string, unknown> | null): readonly string[] {
  const languages = new Set<string>();
  if (existsSync(path.join(root, 'tsconfig.json'))) {
    languages.add('TypeScript');
  }
  if (packageJson || existsSync(path.join(root, 'package.json'))) {
    languages.add('JavaScript');
  }
  if (existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'requirements.txt'))) {
    languages.add('Python');
  }
  if (existsSync(path.join(root, 'pom.xml')) || existsSync(path.join(root, 'build.gradle')) || existsSync(path.join(root, 'build.gradle.kts')) || hasFileWithExtension(root, '.java')) {
    languages.add('Java');
  }
  if (hasFileWithExtension(root, '.csproj') || hasFileWithExtension(root, '.sln') || hasFileWithExtension(root, '.cs')) {
    languages.add('C#');
  }
  return [...languages].sort();
}

function detectPackageManager(root: string): string | null {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(path.join(root, 'pom.xml'))) return 'maven';
  if (existsSync(path.join(root, 'build.gradle')) || existsSync(path.join(root, 'build.gradle.kts'))) return 'gradle';
  if (hasFileWithExtension(root, '.csproj') || hasFileWithExtension(root, '.sln')) return 'dotnet';
  return null;
}

function detectTestEntrypoints(packageJson: Record<string, unknown> | null): readonly string[] {
  const scripts = typeof packageJson?.scripts === 'object' && packageJson.scripts !== null
    ? packageJson.scripts as Record<string, unknown>
    : {};
  return Object.entries(scripts)
    .filter(([name]) => /test|validate|typecheck|lint/.test(name))
    .map(([name, command]) => `${name}: ${String(command)}`)
    .sort();
}

function detectGovernanceFiles(root: string): readonly string[] {
  return [
    '.atm/config.json',
    '.atm/runtime/current-task.json',
    '.atm/runtime/project-probe.json',
    'AGENTS.md',
    'CLAUDE.md',
    'atomic-registry.json'
  ].filter((relativePath) => existsSync(path.join(root, relativePath)));
}

function detectAvailableAdapters(root: string, packageJson: Record<string, unknown> | null): readonly string[] {
  const adapters = new Set<string>();
  const dependencies = {
    ...(typeof packageJson?.dependencies === 'object' && packageJson.dependencies !== null ? packageJson.dependencies as Record<string, unknown> : {}),
    ...(typeof packageJson?.devDependencies === 'object' && packageJson.devDependencies !== null ? packageJson.devDependencies as Record<string, unknown> : {})
  };
  for (const dependencyName of Object.keys(dependencies)) {
    if (dependencyName.includes('adapter')) {
      adapters.add(dependencyName);
    }
  }
  if (existsSync(path.join(root, 'packages', 'adapter-local-git'))) {
    adapters.add('@ai-atomic-framework/adapter-local-git');
  }
  if (existsSync(path.join(root, 'packages', 'language-js'))) {
    adapters.add('@ai-atomic-framework/language-js');
  }
  if (existsSync(path.join(root, 'packages', 'language-python'))) {
    adapters.add('@ai-atomic-framework/language-python');
  }
  return [...adapters].sort();
}

function summarizeState(root: string, relativePaths: readonly string[]): StateSummary {
  const existingPaths = relativePaths.filter((relativePath) => existsSync(path.join(root, relativePath)));
  if (existingPaths.length === 0) {
    return { status: 'missing', paths: [] };
  }
  const count = existingPaths.reduce((total, relativePath) => total + countEntries(path.join(root, relativePath)), 0);
  return {
    status: existingPaths.length === relativePaths.length ? 'present' : 'partial',
    paths: existingPaths.map((entry) => entry.replace(/\\/g, '/')),
    count
  };
}

function countEntries(absolutePath: string): number {
  if (!existsSync(absolutePath)) return 0;
  const stats = statSync(absolutePath);
  if (stats.isFile()) return 1;
  return readdirSync(absolutePath).length;
}

function detectLegacyHotspots(root: string): readonly LegacyHotspot[] {
  const candidates = ['src', 'packages', 'scripts']
    .map((relativePath) => path.join(root, relativePath))
    .filter((absolutePath) => existsSync(absolutePath));
  const hotspots: LegacyHotspot[] = [];
  for (const candidate of candidates) {
    for (const filePath of listSourceFiles(candidate, 20)) {
      const lineCount = readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      if (lineCount >= 250) {
        hotspots.push({
          path: path.relative(root, filePath).replace(/\\/g, '/'),
          reason: `source file has ${lineCount} lines`,
          riskLevel: lineCount >= 500 ? 'high' : 'medium'
        });
      }
      if (hotspots.length >= 10) {
        return hotspots;
      }
    }
  }
  return hotspots;
}

function listSourceFiles(directoryPath: string, limit: number): readonly string[] {
  const output: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (output.length >= limit) break;
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      output.push(...listSourceFiles(absolutePath, limit - output.length));
      continue;
    }
    if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function buildUnknowns(
  root: string,
  packageJson: Record<string, unknown> | null,
  packageManager: string | null,
  testEntrypoints: readonly string[],
  governanceFiles: readonly string[],
  detectedLanguages: readonly string[]
): readonly string[] {
  const unknowns: string[] = [];
  const nonJavaScriptHost = isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages);
  if (!packageJson && !nonJavaScriptHost) unknowns.push('package.json');
  if (!packageManager && !nonJavaScriptHost) unknowns.push('packageManager');
  if (testEntrypoints.length === 0) unknowns.push('testEntrypoints');
  if (!governanceFiles.includes('.atm/config.json')) unknowns.push('atmConfig');
  if (!existsSync(path.join(root, '.git'))) unknowns.push('gitRepository');
  return unknowns;
}

function buildReleaseBlockers(root: string, packageJson: Record<string, unknown> | null, detectedLanguages: readonly string[]): readonly string[] {
  const blockers: string[] = [];
  if (!packageJson && !isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages)) blockers.push('package-json-missing');
  if (!existsSync(path.join(root, '.git'))) blockers.push('git-repository-missing');
  return blockers;
}

function buildReleaseAdvisories(root: string, packageJson: Record<string, unknown> | null, detectedLanguages: readonly string[]): readonly string[] {
  const advisories: string[] = [];
  if (!packageJson && isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages)) {
    advisories.push('package-json-missing:advisory');
    advisories.push(`${detectedLanguages.join('+').toLowerCase()}-entrypoints-detected`);
    advisories.push('candidate-ranking-allowed');
    advisories.push('create-atom-route-deferred-until-language-adapter-selected');
  }
  return advisories;
}

function isNonJavaScriptHostWithoutPackageJson(packageJson: Record<string, unknown> | null, detectedLanguages: readonly string[]): boolean {
  return !packageJson
    && detectedLanguages.length > 0
    && !detectedLanguages.includes('JavaScript')
    && !detectedLanguages.includes('TypeScript');
}

function isPythonOnlyAdopter(packageJson: Record<string, unknown> | null, detectedLanguages: readonly string[]): boolean {
  return !packageJson
    && detectedLanguages.includes('Python')
    && !detectedLanguages.includes('JavaScript')
    && !detectedLanguages.includes('TypeScript');
}

function hasFileWithExtension(root: string, extension: string): boolean {
  for (const relativePath of ['', 'src']) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(extension)) return true;
      if (entry.isDirectory() && relativePath === '') {
        if (shouldSkipProbeDirectory(entry.name)) continue;
        const nestedPath = path.join(absolutePath, entry.name);
        try {
          if (readdirSync(nestedPath, { withFileTypes: true }).some((nestedEntry) => nestedEntry.isFile() && nestedEntry.name.endsWith(extension))) {
            return true;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return false;
}

function shouldSkipProbeDirectory(name: string): boolean {
  return new Set([
    '.git',
    '.atm',
    '.atm-temp',
    '.tmp',
    '.venv',
    'node_modules',
    'library',
    'temp',
    'tmp',
    'local',
    'artifacts',
    'profiles',
    'settings',
    'scratch',
    'dist',
    'build',
    'release',
    'coverage'
  ]).has(name);
}

function readJsonIfExists(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readAtmConfig(root: string): Record<string, unknown> | null {
  return readJsonIfExists(path.join(root, '.atm', 'config.json')) as Record<string, unknown> | null;
}

function extractConfigLegacyHotspots(atmConfig: Record<string, unknown> | null): readonly LegacyHotspotConfig[] {
  const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
    ? atmConfig.guidance as Record<string, unknown>
    : null;
  if (!guidance || !Array.isArray(guidance.legacyHotspots)) return [];
  return (guidance.legacyHotspots as unknown[]).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string') return [];
    return [{
      path: e.path,
      releaseBlockers: Array.isArray(e.releaseBlockers)
        ? (e.releaseBlockers as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
      demandReportPath: typeof e.demandReportPath === 'string' ? e.demandReportPath : null,
      existingAtomIndexPath: typeof e.existingAtomIndexPath === 'string' ? e.existingAtomIndexPath : null
    } satisfies LegacyHotspotConfig];
  });
}

function extractConfigNoTouchZones(atmConfig: Record<string, unknown> | null): readonly NoTouchZone[] {
  const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
    ? atmConfig.guidance as Record<string, unknown>
    : null;
  if (!guidance || !Array.isArray(guidance.noTouchZones)) return [];
  return (guidance.noTouchZones as unknown[]).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string') return [];
    const scope = e.scope === 'file' || e.scope === 'directory' || e.scope === 'glob' ? e.scope : 'unknown' as const;
    return [{
      path: e.path,
      reason: typeof e.reason === 'string' ? e.reason : 'declared in .atm/config.json',
      scope
    } satisfies NoTouchZone];
  });
}

function extractConfigDefaultLegacyFlow(atmConfig: Record<string, unknown> | null): 'shadow' | 'dry-run' | undefined {
  const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
    ? atmConfig.guidance as Record<string, unknown>
    : null;
  if (!guidance) return undefined;
  const flow = guidance.defaultLegacyFlow;
  if (flow === 'shadow' || flow === 'dry-run') return flow;
  return undefined;
}
