import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runHashPlaceholderAudit } from '../../../../scripts/audit-hash-placeholders.ts';
import { createGitHeadEvidenceCheck } from './git-head-evidence.ts';
import { atmLayoutVersion, bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { makeResult, message, parseOptions, relativePathFrom } from './shared.ts';

const legacyBehaviorPackageNames = [
  'plugin-behavior-atomize',
  'plugin-behavior-compose',
  'plugin-behavior-dedup-merge',
  'plugin-behavior-evolve',
  'plugin-behavior-expire',
  'plugin-behavior-infect',
  'plugin-behavior-merge',
  'plugin-behavior-polymorphize',
  'plugin-behavior-split',
  'plugin-behavior-sweep',
  'plugin-police-lifecycle'
];

export function runDoctor(argv: any) {
  const { options } = parseOptions(argv, 'doctor');
  const root = options.cwd;
  const rootPackage = readJsonIfExists(path.join(root, 'package.json')) ?? {};
  const frameworkContractExpected = isFrameworkContractExpected(root, rootPackage);
  const packageDirs = listPackageDirs(root);
  const hashAudit = runHashPlaceholderAudit({ root });
  const runtime = detectGovernanceRuntime(root, bootstrapTaskId);
  const legacyPackages = legacyBehaviorPackageNames.filter((name) => existsSync(path.join(root, 'packages', name)));
  const bannedRootFiles = ['temp.txt', 'tmp_get_git.ps1'];
  const presentRootFiles = bannedRootFiles.filter((name) => existsSync(path.join(root, name)));
  const hasTsNoCheck = listFiles(path.join(root, 'packages'))
    .concat(listFiles(path.join(root, 'scripts')))
    .filter((filePath: any) => /\.(ts|js|mjs)$/.test(filePath))
    .filter((filePath: any) => !filePath.endsWith(path.join('packages', 'cli', 'src', 'commands', 'doctor.ts')))
    .some((filePath: any) => /^\s*\/\/\s*@ts-nocheck\b/m.test(readFileSync(filePath, 'utf8')));
  const missingDist = packageDirs
    .map((packageDir) => ({ packageDir, js: path.join(root, packageDir, 'dist', 'index.js'), dts: path.join(root, packageDir, 'dist', 'index.d.ts') }))
    .filter((entry) => !existsSync(entry.js) || !existsSync(entry.dts))
    .map((entry) => packageDirLabel(root, entry.packageDir));
  const checks = [
    createCheck('package-manager', !frameworkContractExpected || (rootPackage.packageManager === undefined && existsSync(path.join(root, 'package-lock.json')) && !existsSync(path.join(root, 'pnpm-workspace.yaml'))), {
      official: 'npm', packageLock: existsSync(path.join(root, 'package-lock.json')), packageManagerField: rootPackage.packageManager ?? null, pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
    }),
    createCheck('public-script-contract', !frameworkContractExpected || hasRequiredScripts(rootPackage.scripts), {
      build: rootPackage.scripts?.build ?? null,
      typecheck: rootPackage.scripts?.typecheck ?? null,
      lint: rootPackage.scripts?.lint ?? null,
      test: rootPackage.scripts?.test ?? null,
      validateQuick: rootPackage.scripts?.['validate:quick'] ?? null,
      validateStandard: rootPackage.scripts?.['validate:standard'] ?? null,
      validateFull: rootPackage.scripts?.['validate:full'] ?? null
    }),
    createCheck('typescript-build-config', !frameworkContractExpected || (existsSync(path.join(root, 'tsconfig.json')) && existsSync(path.join(root, 'tsconfig.build.json')) && rootPackage.scripts?.build?.includes('tsc')), {
      tsconfig: existsSync(path.join(root, 'tsconfig.json')), buildConfig: existsSync(path.join(root, 'tsconfig.build.json')), buildScript: rootPackage.scripts?.build ?? null
    }),
    createCheck('eslint-lint-config', !frameworkContractExpected || (existsSync(path.join(root, 'eslint.config.mjs')) && rootPackage.scripts?.lint?.includes('eslint')), {
      eslintConfig: existsSync(path.join(root, 'eslint.config.mjs')), lintScript: rootPackage.scripts?.lint ?? null
    }),
    createCheck('package-surface', !frameworkContractExpected || (existsSync(path.join(root, 'packages/plugin-behavior-pack')) && legacyPackages.length === 0), { behaviorPack: existsSync(path.join(root, 'packages/plugin-behavior-pack')), legacyPackages }),
    createCheck('repo-hygiene', presentRootFiles.length === 0 && !existsSync(path.join(root, 'pnpm-workspace.yaml')), {
      forbiddenFiles: bannedRootFiles,
      presentRootFiles,
      pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
    }),
    createCheck('typescript-escape-hatches', hasTsNoCheck === false, { hasTsNoCheck }),
    createCheck('package-dist', !frameworkContractExpected || missingDist.length === 0, { packageCount: packageDirs.length, missingDist }),
    createCheck('hash-placeholders', hashAudit.ok, hashAudit),
    createCheck('self-host-alpha-entry', !frameworkContractExpected || (existsSync(path.join(root, 'packages/cli/src/commands/self-host-alpha.ts')) && existsSync(path.join(root, 'docs/SELF_HOSTING_ALPHA.md'))), { command: 'packages/cli/src/commands/self-host-alpha.ts', doc: 'docs/SELF_HOSTING_ALPHA.md' }),
    createCheck('governance-layout-v2', runtime.layoutVersion === atmLayoutVersion, {
      layoutVersion: runtime.layoutVersion,
      expectedLayoutVersion: atmLayoutVersion,
      migrationNeeded: runtime.migrationNeeded
    }),
    createCheck('charter-integrity', checkCharterIntegrity(root).ok, checkCharterIntegrity(root)),
    createGitHeadEvidenceCheck(root, runtime)
  ];
  const ok = checks.every((check) => check.ok);
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  const recommendedAction = ok
    ? 'node atm.mjs next --json'
    : failedChecks.includes('charter-integrity')
      ? 'node atm.mjs init --adopt default --force to reinstall the AtomicCharter, or restore .atm/charter/atomic-charter.md and .atm/charter/charter-invariants.json manually.'
    : failedChecks.includes('git-head-evidence')
      ? 'Record ATM evidence for the current HEAD or review whether work bypassed ATM.'
    : runtime.layoutVersion !== atmLayoutVersion || runtime.migrationNeeded
      ? 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"'
      : 'npm run validate:full';
  const messages = ok
    ? [message('info', 'ATM_DOCTOR_OK', 'ATM engineering and runtime signals are ready.')]
    : failedChecks.includes('charter-integrity')
      ? [message('error', 'ATM_DOCTOR_CHARTER_MISSING', 'AtomicCharter files are missing or corrupt. Repair before continuing.', { failedChecks })]
    : failedChecks.includes('git-head-evidence')
      ? [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'Latest Git commit has no matching ATM evidence; work may have bypassed ATM.', { failedChecks })]
      : [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })];
  return makeResult({
    ok,
    command: 'doctor',
    cwd: root,
    messages,
    evidence: {
      checks,
      packageManager: 'npm',
      packageCount: packageDirs.length,
      repository: relativePathFrom(root, root) || '.',
      projectRole: frameworkContractExpected ? 'framework' : 'host',
      layoutVersion: runtime.layoutVersion,
      currentTaskId: runtime.currentTaskId,
      lockOwner: runtime.activeLock?.owner ?? null,
      activeLockPath: runtime.activeLock?.path ?? null,
      lastEvidenceAt: runtime.lastEvidenceAt,
      lastHandoffAt: runtime.lastHandoffAt,
      missingPaths: runtime.missingPaths,
      migrationNeeded: runtime.migrationNeeded,
      recommendedAction
    }
  });
}

