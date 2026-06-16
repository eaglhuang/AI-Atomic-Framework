import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'scripts/AtmCore/runner-build-scope.json');
const packageJsonPath = path.join(repositoryRoot, 'package.json');

type RunnerBuildScopeManifest = {
  schemaId: string;
  specVersion: string;
  policy: {
    mode: string;
    generatedArtifactWriter: string;
    sourceAgentRule: string;
  };
  runnerAffectingSourceRoots: string[];
  buildChainScripts: string[];
  buildConfigPaths: string[];
  rootLaunchers: string[];
  schemaRoots: string[];
  generatedArtifacts: string[];
  nonCorePlanningUtilities: string[];
};

function fail(message: string): never {
  console.error(`[runner-build-scope:validate] ${message}`);
  process.exit(1);
}

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    fail(`failed to read JSON ${path.relative(repositoryRoot, filePath)}: ${(error as Error).message}`);
  }
}

function assertIncludes(values: string[], required: string[], label: string): void {
  const missing = required.filter((item) => !values.includes(item));
  if (missing.length > 0) {
    fail(`${label} missing required entries: ${missing.join(', ')}`);
  }
}

function assertPathsExist(paths: string[], label: string): void {
  const missing = paths
    .filter((item) => !item.includes('*'))
    .filter((item) => !item.startsWith('release/'))
    .filter((item) => !existsSync(path.join(repositoryRoot, item)));
  if (missing.length > 0) {
    fail(`${label} references missing paths: ${missing.join(', ')}`);
  }
}

function extractBuildScriptPaths(buildCommand: string): string[] {
  return [...buildCommand.matchAll(/node\s+--strip-types\s+([^\s]+)/g)].map((match) => match[1]);
}

function assertRunnerSourceIsSeparatedFromPlanning(manifest: RunnerBuildScopeManifest): void {
  const planningUtilityRoots = ['docs/', 'examples/', 'atomic_workbench/', '.atm/history/', '.atm/runtime/'];
  assertIncludes(manifest.nonCorePlanningUtilities, planningUtilityRoots, 'nonCorePlanningUtilities');

  const accidentalPlanningRoots = manifest.runnerAffectingSourceRoots.filter((root) =>
    planningUtilityRoots.some((planningRoot) => root === planningRoot || root.startsWith(planningRoot))
  );
  if (accidentalPlanningRoots.length > 0) {
    fail(`runnerAffectingSourceRoots must not include non-core planning utilities: ${accidentalPlanningRoots.join(', ')}`);
  }
}

function main(): void {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'validate';
  if (mode !== 'validate') fail(`unsupported mode: ${mode}`);

  const manifest = readJson<RunnerBuildScopeManifest>(manifestPath);
  const packageJson = readJson<{ scripts?: Record<string, string> }>(packageJsonPath);
  const buildCommand = packageJson.scripts?.build;
  if (!buildCommand) fail('package.json scripts.build is missing');

  if (manifest.schemaId !== 'atm.runnerBuildScope.v1') fail(`unexpected schemaId: ${manifest.schemaId}`);
  if (manifest.policy.mode !== 'runner-sync-steward-v1') fail(`unexpected policy.mode: ${manifest.policy.mode}`);
  if (manifest.policy.generatedArtifactWriter !== 'single-writer-steward') {
    fail(`unexpected generatedArtifactWriter: ${manifest.policy.generatedArtifactWriter}`);
  }

  const buildChainScripts = extractBuildScriptPaths(buildCommand);
  assertIncludes(manifest.buildChainScripts, buildChainScripts, 'buildChainScripts');

  assertIncludes(manifest.runnerAffectingSourceRoots, [
    'packages/core/src/',
    'packages/cli/src/',
    'packages/plugin-governance-local/src/',
    'schemas/',
    'scripts/AtmCore/'
  ], 'runnerAffectingSourceRoots');
  assertIncludes(manifest.rootLaunchers, ['atm.mjs', 'atm.dev.mjs'], 'rootLaunchers');
  assertIncludes(manifest.buildConfigPaths, ['package.json', 'tsconfig.json', 'tsconfig.build.json'], 'buildConfigPaths');
  assertIncludes(manifest.schemaRoots, ['schemas/'], 'schemaRoots');
  assertIncludes(manifest.generatedArtifacts, [
    'release/atm-root-drop/',
    'release/atm-onefile/',
    'release/atm-onefile/atm.mjs',
    'release/atm-onefile/release-manifest.json',
    'release/atm-root-drop/release-manifest.json'
  ], 'generatedArtifacts');
  assertRunnerSourceIsSeparatedFromPlanning(manifest);

  assertPathsExist(manifest.buildChainScripts, 'buildChainScripts');
  assertPathsExist(manifest.buildConfigPaths, 'buildConfigPaths');
  assertPathsExist(manifest.rootLaunchers, 'rootLaunchers');
  assertPathsExist(manifest.schemaRoots, 'schemaRoots');

  console.log(`[runner-build-scope:validate] ok (${buildChainScripts.length} build-chain script(s), ${manifest.runnerAffectingSourceRoots.length} runner source root(s))`);
}

main();
