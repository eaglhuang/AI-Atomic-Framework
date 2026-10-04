import { governanceCommandPrefix } from '../packages/cli/src/commands/shared/atm-cli-entrypoint.ts';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type PackageSpec = {
  readonly name: string;
  readonly directory: string;
  readonly publishFiles?: readonly string[];
  readonly bin?: string;
};

const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'package-skeleton.fixture.json'), 'utf8')) as {
  readonly packages: readonly PackageSpec[];
  readonly publishClosure?: { readonly publishedPackages?: readonly string[] };
};
const publishedNames = new Set(fixture.publishClosure?.publishedPackages ?? []);
const binByName: Record<string, string> = {
  '@ai-atomic-framework/cli': 'atm',
  'create-atm': 'create-atm'
};
// Every workspace keeps its manifest obligations; only the declared publish
// closure is packed and installed, because only it reaches an adopter.
const publishedPackages = fixture.packages
  .filter((packageSpec) => publishedNames.has(packageSpec.name))
  .map((packageSpec) => ({ ...packageSpec, bin: binByName[packageSpec.name] }));

function fail(message: string): never {
  throw new Error(`[npm-clean-install] ${message}`);
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function parseNpmJson(output: string): any {
  const trimmed = output.trimStart();
  const jsonStart = trimmed.startsWith('[') && !trimmed.startsWith('[build-')
    ? output.indexOf('[')
    : output.lastIndexOf('\n[') + 1;
  if (jsonStart < 0 || !output.slice(jsonStart).trimStart().startsWith('[')) {
    fail(`npm command did not emit a JSON array: ${output}`);
  }
  return JSON.parse(output.slice(jsonStart));
}

function expectedPublishFiles(packageSpec: PackageSpec): readonly string[] {
  return packageSpec.publishFiles ?? ['dist'];
}

function assertAllowedFiles(entry: any, packageSpec: PackageSpec): void {
  const allowedRoots = expectedPublishFiles(packageSpec);
  for (const file of entry.files ?? []) {
    const packedPath = String(file.path ?? '');
    if (['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE'].includes(packedPath)) continue;
    if (allowedRoots.some((rootPath) => packedPath === rootPath || packedPath.startsWith(`${rootPath}/`))) continue;
    fail(`${entry.name} packs disallowed path ${packedPath}`);
  }
}

function listFiles(directory: string, results: string[] = []): string[] {
  if (!existsSync(directory)) return results;
  if (statSync(directory).isFile()) {
    results.push(directory);
    return results;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(fullPath, results);
    else results.push(fullPath);
  }
  return results;
}

function snapshotTree(directory: string): string {
  const entries = listFiles(directory)
    .map((filePath) => ({
      path: path.relative(directory, filePath).replace(/\\/g, '/'),
      digest: createHash('sha256').update(readFileSync(filePath)).digest('hex')
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return JSON.stringify(entries);
}

// A published tarball carries only its own package directory. A relative
// specifier that escapes that directory therefore resolves to nothing once the
// tarball is installed on its own, no matter how well it resolves inside the
// monorepo. This is the invariant the beta.1 release violated.
function assertNoEscapingSpecifiers(packageSpec: PackageSpec): void {
  const packageRoot = path.join(root, packageSpec.directory);
  const offenders: string[] = [];
  for (const publishRoot of expectedPublishFiles(packageSpec)) {
    for (const filePath of listFiles(path.join(packageRoot, publishRoot))) {
      if (!/\.[cm]?js$/.test(filePath)) continue;
      const source = readFileSync(filePath, 'utf8');
      const patterns = [/from\s+['"](\.[^'"]*)['"]/g, /import\s+['"](\.[^'"]*)['"]/g, /import\(\s*['"](\.[^'"]*)['"]\s*\)/g];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const resolved = path.resolve(path.dirname(filePath), match[1]!);
          if (resolved.startsWith(`${packageRoot}${path.sep}`)) continue;
          offenders.push(`${path.relative(root, filePath)} -> ${match[1]}`);
        }
      }
    }
  }
  if (offenders.length > 0) {
    fail(`${packageSpec.name} publishes specifiers that escape its own tarball: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ''}`);
  }
}

// Installing and printing --version only proves the module graph resolves.
// Adoption is what an adopter actually came for, and it is the path that
// depends on bundled data assets rather than on code, so it is exercised for
// real against a throwaway repository.
const REQUIRED_ROOT_DROP_SCRIPTS = ['atm-next', 'atm-orient', 'atm-create', 'atm-lock', 'atm-evidence', 'atm-upgrade-scan', 'atm-handoff'] as const;
const REQUIRED_ROUTER_REFERENCE = path.join('references', 'index.md');

function installedCliEntrypoint(installRoot: string): string {
  return path.join(installRoot, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'atm.mjs');
}

function runInstalledCli(packageInstallRoot: string, cwd: string, args: string[]) {
  return spawnSync(process.execPath, [installedCliEntrypoint(packageInstallRoot), ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
}

function describeAdoptionResidue(adoptionRoot: string): string {
  const residue = listFiles(adoptionRoot)
    .map((filePath) => path.relative(adoptionRoot, filePath).replace(/\\/g, '/'))
    .filter((relative) => !relative.startsWith('.git/'))
    .sort();
  if (residue.length === 0) return 'no files were written';
  return `left ${residue.length} file(s) behind: ${residue.slice(0, 8).join(', ')}${residue.length > 8 ? ` (+${residue.length - 8} more)` : ''}`;
}

function runEmittedNpmCommand(command: string, expectedArgs: string[], packageInstallRoot: string, cwd: string, label: string): any {
  const runtime = installedCliEntrypoint(packageInstallRoot);
  const expectedCommand = `${governanceCommandPrefix(runtime)} ${expectedArgs.map(arg => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`;
  if (command !== expectedCommand) fail(`${label} emitted ${JSON.stringify(command)} instead of ${JSON.stringify(expectedCommand)}`);
  const result = spawnSync(process.execPath, [runtime, ...expectedArgs], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) fail(`${label} failed with exit ${result.status}: ${output.split('\n').slice(0, 8).join(' ')}`);
  if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(output)) {
    fail(`${label} could not resolve the installed runtime: ${output.split('\n').slice(0, 8).join(' ')}`);
  }
  try {
    return JSON.parse(result.stdout ?? '');
  } catch (error) {
    fail(`${label} did not emit JSON: ${String(error)}; ${output.split('\n').slice(0, 8).join(' ')}`);
  }
}

function assertDefaultAdoptionRecoverySucceeds(installRoot: string, tarball: string): void {
  const adoptionRoot = path.join(path.dirname(installRoot), 'default-adoption-recovery');
  mkdirSync(adoptionRoot, { recursive: true });
  run('npm', ['init', '--yes'], adoptionRoot);
  run('npm', ['install', '--ignore-scripts', '--no-save', tarball], adoptionRoot);
  run('git', ['init', '--quiet', '.'], adoptionRoot);

  const init = runInstalledCli(adoptionRoot, adoptionRoot, ['init', '--adopt', 'default', '--integration', 'codex', '--cwd', adoptionRoot, '--json']);
  const initText = `${init.stdout ?? ''}${init.stderr ?? ''}`;
  if (init.status !== 0 || /"ok":\s*false/.test(initText)) {
    fail(`atm init --adopt default failed after a clean install: ${initText.split('\n').slice(0, 8).join(' ')}`);
  }

  const agentsPath = path.join(adoptionRoot, 'AGENTS.md');
  if (!existsSync(agentsPath)) fail('atm init --adopt default did not generate AGENTS.md');
  const agents = readFileSync(agentsPath, 'utf8');
  if (/node atm\.mjs/i.test(agents)) {
    fail('npm adopter AGENTS.md still emits the absent repository-root atm.mjs command');
  }

  const doctor = runInstalledCli(adoptionRoot, adoptionRoot, ['doctor', '--json']);
  if (doctor.status !== 0) {
    const doctorText = `${doctor.stdout ?? ''}${doctor.stderr ?? ''}`;
    let doctorResult: any;
    try {
      doctorResult = JSON.parse(doctor.stdout?.trim() ? doctor.stdout : doctor.stderr ?? '');
    } catch (error) {
      fail(`atm doctor emitted invalid JSON after default adoption: ${String(error)}; exit=${doctor.status}; spawnError=${doctor.error?.message ?? 'none'}; stdoutChars=${doctor.stdout?.length ?? 0}; stderrChars=${doctor.stderr?.length ?? 0}; ${doctorText.split('\n').slice(0, 8).join(' ')}`);
    }
    if (!(doctorResult.diagnostics?.errorCodes ?? []).includes('ATM_DOCTOR_ONBOARDING_STALE')) {
      fail(`atm doctor failed outside the expected onboarding refresh: ${doctorText.split('\n').slice(0, 8).join(' ')}`);
    }
    const recoveryCommand = doctorResult.evidence?.recommendedAction;
    runEmittedNpmCommand(
      recoveryCommand,
      ['atm-chart', 'render', '--cwd', '.', '--json'],
      adoptionRoot,
      adoptionRoot,
      'npm adopter doctor onboarding recovery'
    );
    const refreshedDoctor = runInstalledCli(adoptionRoot, adoptionRoot, ['doctor', '--json']);
    if (refreshedDoctor.status !== 0) {
      fail(`atm doctor remained blocked after its emitted recovery command: ${`${refreshedDoctor.stdout ?? ''}${refreshedDoctor.stderr ?? ''}`.split('\n').slice(0, 8).join(' ')}`);
    }
  }

  const goal = 'Show a minimal first-run workflow.';
  const next = runInstalledCli(adoptionRoot, adoptionRoot, ['next', '--prompt', goal, '--json']);
  if (next.status !== 0) fail(`atm next failed after default adoption: ${`${next.stdout ?? ''}${next.stderr ?? ''}`.split('\n').slice(0, 8).join(' ')}`);
  const nextResult = JSON.parse(next.stdout ?? '');
  if (nextResult.evidence?.runnerMode?.mode !== 'npm-package') {
    fail(`default adopter next did not recognize the npm entrypoint: ${JSON.stringify(nextResult.evidence?.runnerMode)}`);
  }
  const guide = runEmittedNpmCommand(
    nextResult.evidence?.nextAction?.command,
    ['guide', '--goal', goal, '--cwd', '.', '--json'],
    adoptionRoot,
    adoptionRoot,
    'default adopter atm next -> guide'
  );
  runEmittedNpmCommand(
    guide.evidence?.nextCommand,
    ['orient', '--cwd', '.', '--json'],
    adoptionRoot,
    adoptionRoot,
    'default adopter atm guide -> orient'
  );
}

function assertAdoptionSucceeds(installRoot: string, expectedVersion: string, tarball: string): void {
  const adoptionRoot = installRoot;
  run('git', ['init', '--quiet', '.'], adoptionRoot);

  const init = runInstalledCli(installRoot, adoptionRoot, ['init', '--cwd', adoptionRoot, '--json']);
  const initText = `${init.stdout ?? ''}${init.stderr ?? ''}`;
  if (init.status !== 0 || /"ok":\s*false/.test(initText)) {
    // A failed adoption that still wrote files leaves the adopter with a
    // repository that is neither clean nor usable, so the residue is reported
    // rather than silently discarded with the scratch directory.
    fail(`atm init failed after a clean install and ${describeAdoptionResidue(adoptionRoot)}: ${initText.split('\n').slice(0, 8).join(' ')}`);
  }

  const configPath = path.join(adoptionRoot, '.atm', 'config.json');
  if (!existsSync(configPath)) fail(`atm init reported success but wrote no .atm/config.json; it ${describeAdoptionResidue(adoptionRoot)}`);
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { frameworkVersion?: unknown };
    if (config.frameworkVersion !== expectedVersion) {
      fail(`atm init wrote frameworkVersion ${JSON.stringify(config.frameworkVersion)} instead of installed tarball version ${JSON.stringify(expectedVersion)}`);
    }
  } catch (parseError) {
    fail(`atm init wrote an unparseable .atm/config.json: ${String(parseError)}`);
  }
  // The root-drop scripts are the bundled data asset the tarball previously
  // failed to carry, so their presence is asserted by name, not by directory.
  const missingScripts = REQUIRED_ROOT_DROP_SCRIPTS.flatMap((scriptName) => [
    path.join('.atm', 'scripts', 'sh', `${scriptName}.sh`),
    path.join('.atm', 'scripts', 'ps', `${scriptName}.ps1`)
  ]).filter((relative) => !existsSync(path.join(adoptionRoot, relative)));
  if (missingScripts.length > 0) {
    fail(`atm init reported success but the adopted repository is incomplete; missing ${missingScripts.length} root-drop script(s): ${missingScripts.slice(0, 6).join(', ')}`);
  }
  const doctor = runInstalledCli(installRoot, adoptionRoot, ['doctor', '--json']);
  if (doctor.status !== 0) {
    fail(`atm doctor failed in a freshly initialized adopter: ${`${doctor.stdout ?? ''}${doctor.stderr ?? ''}`.split('\n').slice(0, 8).join(' ')}`);
  }

  // The entry skill explicitly directs an installed agent to read this
  // companion file. Verify the real installation path rather than merely
  // checking the tarball's file list, because an adapter can otherwise copy
  // SKILL.md while silently dropping its companion tree.
  const integration = runInstalledCli(installRoot, adoptionRoot, ['integration', 'add', 'codex', '--json']);
  const integrationText = `${integration.stdout ?? ''}${integration.stderr ?? ''}`;
  if (integration.status !== 0 || /"ok":\s*false/.test(integrationText)) {
    fail(`atm integration add codex failed after a clean install: ${integrationText.split('\n').slice(0, 8).join(' ')}`);
  }
  const routerReference = path.join(
    adoptionRoot,
    'integrations',
    'codex-skills',
    'atm-governance-router',
    REQUIRED_ROUTER_REFERENCE,
  );
  if (!existsSync(routerReference)) {
    fail(`atm integration add codex omitted required router companion file ${path.relative(adoptionRoot, routerReference).replace(/\\/g, '/')}`);
  }

  // The public npm first-run path must remain executable from an adopter repo:
  // next emits guide, guide emits orient, and both commands must resolve from
  // the installed package without relying on a repository-local atm.mjs.
  const goal = 'Show a minimal first-run workflow.';
  const next = runInstalledCli(installRoot, adoptionRoot, ['next', '--prompt', goal, '--json']);
  const nextText = `${next.stdout ?? ''}${next.stderr ?? ''}`;
  if (next.status !== 0) fail(`atm next failed after clean install: ${nextText.split('\n').slice(0, 8).join(' ')}`);
  const nextResult = JSON.parse(next.stdout ?? '');
  if (nextResult.evidence?.runnerMode?.mode !== 'npm-package') {
    fail(`atm next did not recognize the installed npm runner: ${JSON.stringify(nextResult.evidence?.runnerMode)}`);
  }
  const guide = runEmittedNpmCommand(
    nextResult.evidence?.nextAction?.command,
    ['guide', '--goal', goal, '--cwd', '.', '--json'],
    installRoot,
    adoptionRoot,
    'atm next -> guide'
  );
  runEmittedNpmCommand(
    guide.evidence?.nextCommand,
    ['orient', '--cwd', '.', '--json'],
    installRoot,
    adoptionRoot,
    'atm guide -> orient'
  );
  assertDefaultAdoptionRecoverySucceeds(installRoot, tarball);
}

function assertStarterAdoptionSucceeds(installRoot: string, cliTarball: string, version: string): void {
  const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-starter-candidate-'));
  const npmCli = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  ].find((entry) => entry && existsSync(entry));
  if (!npmCli) fail('candidate starter verification requires the installed npm-cli.js');
  try {
    // Substitute only the candidate registry artifact. All target install,
    // bootstrap, integration, skill and first-use commands execute real code.
    const installer = path.join(hostRoot, 'npm-cli.js');
    writeFileSync(installer, `
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'install' || !args.at(-1).startsWith('@ai-atomic-framework/cli@')) process.exit(2);
const child = spawnSync(process.execPath, [${JSON.stringify(npmCli)}, ...args.slice(0, -1), ${JSON.stringify(cliTarball)}], { stdio: 'inherit' });
if (child.status !== 0) process.exit(child.status ?? 1);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
manifest.dependencies['@ai-atomic-framework/cli'] = ${JSON.stringify(version)};
lock.packages[''].dependencies['@ai-atomic-framework/cli'] = ${JSON.stringify(version)};
writeFileSync('package.json', JSON.stringify(manifest));
writeFileSync('package-lock.json', JSON.stringify(lock));
`);
    const starter = path.join(installRoot, 'node_modules/create-atm/dist/index.js');
    const result = spawnSync(process.execPath, [starter, 'project', '--agent', 'codex', '--cwd', hostRoot, '--json'], {
      encoding: 'utf8', timeout: 180_000, env: { ...process.env, npm_execpath: installer }
    });
    if (result.status !== 0) fail(`candidate starter first use failed: ${result.stdout}${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    if (payload.ok !== true || payload.evidence?.runtimeVersion !== version
      || payload.evidence?.atmEntrypointSource !== 'target-dependency') fail('starter did not retain the exact candidate target runtime');
    const target = path.join(hostRoot, 'project');
    for (const relative of ['SKILL.md', 'references/index.md']) {
      if (!existsSync(path.join(target, '.agents/skills/atm-governance-router', relative))) fail(`starter omitted native skill ${relative}`);
    }
    rmSync(installRoot, { recursive: true, force: true });
    const independent = spawnSync(process.execPath, [path.join(target, 'atm.mjs'), 'next', '--json'], { cwd: target, encoding: 'utf8', timeout: 30_000 });
    if (independent.status !== 0 || JSON.parse(independent.stdout).ok !== true) fail(`target failed after consumer removal: ${independent.stdout}${independent.stderr}`);
  } finally {
    rmSync(hostRoot, { recursive: true, force: true });
  }
}

if (publishedPackages.length === 0) {
  fail('tests/package-skeleton.fixture.json must declare publishClosure.publishedPackages');
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-product-clean-install-'));
try {
  for (const packageSpec of fixture.packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, packageSpec.directory, 'package.json'), 'utf8'));
    if (JSON.stringify(manifest.files) !== JSON.stringify(expectedPublishFiles(packageSpec))) {
      fail(`${packageSpec.name} files allowlist must contain only declared runtime artifacts`);
    }
    const binName = binByName[packageSpec.name];
    if (binName && manifest.bin?.[binName]?.startsWith('./')) {
      fail(`${packageSpec.name} bin.${binName} must not start with ./ because npm removes that entry at publish time`);
    }
  }

  for (const packageSpec of publishedPackages) {
    // A published workspace may not depend on any workspace left unpublished.
    const manifest = JSON.parse(readFileSync(path.join(root, packageSpec.directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (publishedNames.has(dependency)) continue;
      if (fixture.packages.some((entry) => entry.name === dependency)) {
        fail(`${packageSpec.name} declares unpublished workspace dependency ${dependency}; the published tarball must be self-contained`);
      }
    }
    assertNoEscapingSpecifiers(packageSpec);
  }

  const workspaceArgs = publishedPackages.flatMap((packageSpec) => ['--workspace', packageSpec.name]);
  const packed = parseNpmJson(run('npm', ['pack', ...workspaceArgs, '--pack-destination', tempRoot, '--json'], root));
  if (!Array.isArray(packed) || packed.length !== publishedPackages.length) {
    fail(`npm pack must return exactly ${publishedPackages.length} published workspace artifact(s)`);
  }
  const byName = new Map(packed.map((entry: any) => [entry.name, entry]));
  for (const packageSpec of publishedPackages) {
    const entry = byName.get(packageSpec.name);
    if (!entry) fail(`missing packed artifact for ${packageSpec.name}`);
    assertAllowedFiles(entry, packageSpec);
  }

  // The CLI remains isolated. The starter has an explicit CLI dependency,
  // satisfied by the exact same-release artifact before registry publication.
  for (const packageSpec of publishedPackages) {
    const tarball = path.join(tempRoot, byName.get(packageSpec.name).filename);
    if (!existsSync(tarball)) fail(`npm pack did not create the ${packageSpec.name} tarball`);
    const installRoot = path.join(tempRoot, `clean-install-${packageSpec.name.replace(/[^a-z0-9]+/gi, '-')}`);
    mkdirSync(installRoot, { recursive: true });
    run('npm', ['init', '--yes'], installRoot);
    const cliEntry = byName.get('@ai-atomic-framework/cli');
    const candidateDependencies = packageSpec.name === 'create-atm'
      ? [path.join(tempRoot, cliEntry.filename)] : [];
    run('npm', ['install', '--ignore-scripts', '--no-save', ...candidateDependencies, tarball], installRoot);
    if (!packageSpec.bin) continue;
    const bin = process.platform === 'win32' ? `${packageSpec.bin}.cmd` : packageSpec.bin;
    const binPath = path.join(installRoot, 'node_modules', '.bin', bin);
    if (!existsSync(binPath)) fail(`installed ${packageSpec.name} does not expose ${packageSpec.bin}`);
    // --help alone can pass while the deeper command graph is unresolvable, so
    // exercise commands that actually load the runtime closure.
    const smokeCommands = packageSpec.name === 'create-atm' ? [['--help']] : [['--version'], ['--help'], ['doctor', '--json']];
    for (const smokeArgs of smokeCommands) {
      const smoke = spawnSync(binPath, smokeArgs, { cwd: installRoot, encoding: 'utf8', shell: process.platform === 'win32' });
      const smokeText = `${smoke.stdout ?? ''}${smoke.stderr ?? ''}`;
      if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(smokeText)) {
        fail(`${packageSpec.bin} ${smokeArgs.join(' ')} could not resolve its own runtime after a clean install: ${smokeText.split('\n').slice(0, 6).join(' ')}`);
      }
      if (packageSpec.name === 'create-atm') {
        if (smoke.status !== 0) fail(`create-atm --help exited ${smoke.status}`);
        if (!smokeText.includes('Usage: create-atm')) fail('create-atm did not expose its usage text after clean install');
      } else if (smoke.status !== 0) {
        fail(`${packageSpec.bin} ${smokeArgs.join(' ')} failed after clean install: ${smokeText}`);
      }
    }
    if (packageSpec.name === 'create-atm') {
      assertStarterAdoptionSucceeds(installRoot, path.join(tempRoot, cliEntry.filename), cliEntry.version);
    }
    if (packageSpec.name === '@ai-atomic-framework/cli') {
      const installedManifest = JSON.parse(readFileSync(path.join(installRoot, 'node_modules', ...packageSpec.name.split('/'), 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof installedManifest.version !== 'string' || installedManifest.version.trim().length === 0) {
        fail('installed CLI tarball has no package version');
      }
      const version = spawnSync(binPath, ['--version', '--json'], { cwd: installRoot, encoding: 'utf8', shell: process.platform === 'win32' });
      const versionText = `${version.stdout ?? ''}${version.stderr ?? ''}`;
      if (version.status !== 0 || !versionText.includes(`\"frameworkVersion\": \"${installedManifest.version}\"`)) {
        fail(`atm --version must report the installed tarball version ${installedManifest.version}: ${versionText.split('\n').slice(0, 8).join(' ')}`);
      }
      const beforeCreate = snapshotTree(installRoot);
      const create = spawnSync(process.execPath, [installedCliEntrypoint(installRoot),
        'create', '--bucket', 'CORE', '--title', 'SmokeAtom',
        '--description', 'Installed runtime smoke',
        '--logical-name', 'atom.smoke.installed', '--dry-run', '--json'
      ], { cwd: installRoot, encoding: 'utf8' });
      const createText = `${create.stdout ?? ''}${create.stderr ?? ''}`;
      if (create.status !== 0) {
        fail(`installed atm create --dry-run failed: ${createText}`);
      }
      const installedRuntime = path.join(installRoot, 'node_modules', ...packageSpec.name.split('/'), 'dist', 'npm-runtime');
      const runtimeManifest = JSON.parse(readFileSync(path.join(installedRuntime, 'manifest.json'), 'utf8'));
      const installedLayout = path.join(installedRuntime, runtimeManifest.layoutRoot ?? 'layout');
      for (const assetPath of [
        'templates/atom.spec.template.json',
        'templates/atom.test.template.ts',
        'schemas/atomic-spec.schema.json'
      ]) {
        if (!existsSync(path.join(installedLayout, assetPath))) {
          fail(`installed atm runtime is missing scaffold asset ${assetPath}`);
        }
      }
      if (snapshotTree(installRoot) !== beforeCreate) {
        fail('installed atm create --dry-run mutated the fixture repository');
      }
      assertAdoptionSucceeds(installRoot, installedManifest.version, tarball);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    schemaId: 'atm.npmCleanInstallValidation.v1',
    skeletonPackages: fixture.packages.length,
    publishedPackages: publishedPackages.map((packageSpec) => packageSpec.name),
    isolatedInstall: true,
    starterValidation: publishedNames.has('create-atm') ? {
      candidateCliTarball: true,
      registryPublishVerified: false,
      consumerRemovalVerified: true
    } : null,
    adoptionVerified: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