function createCheck(name: any, ok: any, details: any) { return { name, ok: ok === true, details }; }
function readJsonIfExists(filePath: any): Record<string, any> | null { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any> : null; }
function hasRequiredScripts(scripts: Record<string, string> = {}) {
  const required = ['build', 'typecheck', 'lint', 'test', 'validate:quick', 'validate:standard', 'validate:full'];
  return required.every((name) => typeof scripts[name] === 'string' && scripts[name].length > 0);
}
function isFrameworkContractExpected(root: any, rootPackage: any) {
  return rootPackage.name === 'ai-atomic-framework'
    || hasRequiredScripts(rootPackage.scripts)
    || existsSync(path.join(root, 'package-lock.json'));
}
function listPackageDirs(root: any): string[] {
  const packagesRoot = path.join(root, 'packages');
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')));
}
function packageDirLabel(root: any, packageDir: any) { return readJsonIfExists(path.join(root, packageDir, 'package.json'))?.name ?? packageDir; }
function listFiles(directory: any): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function checkCharterIntegrity(root: any): { ok: boolean; charterPath: string; charterInvariantsPath: string; charterPresent: boolean; invariantsPresent: boolean; invariantsParseable: boolean; hashField: string | null } {
  const charterPath = path.join(root, '.atm', 'charter', 'atomic-charter.md');
  const invariantsPath = path.join(root, '.atm', 'charter', 'charter-invariants.json');
  const charterPresent = existsSync(charterPath);
  const invariantsPresent = existsSync(invariantsPath);
  let invariantsParseable = false;
  let hashField: string | null = null;
  if (invariantsPresent) {
    try {
      const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8')) as Record<string, unknown>;
      invariantsParseable = true;
      hashField = typeof parsed.charterHash === 'string' ? parsed.charterHash : null;
    } catch {
      invariantsParseable = false;
    }
  }
  // When .atm/charter/ doesn't exist the project has not adopted the charter yet — not a failure.
  // Only fail when the charter directory exists but files are missing or corrupt.
  const charterDirExists = existsSync(path.join(root, '.atm', 'charter'));
  const ok = !charterDirExists || (charterPresent && invariantsPresent && invariantsParseable);
  return {
    ok,
    charterPath: path.relative(root, charterPath).replace(/\\/g, '/'),
    charterInvariantsPath: path.relative(root, invariantsPath).replace(/\\/g, '/'),
    charterPresent,
    invariantsPresent,
    invariantsParseable,
    hashField
  };
}
