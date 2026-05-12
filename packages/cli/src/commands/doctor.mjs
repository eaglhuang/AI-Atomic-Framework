import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runHashPlaceholderAudit } from '../../../../scripts/audit-hash-placeholders.mjs';
import { makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';

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

export function runDoctor(argv) {
  const { options } = parseOptions(argv, 'doctor');
  const root = options.cwd;
  const rootPackage = readJsonIfExists(path.join(root, 'package.json')) ?? {};
  const packageDirs = listPackageDirs(root);
  const hashAudit = runHashPlaceholderAudit({ root });
  const legacyPackages = legacyBehaviorPackageNames.filter((name) => existsSync(path.join(root, 'packages', name)));
  const missingDist = packageDirs
    .map((packageDir) => ({ packageDir, js: path.join(root, packageDir, 'dist', 'index.js'), dts: path.join(root, packageDir, 'dist', 'index.d.ts') }))
    .filter((entry) => !existsSync(entry.js) || !existsSync(entry.dts))
    .map((entry) => packageDirLabel(root, entry.packageDir));
  const checks = [
    createCheck('package-manager', rootPackage.packageManager === undefined && existsSync(path.join(root, 'package-lock.json')) && !existsSync(path.join(root, 'pnpm-workspace.yaml')), {
      official: 'npm', packageLock: existsSync(path.join(root, 'package-lock.json')), packageManagerField: rootPackage.packageManager ?? null, pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
    }),
    createCheck('typescript-build-config', existsSync(path.join(root, 'tsconfig.json')) && existsSync(path.join(root, 'tsconfig.build.json')) && rootPackage.scripts?.build?.includes('tsc'), {
      tsconfig: existsSync(path.join(root, 'tsconfig.json')), buildConfig: existsSync(path.join(root, 'tsconfig.build.json')), buildScript: rootPackage.scripts?.build ?? null
    }),
    createCheck('eslint-lint-config', existsSync(path.join(root, 'eslint.config.mjs')) && rootPackage.scripts?.lint?.includes('eslint'), {
      eslintConfig: existsSync(path.join(root, 'eslint.config.mjs')), lintScript: rootPackage.scripts?.lint ?? null
    }),
    createCheck('package-surface', existsSync(path.join(root, 'packages/plugin-behavior-pack')) && legacyPackages.length === 0, { behaviorPack: existsSync(path.join(root, 'packages/plugin-behavior-pack')), legacyPackages }),
    createCheck('package-dist', missingDist.length === 0, { packageCount: packageDirs.length, missingDist }),
    createCheck('hash-placeholders', hashAudit.ok, hashAudit),
    createCheck('self-host-alpha-entry', existsSync(path.join(root, 'packages/cli/src/commands/self-host-alpha.mjs')) && existsSync(path.join(root, 'docs/SELF_HOSTING_ALPHA.md')), { command: 'packages/cli/src/commands/self-host-alpha.mjs', doc: 'docs/SELF_HOSTING_ALPHA.md' })
  ];
  const ok = checks.every((check) => check.ok);
  return makeResult({
    ok,
    command: 'doctor',
    cwd: root,
    messages: [ok ? message('info', 'ATM_DOCTOR_OK', 'ATM engineering signals are ready.') : message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering signals need attention.', { failedChecks: checks.filter((check) => !check.ok).map((check) => check.name) })],
    evidence: { checks, packageManager: 'npm', packageCount: packageDirs.length, repository: relativePathFrom(root, root) || '.' }
  });
}

function createCheck(name, ok, details) { return { name, ok: ok === true, details }; }
function readJsonIfExists(filePath) { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null; }
function listPackageDirs(root) {
  const packagesRoot = path.join(root, 'packages');
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')));
}
function packageDirLabel(root, packageDir) { return readJsonIfExists(path.join(root, packageDir, 'package.json'))?.name ?? packageDir; }
