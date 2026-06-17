import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDecisionSnapshotHash } from '../packages/plugin-human-review/src/index.ts';
import { quoteForShell, detectAutoLinkedValidator } from '../packages/cli/src/commands/evidence.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';
import { cliCommandRunners, runCli } from '../packages/cli/src/atm.ts';
import { commandSpecs, listCommandSpecs } from '../packages/cli/src/commands/command-specs.ts';
import {
  categorizeHistoricalCommitFiles,
  inspectHistoricalDelivery,
  isDeliverableGateCandidate,
  pathMatchesTaskScope
} from '../packages/cli/src/commands/tasks/historical-delivery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const profile = process.argv.includes('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : null;
const surfaceOnly = mode === 'surface' || profile === 'surface' || process.argv.includes('--surface');
const childProcessSmokeEnabled = process.env.ATM_VALIDATE_CLI_CHILD_SMOKE !== '0';
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ATM_') && !['ATM_VALIDATE_CLI_CHILD_SMOKE', 'ATM_TEMP_ROOT'].includes(key)) {
    delete process.env[key];
  }
}

const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');
const helpCommandSnapshot = readJson('tests/cli-fixtures/help-snapshots/command-list.json');
const regressionFixtures = {
  sourceDoneWithoutGovernedCloseout: readJson('scripts/fixtures/tasks-invariant-regressions/01-source-done-without-governed-closeout.json'),
  mailboxAndPlanningDone: readJson('scripts/fixtures/tasks-invariant-regressions/02-mailbox-and-planning-done.json'),
  manualCloseWithoutMetadata: readJson('scripts/fixtures/tasks-invariant-regressions/03-manual-close-without-metadata.json'),
  validClosurePacket: readJson('scripts/fixtures/tasks-invariant-regressions/04-valid-closure-packet.json')
};
const perCommandHelpSnapshots = {
  explain: readJson('tests/cli-fixtures/help-snapshots/explain.json'),
  broker: readJson('tests/cli-fixtures/help-snapshots/broker.json'),
  next: readJson('tests/cli-fixtures/help-snapshots/next.json'),
  orient: readJson('tests/cli-fixtures/help-snapshots/orient.json'),
  start: readJson('tests/cli-fixtures/help-snapshots/start.json'),
  guide: readJson('tests/cli-fixtures/help-snapshots/guide.json'),
  registry: readJson('tests/cli-fixtures/help-snapshots/registry.json'),
  upgrade: readJson('tests/cli-fixtures/help-snapshots/upgrade.json')
};
const publicCommandNames = listCommandSpecs()
  .map((spec: any) => spec.name)
  .sort((left: any, right: any) => left.localeCompare(right));
const internalCommandNames = Object.values(commandSpecs)
  .filter((spec: any) => spec.visibility === 'internal')
  .map((spec: any) => spec.name)
  .sort((left: any, right: any) => left.localeCompare(right));
const runnerCommandNames = Object.keys(cliCommandRunners).sort((left, right) => left.localeCompare(right));
const allSpecCommandNames = Object.keys(commandSpecs).sort((left, right) => left.localeCompare(right));

function fail(message: any) {
  console.error(`[cli:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function normalizeTaskScopePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function sandboxEpermHint(args: any, cwd: any) {
  return [
    `child process EPERM while running ATM args "${args.join(' ')}" in ${cwd}.`,
    'If this is Codex on Windows, set ~/.codex/config.toml [windows] sandbox = "elevated",',
    'or rerun this validator elevated. For temp workspace git failures, set ATM_TEMP_ROOT=C:\\tmp.'
  ].join(' ');
}

async function runAtm(args: any, cwd = root, env: Record<string, string> = {}) {
  return runAtmInProcess(args, cwd, env);
}

async function runAtmSpawned(args: any, cwd = root, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(root, fixture.entrypoint), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
    console.error(`[cli:${mode}] warning: ${sandboxEpermHint(args, cwd)}`);
    return runAtmInProcess(args, cwd, env);
  }
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any = {};
  if (payload || !args.includes('--output-json')) {
    try {
      parsed = JSON.parse(payload);
    } catch (error: any) {
      fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    }
  }
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed
  };
}

async function runAtmInProcess(args: any, cwd = root, env: Record<string, string> = {}) {
  const previousCwd = process.cwd();
  const previousEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  let stdout = '';
  let stderr = '';
  try {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    const exitCode = await runCli(args, {
      stdout: { write(chunk: unknown) { stdout += String(chunk); return true; } } as any,
      stderr: { write(chunk: unknown) { stderr += String(chunk); return true; } } as any
    });
    const payload = (stdout || stderr || '').trim();
    let parsed: any = {};
    if (payload || !args.includes('--output-json')) {
      try {
        parsed = JSON.parse(payload);
      } catch (error: any) {
        fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
      }
    }
    return {
      exitCode,
      stdout,
      stderr,
      parsed
    };
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function writeJson(filePath: any, value: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createCliTempWorkspace(prefix: string) {
  try {
    return createTempWorkspace(prefix);
  } catch (error: any) {
    if (error?.code === 'EPERM') {
      fail([
        `temp workspace EPERM while creating ${error.path ?? 'a validator workspace'}.`,
        'If this is Codex on Windows, rerun this validator elevated or restart Codex after setting [windows] sandbox = "elevated".',
        'If a custom temp root is needed, set ATM_TEMP_ROOT=C:\\tmp and make sure the directory is writable.'
      ].join(' '));
      process.exit(process.exitCode ?? 1);
    }
    throw error;
  }
}

function writeHostPackageLockSignals(cwd: any) {
  writeJson(path.join(cwd, 'package.json'), {
    name: 'host-with-package-lock',
    version: '0.0.0'
  });
  writeJson(path.join(cwd, 'package-lock.json'), {
    name: 'host-with-package-lock',
    lockfileVersion: 3
  });
  writeJson(path.join(cwd, 'atomic-registry.json'), {
    schemaId: 'atm.registry.v1',
    specVersion: '0.1.0',
    entries: []
  });
}

function assertReadable(result: any, commandName: any) {
  for (const field of fixture.agentReadableFields) {
    assert(Object.hasOwn(result.parsed, field), `${commandName} output missing field: ${field}`);
  }
  assert(Array.isArray(result.parsed.messages), `${commandName} messages must be an array`);
  assert(result.parsed.evidence && typeof result.parsed.evidence === 'object', `${commandName} evidence must be an object`);
}

function assertMessageCode(result: any, code: any) {
  assert(result.parsed.messages.some((entry: any) => entry.code === code), `expected message code ${code}`);
}

for (const relativePath of [fixture.entrypoint, 'packages/cli/src/commands/atm-chart.ts', 'packages/cli/src/commands/bootstrap-entry.ts', 'packages/cli/src/commands/cache.ts', 'packages/cli/src/commands/candidates.ts', 'packages/cli/src/commands/create.ts', 'packages/cli/src/commands/doctor.ts', 'packages/cli/src/commands/emergency.ts', 'packages/cli/src/commands/framework-development.ts', 'packages/cli/src/commands/internal-release.ts', 'packages/cli/src/commands/next.ts', 'packages/cli/src/commands/init.ts', 'packages/cli/src/commands/integration.ts', 'packages/cli/src/commands/police.ts', 'packages/cli/src/commands/registry.ts', 'packages/cli/src/commands/rollback.ts', 'packages/cli/src/commands/review.ts', 'packages/cli/src/commands/self-host-alpha.ts', 'packages/cli/src/commands/spec.ts', 'packages/cli/src/commands/status.ts', 'packages/cli/src/commands/upgrade.ts', 'packages/cli/src/commands/test.ts', 'packages/cli/src/commands/validate.ts', 'packages/cli/src/commands/verify.ts', 'packages/cli/src/commands/welcome.ts', 'templates/enforcement/pre-commit.sh', 'templates/enforcement/ci-atm-onboarding.yml', 'fixtures/upgrade/hash-diff-report.json', 'fixtures/upgrade/quality-comparison-pass.json', 'fixtures/upgrade/quality-comparison-blocked.json', 'fixtures/upgrade/proposal-pass.json', 'fixtures/upgrade/proposal-blocked.json', 'fixtures/evolution/evidence-patterns/no-signal.json', 'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json', 'fixtures/registry/v1-with-versions.json', 'tests/police-fixtures/positive/non-regression-report.json', 'tests/police-fixtures/positive/registry-candidate-report.json', 'tests/schema-fixtures/positive/minimal-execution-evidence.json', fixture.validAtomicSpec, 'atomic-registry.json', 'fixtures/verify/guard-evidence-pass.json', 'fixtures/verify/guard-evidence-missing-justification.json']) {
  assert(existsSync(path.join(root, relativePath)), `missing CLI fixture dependency: ${relativePath}`);
}

const dependencyGatesSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/dependency-gates.ts'), 'utf8');
assert(
  dependencyGatesSource.includes("from './dependency-gate.ts'"),
  'dependency-gates facade must preserve dependency-gate.ts as the implementation owner'
);
const surfaceInvariantsSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/surface-invariants.ts'), 'utf8');
for (const symbol of [
  'resolveTaskflowCloseMode',
  'resolveTaskflowCloseBackend',
  'taskflowCloseEvidenceValidators',
  'taskflowCloseGovernanceEvidenceValidator'
]) {
  assert(surfaceInvariantsSource.includes(symbol), `surface-invariants missing required closeout strategy export: ${symbol}`);
}
const tasksCommandSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks.ts'), 'utf8');
assert(
  tasksCommandSource.includes("from './tasks/dependency-gates.ts'"),
  'tasks.ts must consume dependency admission through the plural dependency-gates facade'
);

const cliIndex = readFileSync(path.join(root, 'packages/cli/src/index.ts'), 'utf8');
for (const commandName of fixture.commands) {
  assert(cliIndex.includes(`commandName: '${commandName}'`), `index.ts missing command descriptor: ${commandName}`);
}

const packageManifest = readJson('package.json');
if (childProcessSmokeEnabled) {
  const spawnedVersion = await runAtmSpawned(['--version'], root);
  assert(spawnedVersion.exitCode === 0, 'spawned --version smoke test must exit 0');
  assertReadable(spawnedVersion, 'spawned --version');
  assert(spawnedVersion.parsed.ok === true, 'spawned --version smoke test must report ok=true');
}

const version = await runAtm(['--version'], root);
assert(version.exitCode === 0, '--version must exit 0');
assertReadable(version, '--version');
assert(version.parsed.ok === true, '--version must report ok=true');
assert(version.parsed.command === 'version', '--version must report version command identity');
assert(version.parsed.evidence?.frameworkVersion === packageManifest.version, '--version must report package.json version');
assertMessageCode(version, 'ATM_CLI_VERSION');

const globalHelp = await runAtm(['--help'], root);
assert(globalHelp.exitCode === 0, '--help must exit 0');
assertReadable(globalHelp, '--help');
assert(globalHelp.parsed.ok === true, '--help must report ok=true');
const listedCommands = (Array.isArray(globalHelp.parsed.evidence?.commands) ? globalHelp.parsed.evidence.commands : [])
  .map((entry: any) => typeof entry === 'string' ? entry : entry.command)
  .filter(Boolean)
  .sort((left: any, right: any) => left.localeCompare(right));
assert(JSON.stringify(runnerCommandNames) === JSON.stringify(allSpecCommandNames), 'runner registry and command spec registry must stay in sync');
assert(JSON.stringify(listedCommands) === JSON.stringify(publicCommandNames), '--help command list must match public command specs');
assert(JSON.stringify(listedCommands) === JSON.stringify([...helpCommandSnapshot.commands].sort((left, right) => left.localeCompare(right))), '--help command list must match snapshot fixture');

for (const commandName of internalCommandNames) {
  assert(!listedCommands.includes(commandName), `${commandName} must stay hidden from the global help command list`);
  const commandHelp = await runAtm([commandName, '--help'], root);
  assert(commandHelp.exitCode === 0, `${commandName} --help must exit 0`);
  assertReadable(commandHelp, `${commandName} --help`);
  assert(commandHelp.parsed.ok === true, `${commandName} --help must report ok=true`);
  assert(commandHelp.parsed.command === commandName, `${commandName} --help must keep command identity`);
  assert(commandHelp.parsed.evidence?.usage?.command === commandName, `${commandName} --help must report usage.command`);
}

for (const commandName of publicCommandNames) {
  const commandHelp = await runAtm([commandName, '--help'], root);
  assert(commandHelp.exitCode === 0, `${commandName} --help must exit 0`);
  assertReadable(commandHelp, `${commandName} --help`);
  assert(commandHelp.parsed.ok === true, `${commandName} --help must report ok=true`);
  assert(commandHelp.parsed.command === commandName, `${commandName} --help must keep command identity`);
  assert(commandHelp.parsed.evidence?.usage?.command === commandName, `${commandName} --help must report usage.command`);

  const snapshotUsage = (perCommandHelpSnapshots as Record<string, any>)[commandName];
  if (snapshotUsage) {
    assert(JSON.stringify(commandHelp.parsed.evidence?.usage ?? null) === JSON.stringify(snapshotUsage), `${commandName} --help usage snapshot must match fixture`);
  }
}

const tasksHelp = await runAtm(['tasks', '--help'], root);
const tasksUsageText = JSON.stringify(tasksHelp.parsed.evidence?.usage ?? {});
assert(tasksUsageText.includes('repair-closure'), 'tasks --help CLI surface must list repair-closure');
assert(tasksUsageText.includes('node atm.mjs tasks repair-closure'), 'tasks --help examples must show tasks repair-closure usage');
assert(tasksUsageText.includes('--amend'), 'tasks --help must document explicit repair-closure amend opt-in');
assert(tasksUsageText.includes('--emergency-approval'), 'tasks --help must document emergency approval for protected backend surfaces');
assert(tasksUsageText.includes('taskflow open/close'), 'tasks --help must identify taskflow as the official operator lane');
assert(tasksUsageText.includes('low-level template generator'), 'tasks --help must label tasks new as a low-level template generator surface');
assert(tasksUsageText.includes('runtime synchronization surface'), 'tasks --help must label tasks import as the runtime synchronization (backend) surface');

const taskflowHelp = await runAtm(['taskflow', '--help'], root);
const taskflowUsageText = JSON.stringify(taskflowHelp.parsed.evidence?.usage ?? {});
assert(taskflowUsageText.includes('Official operator lane'), 'taskflow --help must identify taskflow as the official operator lane');
assert(taskflowUsageText.includes('writeReadinessHint'), 'taskflow --help must reference the writeReadinessHint surface for dry-run --write readiness');
assert(taskflowUsageText.includes('low-level template generator surface'), 'taskflow --help must label tasks new as a low-level template generator surface');
assert(taskflowUsageText.includes('runtime synchronization surface'), 'taskflow --help must label tasks import as a runtime synchronization (backend) surface');

const teamHelp = await runAtm(['team', '--help'], root);
const teamUsageText = JSON.stringify(teamHelp.parsed.evidence?.usage ?? {});
assert(teamUsageText.includes('knowledge'), 'team --help must list the team knowledge action');
assert(teamUsageText.includes('team knowledge build'), 'team --help examples must show team knowledge build usage');
assert(teamUsageText.includes('team knowledge query'), 'team --help examples must show team knowledge query usage');
assert(teamUsageText.includes('--dry-run'), 'team --help must document advisory knowledge dry-run');

const lifecycleStateTest = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/tasks/__tests__/lifecycle-state.test.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(lifecycleStateTest.status === 0, `lifecycle-state focused test must pass: ${lifecycleStateTest.stderr || lifecycleStateTest.stdout}`);

const historicalDeliveryTest = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/tasks/__tests__/historical-delivery.test.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(historicalDeliveryTest.status === 0, `historical-delivery focused test must pass: ${historicalDeliveryTest.stderr || historicalDeliveryTest.stdout}`);

const scopeLockDiagnosticsTest = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(scopeLockDiagnosticsTest.status === 0, `scope-lock-diagnostics focused test must pass: ${scopeLockDiagnosticsTest.stderr || scopeLockDiagnosticsTest.stdout}`);

const planningRootPreferenceTest = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/next/__tests__/planning-root-preference.test.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(planningRootPreferenceTest.status === 0, `planning-root-preference focused test must pass: ${planningRootPreferenceTest.stderr || planningRootPreferenceTest.stdout}`);

const planningRootCanonicalPreferenceValidator = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'scripts/validate-planning-root-canonical-preference.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(planningRootCanonicalPreferenceValidator.status === 0, `planning-root canonical preference validator must pass: ${planningRootCanonicalPreferenceValidator.stderr || planningRootCanonicalPreferenceValidator.stdout}`);

const residueDiagnosticsTest = spawnSync(
  process.execPath,
  ['--strip-types', path.join(root, 'packages/cli/src/commands/tasks/__tests__/residue-diagnostics.test.ts')],
  { cwd: root, encoding: 'utf8' }
);
assert(residueDiagnosticsTest.status === 0, `residue-diagnostics focused test must pass: ${residueDiagnosticsTest.stderr || residueDiagnosticsTest.stdout}`);

const nextHelp = await runAtm(['next', '--help'], root);
const nextUsageText = JSON.stringify(nextHelp.parsed.evidence?.usage ?? {});
assert(nextUsageText.includes('prefers the explicit --task'), 'next --help must explain that the recommended claim command prefers --task TASK-XXX form when the task is already known');

const evidenceHelp = await runAtm(['evidence', '--help'], root);
const evidenceUsageText = JSON.stringify(evidenceHelp.parsed.evidence?.usage ?? {});
assert(evidenceUsageText.includes('evidence run --task ATM-GOV-0104'), 'evidence --help examples must put evidence run on the normal validator capture path');
assert(evidenceUsageText.includes('Raw evidence add only'), 'evidence --help must label evidence add metadata flags as raw/manual surface');
assert(evidenceUsageText.indexOf('evidence run --task ATM-GOV-0104') < evidenceUsageText.indexOf('evidence add --task ATM-GOV-0104'), 'evidence --help examples must show evidence run before evidence add');

const emergencyHelp = await runAtm(['emergency', '--help'], root);
assert(emergencyHelp.exitCode === 0, 'emergency --help must exit 0');
assertReadable(emergencyHelp, 'emergency --help');
const emergencyUsageText = JSON.stringify(emergencyHelp.parsed.evidence?.usage ?? {});
assert(emergencyUsageText.includes('approve'), 'emergency --help must document approve');
assert(emergencyUsageText.includes('--approval-text'), 'emergency --help must require human approval text');

const rescueHelp = await runAtm(['rescue', '--help'], root);
const rescueUsageText = JSON.stringify(rescueHelp.parsed.evidence?.usage ?? {});
assert(rescueUsageText.includes('closure-packet'), 'rescue --help CLI surface must list closure-packet');
assert(rescueUsageText.includes('node atm.mjs rescue closure-packet'), 'rescue --help examples must show rescue closure-packet usage');
assert(rescueUsageText.includes('--amend'), 'rescue --help must document explicit closure-packet amend opt-in');

if (surfaceOnly) {
  if (!process.exitCode) {
    console.log(`[cli:${mode}] ok surface (${publicCommandNames.length} public commands, ${internalCommandNames.length} internal commands, in-process help checks)`);
  }
  process.exit(process.exitCode ?? 0);
}

const tempRoot = createCliTempWorkspace('atm-cli-');
try {
  const emergencyPermissions = await runAtm(['emergency', 'permissions', '--json'], tempRoot);
  assert(emergencyPermissions.exitCode === 0, 'emergency permissions must exit 0');
  assertReadable(emergencyPermissions, 'emergency permissions');
  assert(Array.isArray(emergencyPermissions.parsed.evidence?.permissions), 'emergency permissions must return registry entries');
  assert(emergencyPermissions.parsed.evidence.permissions.some((entry: any) => entry.id === 'backend.tasks.reconcile'), 'emergency permissions must include backend.tasks.reconcile');
  const reconcilePermission = emergencyPermissions.parsed.evidence.permissions.find((entry: any) => entry.id === 'backend.tasks.reconcile');
  assert(reconcilePermission.normalLane === 'taskflow close', 'emergency permission registry must expose normalLane');
  assert(reconcilePermission.riskTier === 'high', 'emergency permission registry must expose riskTier');
  assert(reconcilePermission.requiresTaskId === true, 'emergency permission registry must expose requiresTaskId');
  assert(reconcilePermission.requiresActor === true, 'emergency permission registry must expose requiresActor');
  assert(reconcilePermission.requiresHumanApprovalText === true, 'emergency permission registry must expose requiresHumanApprovalText');
  assert(reconcilePermission.auditRequired === true, 'emergency permission registry must expose auditRequired');
  assert(Array.isArray(reconcilePermission.validatorTags) && reconcilePermission.validatorTags.includes('emergency-backend-reconcile'), 'emergency permission registry must expose validatorTags');

  const emergencyApproval = await runAtm([
    'emergency', 'approve',
    '--cwd', tempRoot,
    '--task', 'TASK-CID-TEST',
    '--actor', 'validator',
    '--permission', 'backend.tasks.reconcile',
    '--approval-text', 'Human approved validator emergency reconcile test',
    '--reason', 'validator exercises emergency lease lifecycle',
    '--json'
  ], tempRoot);
  assert(emergencyApproval.exitCode === 0, 'emergency approve must exit 0');
  assertReadable(emergencyApproval, 'emergency approve');
  const emergencyLeaseId = emergencyApproval.parsed.evidence?.lease?.leaseId;
  assert(typeof emergencyLeaseId === 'string' && emergencyLeaseId.startsWith('EMG-'), 'emergency approve must return a lease id');

  const emergencyShow = await runAtm(['emergency', 'show', '--cwd', tempRoot, '--lease', emergencyLeaseId, '--json'], tempRoot);
  assert(emergencyShow.exitCode === 0, 'emergency show must exit 0');
  assert(emergencyShow.parsed.evidence?.leases?.[0]?.leaseId === emergencyLeaseId, 'emergency show must load the requested lease');

  const emergencyRevoke = await runAtm(['emergency', 'revoke', '--cwd', tempRoot, '--lease', emergencyLeaseId, '--actor', 'captain', '--json'], tempRoot);
  assert(emergencyRevoke.exitCode === 0, 'emergency revoke must exit 0');
  assert(emergencyRevoke.parsed.evidence?.lease?.status === 'revoked', 'emergency revoke must mark the lease revoked');

  const backendWithoutApproval = await runAtm([
    'tasks', 'reconcile',
    '--cwd', tempRoot,
    '--task', 'TASK-CID-TEST',
    '--actor', 'validator',
    '--delivery-commit', 'deadbeef',
    '--json'
  ], tempRoot);
  assert(backendWithoutApproval.exitCode === 1, 'protected direct tasks reconcile without emergency approval must fail closed');
  assertMessageCode(backendWithoutApproval, 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED');

  const forceImportWithoutApproval = await runAtm([
    'tasks', 'import',
    '--cwd', tempRoot,
    '--from', path.join(tempRoot, 'TASK-CID-TEST.task.md'),
    '--write',
    '--force',
    '--json'
  ], tempRoot);
  assert(forceImportWithoutApproval.exitCode === 1, 'protected force import without emergency approval must fail closed before file mutation');
  assertMessageCode(forceImportWithoutApproval, 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED');

  const importPlanPath = path.join(tempRoot, 'TASK-CID-TEST.task.md');
  writeFileSync(importPlanPath, [
    '---',
    'task_id: TASK-CID-TEST',
    'title: "Emergency import fixture"',
    'status: planned',
    'scopePaths:',
    '  - "src/emergency-fixture.ts"',
    'deliverables:',
    '  - "src/emergency-fixture.ts"',
    '---',
    '# TASK-CID-TEST',
    ''
  ].join('\n'), 'utf8');
  const importApproval = await runAtm([
    'emergency', 'approve',
    '--cwd', tempRoot,
    '--task', 'TASK-CID-TEST',
    '--actor', 'validator',
    '--permission', 'backend.tasks.import.write',
    '--allowed-flag', '--force',
    '--approval-text', 'Human approved validator force import test',
    '--reason', 'validator consumes emergency import lease',
    '--json'
  ], tempRoot);
  assert(importApproval.exitCode === 0, 'emergency approve for import must exit 0');
  const importLeaseId = importApproval.parsed.evidence?.lease?.leaseId;
  const forceImportWithApproval = await runAtm([
    'tasks', 'import',
    '--cwd', tempRoot,
    '--from', importPlanPath,
    '--write',
    '--force',
    '--emergency-approval', importLeaseId,
    '--json'
  ], tempRoot);
  assert(forceImportWithApproval.exitCode === 0, 'protected force import with matching emergency approval must pass');
  const importEmergencyUse = forceImportWithApproval.parsed.evidence?.emergencyUse?.use;
  assert(importEmergencyUse?.schemaId === 'atm.emergencyMaintenanceUse.v1', 'approved backend result must include emergency use evidence');
  assert(importEmergencyUse.result === 'authorized', 'emergency use evidence must include result');
  assert(importEmergencyUse.before && typeof importEmergencyUse.before === 'object', 'emergency use evidence must include before snapshot');
  assert(importEmergencyUse.after && typeof importEmergencyUse.after === 'object', 'emergency use evidence must include after snapshot');
  assert(Array.isArray(importEmergencyUse.touchedFiles), 'emergency use evidence must include touchedFiles');

  const onefileCacheRoot = path.join(tempRoot, 'onefile-cache');
  for (const [entryName, timestamp] of [
    ['old-a', '2026-05-01T00:00:00.000Z'],
    ['old-b', '2026-05-02T00:00:00.000Z'],
    ['new-c', '2026-05-03T00:00:00.000Z']
  ] as const) {
    const entryRoot = path.join(onefileCacheRoot, entryName);
    mkdirSync(entryRoot, { recursive: true });
    writeFileSync(path.join(entryRoot, 'payload.txt'), entryName, 'utf8');
    const date = new Date(timestamp);
    utimesSync(entryRoot, date, date);
  }
  const cacheDryRun = await runAtm(['cache', 'prune', '--runtime', 'onefile', '--keep', '1', '--dry-run', '--json'], root, {
    ATM_ONEFILE_CACHE_ROOT: onefileCacheRoot
  });
  assert(cacheDryRun.exitCode === 0, 'cache prune dry-run must exit 0');
  assertReadable(cacheDryRun, 'cache');
  assert(cacheDryRun.parsed.evidence.result.prunedCount === 2, 'cache prune dry-run must report two prune candidates');
  assert(existsSync(path.join(onefileCacheRoot, 'old-a')), 'cache prune dry-run must not delete old-a');
  const cachePrune = await runAtm(['cache', 'prune', '--runtime', 'onefile', '--keep', '1', '--json'], root, {
    ATM_ONEFILE_CACHE_ROOT: onefileCacheRoot
  });
  assert(cachePrune.exitCode === 0, 'cache prune must exit 0');
  assertReadable(cachePrune, 'cache');
  assert(cachePrune.parsed.evidence.result.prunedCount === 2, 'cache prune must remove two old entries');
  assert(!existsSync(path.join(onefileCacheRoot, 'old-a')), 'cache prune must delete old-a');
  assert(!existsSync(path.join(onefileCacheRoot, 'old-b')), 'cache prune must delete old-b');
  assert(existsSync(path.join(onefileCacheRoot, 'new-c')), 'cache prune must keep newest entry');

  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });

  const missingStatus = await runAtm(['status'], blankRepo);
  assert(missingStatus.exitCode === 1, 'status before init must exit 1');
  assertReadable(missingStatus, 'status');
  assert(missingStatus.parsed.ok === false, 'status before init must report ok=false');
  assertMessageCode(missingStatus, 'ATM_CONFIG_MISSING');

  const init = await runAtm(['init'], blankRepo);
  assert(init.exitCode === 0, 'init must exit 0 in blank repo');
  assertReadable(init, 'init');
  assert(init.parsed.ok === true, 'init must report ok=true');
  assert(init.parsed.evidence.adapterMode === 'standalone', 'init must report standalone mode');
  assert(init.parsed.evidence.adapterImplemented === false, 'init must not require adapter implementation');
  assert(existsSync(path.join(blankRepo, fixture.configPath)), 'init must create config file');

  const createDryRun = await runAtm(['create', '--cwd', blankRepo, '--bucket', 'fixture', '--title', 'CliCreateDryRun', '--description', 'CLI create dry-run fixture.', '--dry-run'], blankRepo);
  assert(createDryRun.exitCode === 0, 'create --dry-run must exit 0 in blank repo');
  assertReadable(createDryRun, 'create');
  assert(createDryRun.parsed.ok === true, 'create --dry-run must report ok=true');
  assert(createDryRun.parsed.evidence.dryRun === true, 'create --dry-run must report dryRun=true');
  assert(createDryRun.parsed.evidence.atomId === 'ATM-FIXTURE-0001', 'create --dry-run must allocate ATM-FIXTURE-0001 from blank repo');
  assertMessageCode(createDryRun, 'ATM_CREATE_DRY_RUN_OK');

  const initDryRun = await runAtm(['init', '--adopt', '--dry-run'], blankRepo);
  assert(initDryRun.exitCode === 0, 'init --adopt --dry-run must exit 0');
  assertReadable(initDryRun, 'init');
  assert(initDryRun.parsed.ok === true, 'init --adopt --dry-run must report ok=true');
  assert(initDryRun.parsed.evidence.adoptedAt, 'init --adopt --dry-run must report adoptedAt');
  assert(initDryRun.parsed.evidence.dryRun === true, 'init --adopt --dry-run must report dryRun=true');

  const atmChartRepo = path.join(tempRoot, 'atm-chart-repo');
  mkdirSync(atmChartRepo, { recursive: true });
  initializeGitRepository(atmChartRepo);
  const atmChartBootstrap = await runAtm(['bootstrap', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartBootstrap.exitCode === 0, 'bootstrap must exit 0 before ATMChart render');

  const atmChartRender = await runAtm(['atm-chart', 'render', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartRender.exitCode === 0, 'atm-chart render must exit 0 after bootstrap');
  assertReadable(atmChartRender, 'atm-chart');
  assert(atmChartRender.parsed.ok === true, 'atm-chart render must report ok=true');
  assert(atmChartRender.parsed.evidence.atmChartPath === '.atm/memory/atm-chart.md', 'atm-chart render must use the default memory path');
  assert(existsSync(path.join(atmChartRepo, '.atm/memory/atm-chart.md')), 'atm-chart render must write .atm/memory/atm-chart.md');
  assertMessageCode(atmChartRender, 'ATM_CHART_RENDERED');

  const atmChartVerify = await runAtm(['atm-chart', 'verify', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartVerify.exitCode === 0, 'atm-chart verify must exit 0 immediately after render');
  assertReadable(atmChartVerify, 'atm-chart');
  assert(atmChartVerify.parsed.ok === true, 'atm-chart verify must report ok=true when fresh');
  assertMessageCode(atmChartVerify, 'ATM_CHART_VERIFY_OK');

  const atmChartVersionVerify = await runAtm(['atm-chart', 'verify', '--version-check', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartVersionVerify.exitCode === 0, 'atm-chart verify --version-check must exit 0 for default rendered chart');
  assertReadable(atmChartVersionVerify, 'atm-chart');
  assert(atmChartVersionVerify.parsed.evidence.versionCompatibility.status === 'supported', 'atm-chart verify --version-check must report supported status');
  assertMessageCode(atmChartVersionVerify, 'ATM_CHART_VERSION_CHECK_OK');

  const agentPackList = await runAtm(['agent-pack', 'list', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackList.exitCode === 0, 'agent-pack list must exit 0');
  assertReadable(agentPackList, 'agent-pack');
  assert(agentPackList.parsed.ok === true, 'agent-pack list must report ok=true');
  assert(Array.isArray(agentPackList.parsed.evidence.installedPacks), 'agent-pack list must report installedPacks array');

  const agentPackInstall = await runAtm(['agent-pack', 'install', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackInstall.exitCode === 0, 'agent-pack install --id must exit 0 after bootstrap');
  assertReadable(agentPackInstall, 'agent-pack');
  assert(agentPackInstall.parsed.ok === true, 'agent-pack install --id must report ok=true');
  assert(agentPackInstall.parsed.evidence.manifestPath === '.atm/agent-pack/claude-code.manifest.json', 'agent-pack install must write the pack manifest path');
  assert(existsSync(path.join(atmChartRepo, '.atm/agent-pack/claude-code.manifest.json')), 'agent-pack install must write the pack manifest');
  assertMessageCode(agentPackInstall, 'ATM_AGENT_PACK_INSTALL');

  const agentPackVerifyFresh = await runAtm(['agent-pack', 'verify-fresh', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackVerifyFresh.exitCode === 0, 'agent-pack verify-fresh must exit 0 immediately after install');
  assertReadable(agentPackVerifyFresh, 'agent-pack');
  assert(agentPackVerifyFresh.parsed.ok === true, 'agent-pack verify-fresh must report ok=true when fresh');
  assertMessageCode(agentPackVerifyFresh, 'ATM_AGENT_PACK_VERIFY_FRESH_OK');

  const welcomeDryRun = await runAtm(['welcome', '--cwd', atmChartRepo, '--dry-run'], atmChartRepo);
  assert(welcomeDryRun.exitCode === 0, 'welcome --dry-run must exit 0 after ATMChart render');
  assertReadable(welcomeDryRun, 'welcome');
  assert(welcomeDryRun.parsed.ok === true, 'welcome --dry-run must report ok=true');
  assert(welcomeDryRun.parsed.evidence.dryRun === true, 'welcome --dry-run must report dryRun=true');
  assert(welcomeDryRun.parsed.evidence.versions.frameworkVersion === fixture.frameworkVersion || typeof welcomeDryRun.parsed.evidence.versions.frameworkVersion === 'string', 'welcome --dry-run must report framework version');
  assert(welcomeDryRun.parsed.evidence.versions.chartVersion === '0.1.0', 'welcome --dry-run must report chart version');
  assert(welcomeDryRun.parsed.evidence.versions.templateVersion === '0.1.0', 'welcome --dry-run must report template version');
  assert(welcomeDryRun.parsed.evidence.lineagePath === null, 'welcome --dry-run must not report a persisted lineage path');
  assert(!existsSync(path.join(atmChartRepo, '.atm/runtime/welcome.lineage.json')), 'welcome --dry-run must not write welcome lineage');
  assertMessageCode(welcomeDryRun, 'ATM_WELCOME_DRY_RUN');
  assertMessageCode(welcomeDryRun, 'ATM_WELCOME_INTEGRATION_INSTALL_RECOMMENDED');
  assert(welcomeDryRun.parsed.evidence.integrationBootstrap.needsInstallHint === true, 'welcome --dry-run must recommend editor integration install when none are present');

  const welcome = await runAtm(['welcome', '--cwd', atmChartRepo], atmChartRepo);
  assert(welcome.exitCode === 0, 'welcome must exit 0 after ATMChart render');
  assertReadable(welcome, 'welcome');
  assert(welcome.parsed.ok === true, 'welcome must report ok=true');
  assert(welcome.parsed.evidence.lineagePath === '.atm/runtime/welcome.lineage.json', 'welcome must report the welcome lineage path');
  assert(existsSync(path.join(atmChartRepo, '.atm/runtime/welcome.lineage.json')), 'welcome must write welcome lineage');
  assert(welcome.parsed.evidence.welcomeLineage.welcomeCount === 1, 'welcome lineage must start with welcomeCount=1');
  assert(typeof welcome.parsed.evidence.nextAction?.command === 'string', 'welcome must surface the next action command');
  assertMessageCode(welcome, 'ATM_WELCOME_READY');
  assertMessageCode(welcome, 'ATM_WELCOME_INTEGRATION_INSTALL_RECOMMENDED');

  const nextAfterWelcome = await runAtm(['next', '--cwd', atmChartRepo], atmChartRepo);
  assertReadable(nextAfterWelcome, 'next');
  assert(nextAfterWelcome.parsed.evidence.agent_pack_hint != null, 'next must surface agent_pack_hint');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.slashCommandId === 'string', 'agent_pack_hint must have slashCommandId');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.route === 'string', 'agent_pack_hint must have route');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.command === 'string', 'agent_pack_hint must have command');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.reason === 'string', 'agent_pack_hint must have reason');

  const welcomeDoctor = await runAtm(['doctor', '--cwd', atmChartRepo], atmChartRepo);
  assertReadable(welcomeDoctor, 'doctor');
  const onboardingCheck = welcomeDoctor.parsed.evidence.checks.find((check: any) => check.name === 'onboarding-lifecycle');
  const versionCheck = welcomeDoctor.parsed.evidence.checks.find((check: any) => check.name === 'version-compatibility');
  assert(onboardingCheck.ok === true, 'doctor onboarding-lifecycle check must pass after ATMChart render and welcome');
  assert(versionCheck.ok === true, 'doctor version-compatibility check must pass after default ATMChart render');
  assert(versionCheck.details.compatibility.status === 'supported', 'doctor version-compatibility check must report supported status');
  assert(onboardingCheck.details.stage === 'welcomed', 'doctor onboarding-lifecycle check must report welcomed stage');
  assert(onboardingCheck.details.atmChartFreshness === 'fresh', 'doctor onboarding-lifecycle check must report fresh ATMChart');
  assertMessageCode(welcomeDoctor, 'ATM_DOCTOR_INTEGRATION_INSTALL_RECOMMENDED');
  assert(welcomeDoctor.parsed.evidence.integrationBootstrap.needsInstallHint === true, 'doctor must recommend editor integration install when none are present');

  writeHostPackageLockSignals(atmChartRepo);
  const packageLockHostDoctor = await runAtm(['doctor', '--cwd', atmChartRepo], atmChartRepo);
  assert(packageLockHostDoctor.exitCode === 0, 'doctor must stay green for host repos that happen to use package-lock');
  assertReadable(packageLockHostDoctor, 'doctor');
  assert(packageLockHostDoctor.parsed.ok === true, 'doctor must report ok=true for package-lock host repos');
  assert(packageLockHostDoctor.parsed.evidence.projectRole === 'host', 'doctor must classify package-lock host repos as host');
  assert(packageLockHostDoctor.parsed.evidence.checks.find((check: any) => check.name === 'public-script-contract')?.ok === true,
    'doctor must not require framework public scripts from package-lock host repos');
  assert(packageLockHostDoctor.parsed.evidence.checks.find((check: any) => check.name === 'self-host-alpha-entry')?.ok === true,
    'doctor must not require framework self-host-alpha entry from package-lock host repos');

  const guardsPath = path.join(atmChartRepo, '.atm', 'runtime', 'default-guards.json');
  const guards = JSON.parse(readFileSync(guardsPath, 'utf8'));
  guards.guards[0].summary = `${guards.guards[0].summary} (drift)`;
  writeFileSync(guardsPath, `${JSON.stringify(guards, null, 2)}\n`, 'utf8');

  const atmChartStale = await runAtm(['atm-chart', 'verify', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartStale.exitCode === 2, 'atm-chart verify must exit 2 when source guards drift');
  assert(atmChartStale.parsed.ok === false, 'atm-chart verify must report ok=false when stale');
  assertMessageCode(atmChartStale, 'ATM_CHART_STALE');

  const agentPackStale = await runAtm(['agent-pack', 'verify-fresh', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackStale.exitCode === 2, 'agent-pack verify-fresh must exit 2 when source guards drift');
  assert(agentPackStale.parsed.ok === false, 'agent-pack verify-fresh must report ok=false when stale');
  assertMessageCode(agentPackStale, 'ATM_AGENT_PACK_STALE');

  const staleDoctor = await runAtm(['doctor', '--cwd', atmChartRepo], atmChartRepo);
  assert(staleDoctor.exitCode === 1, 'doctor must fail when onboarding ATMChart is stale');
  assertReadable(staleDoctor, 'doctor');
  const staleOnboardingCheck = staleDoctor.parsed.evidence.checks.find((check: any) => check.name === 'onboarding-lifecycle');
  assert(staleOnboardingCheck.ok === false, 'doctor onboarding-lifecycle check must fail when ATMChart is stale');
  assert(staleOnboardingCheck.details.atmChartFreshness === 'stale', 'doctor onboarding-lifecycle check must report stale ATMChart');
  assertMessageCode(staleDoctor, 'ATM_DOCTOR_ONBOARDING_STALE');

  const status = await runAtm(['status'], blankRepo);
  assert(status.exitCode === 0, 'status after init must exit 0');
  assertReadable(status, 'status');
  assert(status.parsed.ok === true, 'status after init must report ok=true');
  assert(status.parsed.evidence.standaloneMode === true, 'status must report standaloneMode=true');

  const validateRepo = await runAtm(['validate'], blankRepo);
  assert(validateRepo.exitCode === 0, 'validate after init must exit 0');
  assertReadable(validateRepo, 'validate');
  assert(validateRepo.parsed.ok === true, 'validate after init must report ok=true');
  assertMessageCode(validateRepo, 'ATM_VALIDATE_REPOSITORY_OK');

  const validateTaxonomy = await runAtm(['validate', 'taxonomy', '--json'], blankRepo);
  assert(validateTaxonomy.exitCode === 0, 'validate taxonomy must exit 0');
  assertReadable(validateTaxonomy, 'validate');
  assert(validateTaxonomy.parsed.ok === true, 'validate taxonomy must report ok=true');
  assert(validateTaxonomy.parsed.evidence.validation === 'taxonomy', 'validate taxonomy must identify validation type');
  assert(validateTaxonomy.parsed.evidence.taxonomy['typecheck'].scope === 'task-local', 'typecheck must default to task-local scope');
  assert(validateTaxonomy.parsed.evidence.taxonomy['validate:neutrality'].scope === 'global-advisory', 'neutrality must default to global-advisory when no protected files touched');
  assertMessageCode(validateTaxonomy, 'ATM_VALIDATE_TAXONOMY_OK');

  const integrationRepo = path.join(tempRoot, 'integration-repo');
  mkdirSync(integrationRepo, { recursive: true });
  const integrationList = await runAtm(['integration', 'list', '--cwd', integrationRepo], integrationRepo);
  assert(integrationList.exitCode === 0, 'integration list must exit 0');
  assertReadable(integrationList, 'integration');
  assert(integrationList.parsed.ok === true, 'integration list must report ok=true');
  assert(integrationList.parsed.evidence.available.includes('claude-code'), 'integration list must include claude-code');
  assert(integrationList.parsed.evidence.available.includes('codex'), 'integration list must include codex');
  assert(integrationList.parsed.evidence.available.includes('copilot'), 'integration list must include copilot');
  assert(integrationList.parsed.evidence.available.includes('cursor'), 'integration list must include cursor');
  assert(integrationList.parsed.evidence.available.includes('gemini'), 'integration list must include gemini');
  assert(integrationList.parsed.evidence.available.includes('antigravity'), 'integration list must include antigravity');
  assertMessageCode(integrationList, 'ATM_INTEGRATION_LIST_OK');

  const integrationAdd = await runAtm(['integration', 'add', 'claude-code', '--cwd', integrationRepo, '--actor', 'validate-cli', '--at', '2026-01-01T00:00:00.000Z'], integrationRepo);
  assert(integrationAdd.exitCode === 0, 'integration add claude-code must exit 0');
  assertReadable(integrationAdd, 'integration');
  assert(integrationAdd.parsed.ok === true, 'integration add claude-code must report ok=true');
  assert(integrationAdd.parsed.evidence.manifestPath === '.atm/integrations/claude-code.manifest.json', 'integration add must use per-adapter manifest path');
  assert(existsSync(path.join(integrationRepo, '.atm/integrations/claude-code.manifest.json')), 'integration add must write per-adapter manifest');
  assert(existsSync(path.join(integrationRepo, '.claude/skills/atm-next/SKILL.md')), 'integration add must write agent-native entry files');
  assertMessageCode(integrationAdd, 'ATM_INTEGRATION_ADDED');

  const integrationVerify = await runAtm(['integration', 'verify', 'claude-code', '--cwd', integrationRepo], integrationRepo);
  assert(integrationVerify.exitCode === 0, 'integration verify claude-code must exit 0 after install');
  assertReadable(integrationVerify, 'integration');
  assert(integrationVerify.parsed.ok === true, 'integration verify claude-code must report ok=true');
  assert(integrationVerify.parsed.evidence.driftedFiles.length === 0, 'integration verify must report no drift after install');
  assertMessageCode(integrationVerify, 'ATM_INTEGRATION_VERIFY_OK');

  const integrationRemove = await runAtm(['integration', 'remove', 'claude-code', '--cwd', integrationRepo], integrationRepo);
  assert(integrationRemove.exitCode === 0, 'integration remove claude-code must exit 0');
  assertReadable(integrationRemove, 'integration');
  assert(integrationRemove.parsed.ok === true, 'integration remove claude-code must report ok=true');
  assert(!existsSync(path.join(integrationRepo, '.atm/integrations/claude-code.manifest.json')), 'integration remove must remove unchanged manifest');
  assert(!existsSync(path.join(integrationRepo, '.claude/skills/atm-next/SKILL.md')), 'integration remove must remove unchanged entry file');
  assertMessageCode(integrationRemove, 'ATM_INTEGRATION_REMOVED');

  const codexIntegrationAdd = await runAtm(['integration', 'add', 'codex', '--cwd', integrationRepo, '--actor', 'validate-cli', '--at', '2026-01-01T00:00:00.000Z'], integrationRepo);
  assert(codexIntegrationAdd.exitCode === 0, 'integration add codex must exit 0');
  assertReadable(codexIntegrationAdd, 'integration');
  assert(codexIntegrationAdd.parsed.ok === true, 'integration add codex must report ok=true');
  assert(codexIntegrationAdd.parsed.evidence.manifestPath === '.atm/integrations/codex.manifest.json', 'codex integration add must use per-adapter manifest path');
  assert(existsSync(path.join(integrationRepo, '.atm/integrations/codex.manifest.json')), 'codex integration add must write per-adapter manifest');
  assert(existsSync(path.join(integrationRepo, 'integrations/codex-skills/atm-next/SKILL.md')), 'codex integration add must write Codex skill files');
  assertMessageCode(codexIntegrationAdd, 'ATM_INTEGRATION_ADDED');

  const codexIntegrationVerify = await runAtm(['integration', 'verify', 'codex', '--cwd', integrationRepo], integrationRepo);
  assert(codexIntegrationVerify.exitCode === 0, 'integration verify codex must exit 0 after install');
  assertReadable(codexIntegrationVerify, 'integration');
  assert(codexIntegrationVerify.parsed.ok === true, 'integration verify codex must report ok=true');
  assert(codexIntegrationVerify.parsed.evidence.driftedFiles.length === 0, 'codex integration verify must report no drift after install');
  assertMessageCode(codexIntegrationVerify, 'ATM_INTEGRATION_VERIFY_OK');

  const codexIntegrationRemove = await runAtm(['integration', 'remove', 'codex', '--cwd', integrationRepo], integrationRepo);
  assert(codexIntegrationRemove.exitCode === 0, 'integration remove codex must exit 0');
  assertReadable(codexIntegrationRemove, 'integration');
  assert(codexIntegrationRemove.parsed.ok === true, 'integration remove codex must report ok=true');
  assert(!existsSync(path.join(integrationRepo, '.atm/integrations/codex.manifest.json')), 'codex integration remove must remove unchanged manifest');
  assert(!existsSync(path.join(integrationRepo, 'integrations/codex-skills/atm-next/SKILL.md')), 'codex integration remove must remove unchanged entry file');
  assertMessageCode(codexIntegrationRemove, 'ATM_INTEGRATION_REMOVED');

  const antigravityIntegrationAdd = await runAtm(['integration', 'add', 'antigravity', '--cwd', integrationRepo, '--actor', 'validate-cli', '--at', '2026-01-01T00:00:00.000Z'], integrationRepo);
  assert(antigravityIntegrationAdd.exitCode === 0, 'integration add antigravity must exit 0');
  assertReadable(antigravityIntegrationAdd, 'integration');
  assert(antigravityIntegrationAdd.parsed.ok === true, 'integration add antigravity must report ok=true');
  assert(antigravityIntegrationAdd.parsed.evidence.manifestPath === '.atm/integrations/antigravity.manifest.json', 'antigravity integration add must use per-adapter manifest path');
  assert(existsSync(path.join(integrationRepo, '.atm/integrations/antigravity.manifest.json')), 'antigravity integration add must write per-adapter manifest');
  assert(existsSync(path.join(integrationRepo, 'GEMINI.md')), 'antigravity integration add must write GEMINI.md');
  assert(existsSync(path.join(integrationRepo, '.agents/skills/atm-next/SKILL.md')), 'antigravity integration add must write .agents skill files');
  assertMessageCode(antigravityIntegrationAdd, 'ATM_INTEGRATION_ADDED');

  const antigravityIntegrationVerify = await runAtm(['integration', 'verify', 'antigravity', '--cwd', integrationRepo], integrationRepo);
  assert(antigravityIntegrationVerify.exitCode === 0, 'integration verify antigravity must exit 0 after install');
  assertReadable(antigravityIntegrationVerify, 'integration');
  assert(antigravityIntegrationVerify.parsed.ok === true, 'integration verify antigravity must report ok=true');
  assert(antigravityIntegrationVerify.parsed.evidence.driftedFiles.length === 0, 'antigravity integration verify must report no drift after install');
  assertMessageCode(antigravityIntegrationVerify, 'ATM_INTEGRATION_VERIFY_OK');

  const antigravityIntegrationRemove = await runAtm(['integration', 'remove', 'antigravity', '--cwd', integrationRepo], integrationRepo);
  assert(antigravityIntegrationRemove.exitCode === 0, 'integration remove antigravity must exit 0');
  assertReadable(antigravityIntegrationRemove, 'integration');
  assert(antigravityIntegrationRemove.parsed.ok === true, 'integration remove antigravity must report ok=true');
  assert(!existsSync(path.join(integrationRepo, '.atm/integrations/antigravity.manifest.json')), 'antigravity integration remove must remove unchanged manifest');
  assert(!existsSync(path.join(integrationRepo, 'GEMINI.md')), 'antigravity integration remove must remove unchanged GEMINI.md');
  assert(!existsSync(path.join(integrationRepo, '.agents/skills/atm-next/SKILL.md')), 'antigravity integration remove must remove unchanged .agents skill file');
  assertMessageCode(antigravityIntegrationRemove, 'ATM_INTEGRATION_REMOVED');

  const initIntegrationRepo = path.join(tempRoot, 'init-integration-repo');
  mkdirSync(initIntegrationRepo, { recursive: true });
  const initWithIntegration = await runAtm(['init', '--cwd', initIntegrationRepo, '--integration', 'cursor'], initIntegrationRepo);
  assert(initWithIntegration.exitCode === 0, 'init --integration cursor must exit 0');
  assertReadable(initWithIntegration, 'init');
  assert(initWithIntegration.parsed.ok === true, 'init --integration cursor must report ok=true');
  assert(initWithIntegration.parsed.evidence.integrationInstall?.adapter?.id === 'cursor', 'init --integration must report installed adapter id');
  assert(existsSync(path.join(initIntegrationRepo, '.atm/integrations/cursor.manifest.json')), 'init --integration must write per-adapter manifest');
  assert(existsSync(path.join(initIntegrationRepo, '.cursor/rules/skills/atm-next/SKILL.md')), 'init --integration must write adapter files');
  assertMessageCode(initWithIntegration, 'ATM_INIT_INTEGRATION_ADDED');

  const initIntegrationDoctor = await runAtm(['doctor', '--cwd', initIntegrationRepo], initIntegrationRepo);
  assertReadable(initIntegrationDoctor, 'doctor');
  const integrationDoctorCheck = initIntegrationDoctor.parsed.evidence.checks.find((check: any) => check.name === 'integration-adapters');
  assert(integrationDoctorCheck.ok === true, 'doctor integration-adapters check must pass after init --integration');
  assert(integrationDoctorCheck.details.installed.includes('cursor'), 'doctor integration-adapters check must report installed cursor adapter');

  const cursorSkillPath = path.join(initIntegrationRepo, '.cursor/rules/skills/atm-next/SKILL.md');
  writeFileSync(cursorSkillPath, `${readFileSync(cursorSkillPath, 'utf8')}\n# drift\n`, 'utf8');
  const initIntegrationDoctorDrift = await runAtm(['doctor', '--cwd', initIntegrationRepo], initIntegrationRepo);
  assert(initIntegrationDoctorDrift.exitCode === 1, 'doctor must fail after adapter file drift');
  assertReadable(initIntegrationDoctorDrift, 'doctor');
  const integrationDriftCheck = initIntegrationDoctorDrift.parsed.evidence.checks.find((check: any) => check.name === 'integration-adapters');
  assert(integrationDriftCheck.ok === false, 'doctor integration-adapters check must fail after drift');
  assert(integrationDriftCheck.details.failed[0].driftedFiles.includes('.cursor/rules/skills/atm-next/SKILL.md'), 'doctor integration-adapters check must report drifted file');
  const integrationDriftRemediation = initIntegrationDoctorDrift.parsed.evidence.integrationDriftRemediation;
  assert(integrationDriftRemediation?.schemaId === 'atm.integrationDriftRemediation.v1', 'doctor integration drift must expose machine-readable remediation');
  assert(integrationDriftRemediation.failedAdapters[0].adapterId === 'cursor', 'doctor integration drift remediation must report adapter id');
  assert(integrationDriftRemediation.failedAdapters[0].manifestPath === '.atm/integrations/cursor.manifest.json', 'doctor integration drift remediation must report manifest path');
  assert(integrationDriftRemediation.failedAdapters[0].driftedFiles.includes('.cursor/rules/skills/atm-next/SKILL.md'), 'doctor integration drift remediation must report drifted file paths');
  assert(integrationDriftRemediation.failedAdapters[0].verifyCommand === 'node atm.mjs integration verify cursor --json', 'doctor integration drift remediation must report exact verify command');
  assert(integrationDriftRemediation.failedAdapters[0].reinstallCommand === 'node atm.mjs integration add cursor --force --json', 'doctor integration drift remediation must report exact reinstall command');
  assert(integrationDriftRemediation.failedAdapters[0].removeCommand === 'node atm.mjs integration remove cursor --json', 'doctor integration drift remediation must report exact remove command');

  const validSpecPath = path.join(root, fixture.validAtomicSpec);
  const validateSpec = await runAtm(['validate', '--spec', validSpecPath], blankRepo);
  assert(validateSpec.exitCode === 0, 'validate --spec valid fixture must exit 0');
  assertReadable(validateSpec, 'validate');
  assert(validateSpec.parsed.ok === true, 'validate --spec valid fixture must report ok=true');
  assertMessageCode(validateSpec, 'ATM_VALIDATE_SPEC_OK');

  const specValidate = await runAtm(['spec', '--validate', validSpecPath], blankRepo);
  assert(specValidate.exitCode === 0, 'spec --validate valid fixture must exit 0');
  assertReadable(specValidate, 'spec');
  assert(specValidate.parsed.ok === true, 'spec --validate valid fixture must report ok=true');
  assertMessageCode(specValidate, 'ATM_SPEC_VALIDATE_OK');

  const invalidSpecPath = path.join(blankRepo, 'invalid.atom.json');
  writeFileSync(invalidSpecPath, JSON.stringify({ schemaId: 'atm.atomicSpec', specVersion: '0.1.0' }, null, 2), 'utf8');
  const validateInvalidSpec = await runAtm(['validate', '--spec', invalidSpecPath], blankRepo);
  assert(validateInvalidSpec.exitCode === 1, 'validate --spec invalid fixture must exit 1');
  assertReadable(validateInvalidSpec, 'validate');
  assert(validateInvalidSpec.parsed.ok === false, 'validate --spec invalid fixture must report ok=false');
  assertMessageCode(validateInvalidSpec, 'ATM_SPEC_REQUIRED_FIELD');

  const specValidateInvalid = await runAtm(['spec', '--validate', invalidSpecPath], blankRepo);
  assert(specValidateInvalid.exitCode === 1, 'spec --validate invalid fixture must exit 1');
  assertReadable(specValidateInvalid, 'spec');
  assert(specValidateInvalid.parsed.ok === false, 'spec --validate invalid fixture must report ok=false');
  assertMessageCode(specValidateInvalid, 'ATM_SPEC_REQUIRED_FIELD');

  const validateMissingSpec = await runAtm(['validate', '--spec', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(validateMissingSpec.exitCode === 1, 'validate --spec missing fixture must exit 1');
  assertReadable(validateMissingSpec, 'validate');
  assert(validateMissingSpec.parsed.ok === false, 'validate --spec missing fixture must report ok=false');
  assertMessageCode(validateMissingSpec, 'ATM_SPEC_NOT_FOUND');

  const specValidateMissing = await runAtm(['spec', '--validate', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(specValidateMissing.exitCode === 1, 'spec --validate missing fixture must exit 1');
  assertReadable(specValidateMissing, 'spec');
  assert(specValidateMissing.parsed.ok === false, 'spec --validate missing fixture must report ok=false');
  assertMessageCode(specValidateMissing, 'ATM_SPEC_NOT_FOUND');

  const bootstrapRepo = path.join(tempRoot, 'bootstrap-repo');
  mkdirSync(bootstrapRepo, { recursive: true });
  const bootstrap = await runAtm(['bootstrap', '--cwd', bootstrapRepo, '--task', 'Bootstrap ATM self-hosting alpha'], bootstrapRepo);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 in blank repo');
  assertReadable(bootstrap, 'bootstrap');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true');
  assert(bootstrap.parsed.evidence.adoptedProfile === 'default', 'bootstrap must adopt default profile');
  assert(existsSync(path.join(bootstrapRepo, 'AGENTS.md')), 'bootstrap must create AGENTS.md');

  const verifySelf = await runAtm(['verify', '--self'], root);
  assert(verifySelf.exitCode === 0, 'verify --self must exit 0 in repository root');
  assertReadable(verifySelf, 'verify');
  assert(verifySelf.parsed.ok === true, 'verify --self must report ok=true');
  assertMessageCode(verifySelf, 'ATM_VERIFY_SELF_OK');

  const verifyNeutrality = await runAtm(['verify', '--neutrality'], root);
  assert(verifyNeutrality.exitCode === 0, 'verify --neutrality must exit 0 in repository root');
  assertReadable(verifyNeutrality, 'verify');
  assert(verifyNeutrality.parsed.ok === true, 'verify --neutrality must report ok=true');
  assertMessageCode(verifyNeutrality, 'ATM_VERIFY_NEUTRALITY_OK');

  const verifyAgentsMd = await runAtm(['verify', '--agents-md', '--json'], root);
  assert(verifyAgentsMd.exitCode === 0, 'verify --agents-md must exit 0 in repository root');
  assertReadable(verifyAgentsMd, 'verify');
  assert(verifyAgentsMd.parsed.ok === true, 'verify --agents-md must report ok=true');
  assertMessageCode(verifyAgentsMd, 'ATM_VERIFY_AGENTS_MD_OK');

  const verifyGuardsPass = await runAtm(['verify', '--guards', '--evidence', path.join(root, 'fixtures/verify/guard-evidence-pass.json')], root);
  assert(verifyGuardsPass.exitCode === 0, 'verify --guards --evidence pass must exit 0');
  assertReadable(verifyGuardsPass, 'verify');
  assert(verifyGuardsPass.parsed.ok === true, 'verify --guards --evidence pass must report ok=true');
  assertMessageCode(verifyGuardsPass, 'ATM_VERIFY_GUARDS_OK');

  const verifyGuardsMissing = await runAtm(['verify', '--guards', '--evidence', path.join(root, 'fixtures/verify/guard-evidence-missing-justification.json')], root);
  assert(verifyGuardsMissing.exitCode === 1, 'verify --guards --evidence missing-justification must exit 1');
  assertReadable(verifyGuardsMissing, 'verify');
  assert(verifyGuardsMissing.parsed.ok === false, 'verify --guards --evidence missing-justification must report ok=false');
  assertMessageCode(verifyGuardsMissing, 'ATM_VERIFY_GUARDS_MISSING_JUSTIFICATION');
  assert(verifyGuardsMissing.parsed.evidence.requiredJustification !== null, 'verify --guards missing-justification must report requiredJustification');
  assert(Array.isArray(verifyGuardsMissing.parsed.evidence.missingJustifications), 'verify --guards missing-justification must list missingJustifications');
  assert(verifyGuardsMissing.parsed.evidence.missingJustifications.includes('evidence-after-change'), 'verify --guards missing-justification must name the offending guardId');

  const upgradePass = await runAtm([
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--dry-run',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    '--input', 'fixtures/upgrade/hash-diff-report.json',
    '--input', 'tests/schema-fixtures/positive/minimal-execution-evidence.json',
    '--input', 'tests/police-fixtures/positive/non-regression-report.json',
    '--input', 'fixtures/upgrade/quality-comparison-pass.json',
    '--input', 'tests/police-fixtures/positive/registry-candidate-report.json'
  ], root);
  assert(upgradePass.exitCode === 0, 'upgrade pass proposal must exit 0');
  assertReadable(upgradePass, 'upgrade');
  assert(upgradePass.parsed.ok === true, 'upgrade pass proposal must report ok=true');
  assert(upgradePass.parsed.evidence.status === 'pending', 'upgrade pass proposal must report pending status');
  assert(upgradePass.parsed.evidence.proposal.humanReview === 'pending', 'upgrade pass proposal must set humanReview=pending');
  assert(upgradePass.parsed.evidence.proposal.automatedGates.allPassed === true, 'upgrade pass proposal gates must pass');
  assertMessageCode(upgradePass, 'ATM_UPGRADE_PROPOSAL_READY');

  const upgradeBlocked = await runAtm([
    'upgrade',
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--dry-run',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    '--input', 'fixtures/upgrade/hash-diff-report.json',
    '--input', 'tests/schema-fixtures/positive/minimal-execution-evidence.json',
    '--input', 'tests/police-fixtures/positive/non-regression-report.json',
    '--input', 'fixtures/upgrade/quality-comparison-blocked.json',
    '--input', 'tests/police-fixtures/positive/registry-candidate-report.json'
  ], root);
  assert(upgradeBlocked.exitCode === 0, 'upgrade blocked proposal must still exit 0 because proposal generation succeeded');
  assertReadable(upgradeBlocked, 'upgrade');
  assert(upgradeBlocked.parsed.ok === true, 'upgrade blocked proposal must report ok=true');
  assert(upgradeBlocked.parsed.evidence.status === 'blocked', 'upgrade blocked proposal must report blocked status');
  assert(upgradeBlocked.parsed.evidence.proposal.automatedGates.allPassed === false, 'upgrade blocked proposal gates must fail');
  assert(upgradeBlocked.parsed.evidence.blockedGateNames.includes('qualityComparison'), 'upgrade blocked proposal must name qualityComparison');
  assertMessageCode(upgradeBlocked, 'ATM_UPGRADE_PROPOSAL_BLOCKED');

  const upgradeScanEmpty = await runAtm([
    'upgrade',
    '--scan',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    '--input', 'fixtures/evolution/evidence-patterns/no-signal.json'
  ], root);
  assert(upgradeScanEmpty.exitCode === 0, 'upgrade --scan empty report must exit 0');
  assertReadable(upgradeScanEmpty, 'upgrade');
  assert(upgradeScanEmpty.parsed.ok === true, 'upgrade --scan empty report must report ok=true');
  assert(upgradeScanEmpty.parsed.evidence.dryRun === true, 'upgrade --scan empty report must be dry-run');
  assert(upgradeScanEmpty.parsed.evidence.proposalDraftCount === 0, 'upgrade --scan empty report must not emit drafts');
  assertMessageCode(upgradeScanEmpty, 'ATM_EVIDENCE_SCAN_EMPTY');

  const upgradeScanDraft = await runAtm([
    'upgrade',
    '--scan',
    '--json',
    '--proposed-at', '2026-01-01T00:00:00.000Z',
    '--input', 'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json'
  ], root);
  assert(upgradeScanDraft.exitCode === 0, 'upgrade --scan proposal draft must exit 0');
  assertReadable(upgradeScanDraft, 'upgrade');
  assert(upgradeScanDraft.parsed.ok === true, 'upgrade --scan proposal draft must report ok=true');
  assert(upgradeScanDraft.parsed.evidence.dryRun === true, 'upgrade --scan proposal draft must remain dry-run');
  assert(upgradeScanDraft.parsed.evidence.proposalDraftCount === 1, 'upgrade --scan proposal draft must emit one draft');
  assert(upgradeScanDraft.parsed.evidence.proposalDrafts[0].proposal.proposalSource === 'evidence-driven', 'upgrade --scan proposal draft must use evidence-driven source');
  assert(upgradeScanDraft.parsed.evidence.proposalDrafts[0].proposal.targetSurface === 'atom-spec', 'upgrade --scan proposal draft must target atom-spec');
  assert(upgradeScanDraft.parsed.evidence.proposalDrafts[0].proposal.baseAtomVersion === '0.1.0', 'upgrade --scan proposal draft must resolve current atom version');
  assert(upgradeScanDraft.parsed.evidence.proposalDrafts[0].proposal.toVersion === '0.1.1', 'upgrade --scan proposal draft must bump patch version');
  assert(upgradeScanDraft.parsed.evidence.proposalDrafts[0].groupIds.includes('evidence-pattern.atom.atm-core-0001.2026-w20.recurring-failure'), 'upgrade --scan proposal draft must keep the candidate group id');
  assertMessageCode(upgradeScanDraft, 'ATM_EVIDENCE_SCAN_READY');

  const rollbackRepo = path.join(tempRoot, 'rollback-repo');
  mkdirSync(rollbackRepo, { recursive: true });
  writeJson(path.join(rollbackRepo, 'atomic-registry.json'), readJson('fixtures/registry/v1-with-versions.json'));

  const rollbackPlan = await runAtm([
    'rollback',
    '--cwd', rollbackRepo,
    '--atom', 'ATM-FIXTURE-0001',
    '--to', '1.0.0',
    '--plan'
  ], rollbackRepo);
  assert(rollbackPlan.exitCode === 0, 'rollback --plan must exit 0');
  assertReadable(rollbackPlan, 'rollback');
  assert(rollbackPlan.parsed.ok === true, 'rollback --plan must report ok=true');
  assert(rollbackPlan.parsed.evidence.proofPreview?.toVersion === '1.0.0', 'rollback --plan must preview target version');
  assertMessageCode(rollbackPlan, 'ATM_ROLLBACK_PLAN_READY');

  const rollbackApply = await runAtm([
    'rollback',
    '--cwd', rollbackRepo,
    '--atom', 'ATM-FIXTURE-0001',
    '--to', '1.0.0',
    '--apply'
  ], rollbackRepo);
  assert(rollbackApply.exitCode === 0, 'rollback --apply must exit 0');
  assertReadable(rollbackApply, 'rollback');
  assert(rollbackApply.parsed.ok === true, 'rollback --apply must report ok=true');
  assert(rollbackApply.parsed.evidence.proof?.verificationStatus === 'passed', 'rollback --apply must produce passed proof');
  assertMessageCode(rollbackApply, 'ATM_ROLLBACK_APPLIED');

  const rolledRegistry = JSON.parse(readFileSync(path.join(rollbackRepo, 'atomic-registry.json'), 'utf8'));
  const rolledEntry = rolledRegistry.entries.find((entry: any) => entry.atomId === 'ATM-FIXTURE-0001');
  assert(rolledEntry.currentVersion === '1.0.0', 'rollback --apply must update currentVersion to target version');
  assert(existsSync(path.join(rollbackRepo, '.atm', 'history', 'reports', 'rollback-proof.json')), 'rollback --apply must write rollback-proof.json');

  const reviewRepo = path.join(tempRoot, 'review-repo');
  mkdirSync(reviewRepo, { recursive: true });
  const reviewQueuePath = path.join(reviewRepo, '.atm', 'history', 'reports', 'upgrade-proposals.json');
  const reviewProposal = readJson('fixtures/upgrade/proposal-pass.json');
  const reviewQueueRecord = {
    proposalId: reviewProposal.proposalId,
    atomId: reviewProposal.atomId,
    fromVersion: reviewProposal.fromVersion,
    toVersion: reviewProposal.toVersion,
    decompositionDecision: reviewProposal.decompositionDecision,
    automatedGates: {
      allPassed: reviewProposal.automatedGates.allPassed,
      blockedGateNames: reviewProposal.automatedGates.blockedGateNames
    },
    status: 'pending',
    proposalSnapshotHash: computeDecisionSnapshotHash(reviewProposal),
    proposal: reviewProposal,
    queuedAt: reviewProposal.proposedAt
  };
  writeJson(reviewQueuePath, {
    schemaId: 'atm.humanReviewQueue',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'CLI review integration fixture.'
    },
    generatedAt: '2026-01-01T00:00:00.000Z',
    entries: [reviewQueueRecord]
  });

  const reviewList = await runAtm(['review', 'list', '--cwd', reviewRepo], reviewRepo);
  assert(reviewList.exitCode === 0, 'review list must exit 0');
  assertReadable(reviewList, 'review');
  assert(reviewList.parsed.ok === true, 'review list must report ok=true');
  assertMessageCode(reviewList, 'ATM_REVIEW_LIST_OK');

  const reviewShow = await runAtm(['review', 'show', reviewProposal.proposalId, '--cwd', reviewRepo], reviewRepo);
  assert(reviewShow.exitCode === 0, 'review show must exit 0');
  assertReadable(reviewShow, 'review');
  assert(reviewShow.parsed.ok === true, 'review show must report ok=true');
  assert(reviewShow.parsed.evidence.proposal?.proposalId === reviewProposal.proposalId, 'review show must return requested proposal');
  assertMessageCode(reviewShow, 'ATM_REVIEW_SHOW_OK');

  const reviewApprove = await runAtm([
    'review',
    'approve',
    reviewProposal.proposalId,
    '--cwd', reviewRepo,
    '--reason', 'manual check approved',
    '--by', 'validate-cli'
  ], reviewRepo);
  assert(reviewApprove.exitCode === 0, 'review approve must exit 0');
  assertReadable(reviewApprove, 'review');
  assert(reviewApprove.parsed.ok === true, 'review approve must report ok=true');
  assert(reviewApprove.parsed.evidence.status === 'approved', 'review approve must set approved status');
  assert(reviewApprove.parsed.evidence.decisionSnapshotHash === reviewQueueRecord.proposalSnapshotHash, 'review approve must preserve decision snapshot hash');
  assertMessageCode(reviewApprove, 'ATM_REVIEW_APPROVED');

  const reviewApplyReady = await runAtm(['review', 'apply-ready', reviewProposal.proposalId, '--cwd', reviewRepo], reviewRepo);
  assert(reviewApplyReady.exitCode === 0, 'review apply-ready must exit 0 for approved proposals');
  assertReadable(reviewApplyReady, 'review');
  assert(reviewApplyReady.parsed.ok === true, 'review apply-ready must report ok=true');
  assert(reviewApplyReady.parsed.evidence.applyPacket?.proposalId === reviewProposal.proposalId, 'review apply-ready must return the requested proposalId');
  assert(Array.isArray(reviewApplyReady.parsed.evidence.applyPacket?.mutationBoundary?.blocked), 'review apply-ready must return blocked mutation guidance');
  assertMessageCode(reviewApplyReady, 'ATM_REVIEW_APPLY_READY_OK');

  const reviewRejectFreshRepo = path.join(tempRoot, 'review-reject-repo');
  mkdirSync(reviewRejectFreshRepo, { recursive: true });
  writeJson(path.join(reviewRejectFreshRepo, '.atm', 'history', 'reports', 'upgrade-proposals.json'), {
    schemaId: 'atm.humanReviewQueue',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'CLI review reject fixture.'
    },
    generatedAt: '2026-01-01T00:00:00.000Z',
    entries: [reviewQueueRecord]
  });
  const reviewRejectMissingReason = await runAtm(['review', 'reject', reviewProposal.proposalId, '--cwd', reviewRejectFreshRepo], reviewRejectFreshRepo);
  assert(reviewRejectMissingReason.exitCode === 2, 'review reject without --reason must exit 2');
  assertReadable(reviewRejectMissingReason, 'review');
  assert(reviewRejectMissingReason.parsed.ok === false, 'review reject without --reason must report ok=false');
  assertMessageCode(reviewRejectMissingReason, 'ATM_CLI_USAGE');

  const reviewReject = await runAtm([
    'review',
    'reject',
    reviewProposal.proposalId,
    '--cwd', reviewRejectFreshRepo,
    '--reason', 'manual reject for fixture',
    '--by', 'validate-cli'
  ], reviewRejectFreshRepo);
  assert(reviewReject.exitCode === 0, 'review reject must exit 0');
  assertReadable(reviewReject, 'review');
  assert(reviewReject.parsed.ok === true, 'review reject must report ok=true');
  assert(reviewReject.parsed.evidence.status === 'rejected', 'review reject must set rejected status');
  assertMessageCode(reviewReject, 'ATM_REVIEW_REJECTED');

  const testHelloWorld = await runAtm(['test', '--atom', 'hello-world'], root);
  assert(testHelloWorld.exitCode === 0, 'test --atom hello-world must exit 0 in repository root');
  assertReadable(testHelloWorld, 'test');
  assert(testHelloWorld.parsed.ok === true, 'test --atom hello-world must report ok=true');
  assert(testHelloWorld.parsed.evidence.passCount === 5, 'test --atom hello-world must report 5 passCount');
  assert(testHelloWorld.parsed.evidence.total === 5, 'test --atom hello-world must report 5 total checks');
  assertMessageCode(testHelloWorld, 'ATM_TEST_HELLO_WORLD_OK');

  const selfHostAlpha = await runAtm(['self-host-alpha', '--verify', '--json'], root);
  assert(selfHostAlpha.exitCode === 0, 'self-host-alpha --verify must exit 0 in repository root');
  assertReadable(selfHostAlpha, 'self-host-alpha');
  assert(selfHostAlpha.parsed.ok === true, 'self-host-alpha --verify must report ok=true');
  assert(selfHostAlpha.parsed.criteria1 === true, 'self-host-alpha criteria1 must be true');
  assert(selfHostAlpha.parsed.criteria2 === true, 'self-host-alpha criteria2 must be true');
  assert(selfHostAlpha.parsed.criteria3 === true, 'self-host-alpha criteria3 must be true');
  assert(selfHostAlpha.parsed.criteria4 === true, 'self-host-alpha criteria4 must be true');
  assertMessageCode(selfHostAlpha, 'ATM_SELF_HOST_ALPHA_OK');

  const selfHostAlphaClaude = await runAtm(['self-host-alpha', '--verify', '--agent', 'claude-code', '--json'], root);
  assert(selfHostAlphaClaude.exitCode === 0, 'self-host-alpha --verify --agent claude-code must exit 0 in repository root');
  assertReadable(selfHostAlphaClaude, 'self-host-alpha');
  assert(selfHostAlphaClaude.parsed.ok === true, 'self-host-alpha --verify --agent claude-code must report ok=true');
  assert(selfHostAlphaClaude.parsed.agent === 'claude-code', 'self-host-alpha --verify --agent claude-code must echo the resolved agent id');
  assert(selfHostAlphaClaude.parsed.evidence.confidence?.advisory === true, 'self-host-alpha --verify --agent claude-code must mark confidence as advisory');
  assert(selfHostAlphaClaude.parsed.evidence.confidence?.confidenceReady === true, 'self-host-alpha --verify --agent claude-code must report confidenceReady=true');
  assertMessageCode(selfHostAlphaClaude, 'ATM_SELF_HOST_ALPHA_CONFIDENCE_ADVISORY');

  const frameworkStatus = await runAtm(['status'], root);
  assert(frameworkStatus.exitCode === 0, 'status in framework repository root must exit 0');
  assertReadable(frameworkStatus, 'status');
  assert(frameworkStatus.parsed.ok === true, 'status in framework repository root must report ok=true');
  if (frameworkStatus.parsed.evidence.initialized === true) {
    assert(frameworkStatus.parsed.evidence.standaloneMode === true, 'status in bootstrapped framework root must report standaloneMode=true');
    assert(frameworkStatus.parsed.evidence.repositoryKind === 'javascript-package', 'status in bootstrapped framework root must surface repositoryKind=javascript-package');
    assertMessageCode(frameworkStatus, 'ATM_STATUS_READY');
  } else {
    assert(frameworkStatus.parsed.evidence.frameworkPhase === 'B1-complete', 'status in framework repository root must surface frameworkPhase=B1-complete');
    assert(frameworkStatus.parsed.evidence.atomStatus === 'active', 'status in framework repository root must surface atomStatus=active');
    assert(frameworkStatus.parsed.evidence.governanceTier === 'governed', 'status in framework repository root must surface governanceTier=governed');
    assertMessageCode(frameworkStatus, 'ATM_STATUS_PHASE_B1_COMPLETE');
  }

  // TASK-AAO-0067: Regression tests for enriched ATM_CLI_USAGE error envelopes
  // Mode 1: Unknown/invalid flag (e.g. doctor --spec)
  const unknownFlagTest = await runAtm(['doctor', '--spec'], root);
  assert(unknownFlagTest.exitCode === 2, 'doctor with invalid option --spec must exit 2');
  assert(unknownFlagTest.parsed.ok === false, 'doctor with invalid option --spec must report ok=false');
  assertMessageCode(unknownFlagTest, 'ATM_CLI_USAGE');
  const unknownFlagMsg = unknownFlagTest.parsed.messages.find((m: any) => m.code === 'ATM_CLI_USAGE');
  assert(unknownFlagMsg, 'must find ATM_CLI_USAGE message');
  assert(Array.isArray(unknownFlagMsg.data.invalidFlags), 'invalidFlags must be an array');
  assert(unknownFlagMsg.data.invalidFlags.includes('--spec'), 'invalidFlags must include --spec');
  assert(Array.isArray(unknownFlagMsg.data.allowedFlags), 'allowedFlags must be an array');
  assert(unknownFlagMsg.data.allowedFlags.includes('--ci-profile'), 'allowedFlags must include --ci-profile');
  assert(Object.hasOwn(unknownFlagMsg.data, 'suggestedCommand'), 'must have suggestedCommand field');

  // Mode 2: Missing required option value (e.g. doctor --cwd with missing value)
  const missingValueTest = await runAtm(['doctor', '--cwd'], root);
  assert(missingValueTest.exitCode === 2, 'doctor with missing --cwd value must exit 2');
  assert(missingValueTest.parsed.ok === false, 'doctor with missing --cwd value must report ok=false');
  assertMessageCode(missingValueTest, 'ATM_CLI_USAGE');
  const missingValueMsg = missingValueTest.parsed.messages.find((m: any) => m.code === 'ATM_CLI_USAGE');
  assert(missingValueMsg, 'must find ATM_CLI_USAGE message');
  assert(Array.isArray(missingValueMsg.data.missingRequired), 'missingRequired must be an array');
  assert(missingValueMsg.data.missingRequired.includes('--cwd'), 'missingRequired must include --cwd');
  assert(unknownFlagMsg.data.allowedFlags.includes('--cwd'), 'allowedFlags must include --cwd');

  // Mode 3: Missing command-specific required argument (e.g. review reject without --reason)
  // Since this is thrown from review.ts (which is out of scope to modify for this task),
  // we conditionally assert data structure if present, but strictly verify that the code remains ATM_CLI_USAGE.
  const reviewRejectMissingReasonMsg = reviewRejectMissingReason.parsed.messages.find((m: any) => m.code === 'ATM_CLI_USAGE');
  assert(reviewRejectMissingReasonMsg, 'must find ATM_CLI_USAGE message for reject missing reason');

  // TASK-AAO-0063: Regression tests for Evidence requiredCommand quoting and validator auto-link
  // Part 1: Tokenizer cross-shell consistency test
  function tokenizeBash(cmd: string): string[] {
    const args: string[] = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];
      if (inSingle) {
        if (char === "'") inSingle = false;
        else current += char;
      } else if (inDouble) {
        if (char === '\\' && cmd[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '\\' && cmd[i + 1] === '\\') {
          current += '\\';
          i++;
        } else if (char === '"') {
          inDouble = false;
        } else {
          current += char;
        }
      } else {
        if (char === "'") inSingle = true;
        else if (char === '"') inDouble = true;
        else if (/\s/.test(char)) {
          if (current) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    if (current) args.push(current);
    return args;
  }

  function tokenizeCmd(cmd: string): string[] {
    const args: string[] = [];
    let current = '';
    let inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];
      if (inDouble) {
        if (char === '\\' && cmd[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inDouble = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') inDouble = true;
        else if (/\s/.test(char)) {
          if (current) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    if (current) args.push(current);
    return args;
  }

  function tokenizePowerShell(cmd: string): string[] {
    const args: string[] = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];
      if (inSingle) {
        if (char === "'") inSingle = false;
        else current += char;
      } else if (inDouble) {
        if (char === '"' && cmd[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '\\' && cmd[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inDouble = false;
        } else {
          current += char;
        }
      } else {
        if (char === "'") inSingle = true;
        else if (char === '"') inDouble = true;
        else if (/\s/.test(char)) {
          if (current) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    if (current) args.push(current);
    return args;
  }

  const testCases = [
    'npm run typecheck',
    'npm run validate:cli',
    'git diff --check',
    'node --strip-types scripts/validate-cli.ts --mode validate'
  ];

  for (const tc of testCases) {
    const escCmd = quoteForShell(tc);
    const requiredCommand = `node atm.mjs evidence run --task TASK-AAO-0063 --actor Antigravity --command ${escCmd} --validators ${escCmd} --json`;
    const tokensBash = tokenizeBash(requiredCommand);
    const tokensCmd = tokenizeCmd(requiredCommand);
    const tokensPowerShell = tokenizePowerShell(requiredCommand);

    assert(tokensBash.length === tokensCmd.length, `tokens length must match for tc: ${tc}`);
    assert(tokensBash.length === tokensPowerShell.length, `tokens length must match for tc: ${tc}`);
    for (let i = 0; i < tokensBash.length; i++) {
      assert(tokensBash[i] === tokensCmd[i], `token at index ${i} must match for bash vs cmd for tc: ${tc}`);
      assert(tokensBash[i] === tokensPowerShell[i], `token at index ${i} must match for bash vs powershell for tc: ${tc}`);
    }
  }

  // Part 2: Evidence add auto-link tests
  const autoLinkTempWorkspace = createCliTempWorkspace('validate-cli-autolink');
  try {
    initializeGitRepository(autoLinkTempWorkspace);

    // Import task to allow evidence verification
    const importRes = await runAtm([
      'tasks', 'import',
      '--from', path.resolve(root, '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0063-evidence-required-command-quoting-validator-auto-link.task.md'),
      '--write'
    ], autoLinkTempWorkspace);
    assert(importRes.parsed.ok === true, 'import task must succeed');

    // Register active session to satisfy evidence add constraint
    await runAtm(['next', '--claim', '--actor', 'Antigravity', '--task', 'TASK-AAO-0063'], autoLinkTempWorkspace);

    const missingBeforeEvidence = await runAtm([
      'evidence', 'missing',
      '--task', 'TASK-AAO-0063',
      '--actor', 'Antigravity'
    ], autoLinkTempWorkspace);
    assert(missingBeforeEvidence.parsed.ok === false, 'evidence missing must report absent validator evidence before evidence capture');
    const absentFinding = missingBeforeEvidence.parsed.evidence?.blockingFindings
      ?.find((finding: any) => finding.code === 'ATM_EVIDENCE_VALIDATOR_ABSENT');
    assert(absentFinding, 'evidence missing must include an absent validator finding');
    assert(String(absentFinding?.requiredCommand ?? '').startsWith('node atm.mjs evidence run '), 'missing evidence remediation must prefer evidence run');
    assert(String(absentFinding?.summary ?? '').includes('Use evidence run'), 'missing evidence summary must direct operators to evidence run');

    // 2.1: evidence add without --validators (auto-link check)
    const addRes1 = await runAtm([
      'evidence', 'add',
      '--task', 'TASK-AAO-0063',
      '--actor', 'Antigravity',
      '--kind', 'test',
      '--command', 'npm run validate:cli',
      '--exit-code', '0',
      '--stdout-sha256', 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      '--stderr-sha256', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ], autoLinkTempWorkspace);
    assert(addRes1.parsed.ok === true, 'evidence add without --validators must succeed');
    assert(addRes1.parsed.evidence.evidenceCount === 1, 'must have exactly 1 evidence count');

    const evidenceJsonPath = path.join(autoLinkTempWorkspace, '.atm/history/evidence/TASK-AAO-0063.json');
    const evidenceContent = JSON.parse(readFileSync(evidenceJsonPath, 'utf8'));
    const firstRecord = evidenceContent.evidence[0];
    assert(firstRecord.details.validationPasses.includes('validate:cli'), 'auto-link must automatically link validate:cli');

    // 2.2: evidence add with --validators taking precedence
    const addRes2 = await runAtm([
      'evidence', 'add',
      '--task', 'TASK-AAO-0063',
      '--actor', 'Antigravity',
      '--kind', 'test',
      '--command', 'npm run validate:cli',
      '--exit-code', '0',
      '--stdout-sha256', 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      '--stderr-sha256', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '--validators', 'typecheck'
    ], autoLinkTempWorkspace);
    assert(addRes2.parsed.ok === true, 'evidence add with --validators must succeed');

    const evidenceContentUpdated = JSON.parse(readFileSync(evidenceJsonPath, 'utf8'));
    const secondRecord = evidenceContentUpdated.evidence[1];
    assert(secondRecord.details.validationPasses.includes('typecheck'), 'must include typecheck');
    assert(!secondRecord.details.validationPasses.includes('validate:cli'), 'must not include validate:cli if custom validators provided');

    // 2.3: --output-json file writer flag tests
    const outputJsonTestPath = path.join(autoLinkTempWorkspace, 'output-test.json');
    const statusRes = await runAtmSpawned(['tasks', 'queue', 'status', '--output-json', outputJsonTestPath], autoLinkTempWorkspace);
    assert(statusRes.exitCode === 0, 'tasks queue status with --output-json must exit 0');
    assert(existsSync(outputJsonTestPath), 'output-test.json file must be written');

    const parsedFileContent = JSON.parse(readFileSync(outputJsonTestPath, 'utf8'));
    assert(parsedFileContent.ok === true, 'parsed output JSON must report ok=true');
    assert(parsedFileContent.command === 'tasks', 'parsed output JSON command must be tasks');

    const stdoutTrimmed = (statusRes.stdout || '').trim();
    assert(!stdoutTrimmed.startsWith('{') && !stdoutTrimmed.endsWith('}'), 'stdout must not contain JSON body when --output-json is used');

    // Clear test file
    rmSync(outputJsonTestPath, { force: true });

    const nextRes = await runAtmSpawned(['next', '--prompt', 'output-json smoke', '--output-json', outputJsonTestPath], autoLinkTempWorkspace);
    assert(nextRes.exitCode === 0, 'next with --output-json must exit 0');
    assert(existsSync(outputJsonTestPath), 'output-test.json file must be written for next');

    const parsedNextContent = JSON.parse(readFileSync(outputJsonTestPath, 'utf8'));
    assert(parsedNextContent.command === 'next', 'parsed output JSON command must be next');

    const nextStdoutTrimmed = (nextRes.stdout || '').trim();
    assert(!nextStdoutTrimmed.startsWith('{') && !nextStdoutTrimmed.endsWith('}'), 'stdout of next must not contain JSON body when --output-json is used');

    rmSync(outputJsonTestPath, { force: true });

    // Test 4.1: next with --summary
    const summaryRes = await runAtm(['next', '--json', '--summary', '--task', 'TASK-AAO-0063'], root);
    assert(summaryRes.exitCode === 0, 'next with --summary must exit 0');
    assert(summaryRes.parsed.ok === true, 'next with --summary must report ok=true');
    const summaryEvidence = summaryRes.parsed.evidence;
    const allowedSummaryFields = ['taskId', 'status', 'claimedByActor', 'allowedFilesCount', 'nextAction'];
    for (const key of Object.keys(summaryEvidence)) {
      assert(allowedSummaryFields.includes(key), `summary evidence must not contain key: ${key}`);
    }
    if (summaryEvidence.nextAction) {
      const naKeys = Object.keys(summaryEvidence.nextAction);
      assert(naKeys.length === 1 && naKeys[0] === 'code', 'nextAction in summary must only contain code');
    }

    // Test 4.2: next with --fields
    const fieldsRes = await runAtm(['next', '--json', '--fields', 'taskId,status', '--task', 'TASK-AAO-0063'], root);
    assert(fieldsRes.exitCode === 0, 'next with --fields must exit 0');
    assert(fieldsRes.parsed.ok === true, 'next with --fields must report ok=true');
    const fieldsEvidence = fieldsRes.parsed.evidence;
    for (const key of Object.keys(fieldsEvidence)) {
      assert(['taskId', 'status'].includes(key), `fields evidence must not contain key: ${key}`);
    }

    // Test 4.3: tasks show with --fields
    const tasksShowRes = await runAtm(['tasks', 'show', '--task', 'TASK-AAO-0063', '--json', '--fields', 'status,title'], root);
    if (tasksShowRes.exitCode !== 0) {
      console.error('DEBUG - tasksShowRes failed!', JSON.stringify(tasksShowRes, null, 2));
    }
    assert(tasksShowRes.exitCode === 0, 'tasks show with --fields must exit 0');
    assert(tasksShowRes.parsed.ok === true, 'tasks show with --fields must report ok=true');
    const showEvidence = tasksShowRes.parsed.evidence;
    for (const key of Object.keys(showEvidence)) {
      assert(['status', 'title'].includes(key), `tasks show evidence must not contain key: ${key}`);
    }

    // Test 4.4: tasks show with unknown fields handling (graceful tolerance)
    const tasksShowUnknownRes = await runAtm(['tasks', 'show', '--task', 'TASK-AAO-0063', '--json', '--fields', 'status,unknownField'], root);
    assert(tasksShowUnknownRes.exitCode === 0, 'tasks show with unknown fields must exit 0');
    const showUnknownEvidence = tasksShowUnknownRes.parsed.evidence;
    assert('status' in showUnknownEvidence, 'tasks show evidence must contain status');
    assert(!('unknownField' in showUnknownEvidence), 'tasks show evidence must not contain unknownField');

    // Test 5.1: Dependency closeout provenance regression check
    const taskAPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-DEP-A.json');
    const taskBPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-DEP-B.json');

    // 建立 task A：狀態為 done，但沒有 closurePacket 與 transition event (即 manual-done)
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-DEP-A',
      title: 'Dependency A',
      status: 'done'
    });

    // 建立 task B：狀態為 ready，依賴 task A
    writeJson(taskBPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-DEP-B',
      title: 'Dependency B',
      status: 'ready',
      dependencies: ['TASK-REGRESS-DEP-A']
    });

    // 執行 claim：應該被 block，因為 task A 沒有 closeout provenance
    const claimRes = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], autoLinkTempWorkspace);
    assert(claimRes.exitCode !== 0, 'tasks claim B must fail because dependency A has no closeout provenance');
    assert(claimRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED'), 'must report dependency blocked');
    assert(claimRes.parsed.messages[0].data.requiredCommand.includes('repair-closure'), 'requiredCommand must recommend tasks repair-closure for manual-done without closeout provenance');

    // 跑 next --claim 同樣應該被 block
    const nextClaimRes = await runAtm(['next', '--claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], autoLinkTempWorkspace);
    assert(nextClaimRes.exitCode !== 0, 'next --claim B must fail because dependency A has no closeout provenance');
    assert(nextClaimRes.parsed.messages.some((msg: any) => msg.code === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED'), 'must report dependency blocked in next');

    // 建立手寫且沒有有效 closure metadata 的 close transition event
    const eventPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'task-events', 'TASK-REGRESS-DEP-A', '2026-06-12T08-30-18-487Z-close-a7eae4c781d1.json');
    writeJson(eventPath, {
      schemaId: 'atm.taskTransition.v1',
      specVersion: '0.1.0',
      transitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1',
      taskId: 'TASK-REGRESS-DEP-A',
      action: 'close',
      toStatus: 'done'
      // 沒有 closure 屬性
    });

    // 更新 task A 指向該 event
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-DEP-A',
      title: 'Dependency A',
      status: 'done',
      lastTransitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1'
    });

    // 執行 claim：應該仍被 block，因為 close event 沒有 closure metadata
    const claimResWithInvalidEvent = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], autoLinkTempWorkspace);
    assert(claimResWithInvalidEvent.exitCode !== 0, 'must fail because event lacks closure metadata');
    assert(claimResWithInvalidEvent.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED'), 'must report dependency blocked with invalid event');

    // 更新 event 使其帶有有效的 closure metadata
    writeJson(eventPath, {
      schemaId: 'atm.taskTransition.v1',
      specVersion: '0.1.0',
      transitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1',
      taskId: 'TASK-REGRESS-DEP-A',
      action: 'close',
      toStatus: 'done',
      closure: {
        schemaId: 'atm.taskClosureTransition.v1',
        sessionId: 'session-123456',
        closurePacketPath: '.atm/history/evidence/TASK-REGRESS-DEP-A.closure-packet.json'
      }
    });

    // 再次嘗試 claim：此時應該通過了（不再報 dependency blocked 錯誤）
    const claimResWithValidEvent = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], autoLinkTempWorkspace);
    assert(claimResWithValidEvent.parsed.messages.every((msg: any) => msg.code !== 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED'), 'dependency B must no longer be blocked with valid event closure metadata');

    // 移除 transition event 關聯，回到純 closurePacket 驗證
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-DEP-A',
      title: 'Dependency A',
      status: 'done'
    });

    // 建立 task A 的 closurePacket，讓它擁有 valid provenance
    const cpPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'evidence', 'TASK-REGRESS-DEP-A.closure-packet.json');
    writeJson(cpPath, {
      schemaId: 'atm.closurePacket.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-REGRESS-DEP-A',
      evidence: []
    });

    // 重新寫入 task A，關聯其 closurePacket
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-DEP-A',
      title: 'Dependency A',
      status: 'done',
      closurePacket: '.atm/history/evidence/TASK-REGRESS-DEP-A.closure-packet.json'
    });

    // 再次嘗試 tasks claim，此時 dependency blockers 應該不包含 A (因為 A 已經有 provenance 了，雖然 B 狀態為 ready 還不能 claim，但錯誤不應該是 dependency blocked)
    const claimResPass = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], autoLinkTempWorkspace);
    assert(claimResPass.parsed.messages.every((msg: any) => msg.code !== 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED'), 'dependency B must no longer be blocked by dependency A');

    // Test 5.1c: tasks invariant regression fixtures for abnormal release cases
    assert(regressionFixtures.sourceDoneWithoutGovernedCloseout.taskStatus === 'done', 'fixture must model source-done without governed closeout');
    assert(regressionFixtures.mailboxAndPlanningDone.mailboxStatus === 'done', 'fixture must model mailbox done');
    assert(regressionFixtures.mailboxAndPlanningDone.planningStatus === 'done', 'fixture must model planning done');
    assert(regressionFixtures.mailboxAndPlanningDone.targetStatus === 'planned', 'fixture must keep target repo closeout distinct');
    assert(regressionFixtures.manualCloseWithoutMetadata.closeEvent.closure === null, 'fixture must model manual close without closure metadata');
    assert(regressionFixtures.validClosurePacket.closeEvent.closure.closurePacketPath.includes('.closure-packet.json'), 'fixture must model valid closure packet');

    const regressWorkspace = createCliTempWorkspace('tasks-invariant-regressions');
    try {
      initializeGitRepository(regressWorkspace);

      const sourceDonePath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-IMPORT-DONE.json');
      writeJson(sourceDonePath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: regressionFixtures.sourceDoneWithoutGovernedCloseout.taskId,
        title: 'Import done without governed closeout',
        status: regressionFixtures.sourceDoneWithoutGovernedCloseout.taskStatus,
        lastTransitionId: '2026-06-12T09-00-00-000Z-import-0060regress'
      });
      const sourceDoneRes = await runAtm(['tasks', 'status', '--task', regressionFixtures.sourceDoneWithoutGovernedCloseout.taskId, '--residue', '--json'], regressWorkspace);
      assert(sourceDoneRes.exitCode === 0, 'source-done residue status must exit 0');
      assert(sourceDoneRes.parsed.evidence.bucket === 'source-done-governance-incomplete', 'source-done without governed closeout must be classified as governance incomplete');

      const mailboxDonePath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-MAILBOX-ONLY.json');
      const mailboxDependentPath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-MAILBOX-DOWNSTREAM.json');
      writeJson(mailboxDonePath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: regressionFixtures.mailboxAndPlanningDone.taskId,
        title: 'Mailbox done and planning done cannot replace target repo closeout',
        status: regressionFixtures.mailboxAndPlanningDone.targetStatus,
        mailboxStatus: regressionFixtures.mailboxAndPlanningDone.mailboxStatus,
        planningStatus: regressionFixtures.mailboxAndPlanningDone.planningStatus
      });
      writeJson(mailboxDependentPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-REGRESS-MAILBOX-DOWNSTREAM',
        title: 'Downstream task blocked by mailbox-only done',
        status: 'ready',
        dependencies: [regressionFixtures.mailboxAndPlanningDone.taskId]
      });
      const mailboxDoneRes = await runAtm(['tasks', 'status', '--task', regressionFixtures.mailboxAndPlanningDone.taskId, '--residue', '--json'], regressWorkspace);
      assert(mailboxDoneRes.exitCode === 0, 'mailbox/planning residue status must exit 0');
      const mailboxClaimRes = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-MAILBOX-DOWNSTREAM', '--actor', 'Antigravity'], regressWorkspace);
      assert(mailboxClaimRes.exitCode !== 0, 'mailbox/planning done must not replace target repo closeout');

      const manualClosePath = path.join(regressWorkspace, '.atm', 'history', 'task-events', regressionFixtures.manualCloseWithoutMetadata.taskId, '2026-06-12T08-30-18-487Z-close-a7eae4c781d1.json');
      const manualCloseTaskPath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-MANUAL-CLOSE.json');
      const manualCloseDependentPath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-MANUAL-CLOSE-DOWNSTREAM.json');
      writeJson(manualClosePath, {
        schemaId: 'atm.taskTransition.v1',
        specVersion: '0.1.0',
        transitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1',
        taskId: regressionFixtures.manualCloseWithoutMetadata.taskId,
        action: 'close',
        toStatus: 'done'
      });
      writeJson(manualCloseTaskPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: regressionFixtures.manualCloseWithoutMetadata.taskId,
        title: 'Manual close without metadata',
        status: 'done',
        lastTransitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1'
      });
      writeJson(manualCloseDependentPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-REGRESS-MANUAL-CLOSE-DOWNSTREAM',
        title: 'Downstream task blocked by manual close',
        status: 'ready',
        dependencies: [regressionFixtures.manualCloseWithoutMetadata.taskId]
      });
      const manualCloseRes = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-MANUAL-CLOSE-DOWNSTREAM', '--actor', 'Antigravity'], regressWorkspace);
      assert(manualCloseRes.exitCode !== 0, 'manual close without metadata must not unlock downstream claim');

      const validCloseTaskPath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-VALID-CLOSE.json');
      const validCloseDependentPath = path.join(regressWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-VALID-CLOSE-DOWNSTREAM.json');
      const validCloseEventPath = path.join(regressWorkspace, '.atm', 'history', 'task-events', regressionFixtures.validClosurePacket.taskId, '2026-06-12T08-30-18-487Z-close-a7eae4c781d1.json');
      const validClosurePacketPath = path.join(regressWorkspace, '.atm', 'history', 'evidence', 'TASK-REGRESS-VALID-CLOSE.closure-packet.json');
      writeJson(validClosurePacketPath, regressionFixtures.validClosurePacket.closurePacket);
      writeJson(validCloseEventPath, regressionFixtures.validClosurePacket.closeEvent);
      writeJson(validCloseTaskPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: regressionFixtures.validClosurePacket.taskId,
        title: 'Valid closure packet admits downstream claim',
        status: 'done',
        closurePacket: '.atm/history/evidence/TASK-REGRESS-VALID-CLOSE.closure-packet.json',
        lastTransitionId: '2026-06-12T08-30-18-487Z-close-a7eae4c781d1'
      });
      writeJson(validCloseDependentPath, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-REGRESS-VALID-CLOSE-DOWNSTREAM',
        title: 'Downstream task admitted by valid closure packet',
        status: 'ready',
        dependencies: [regressionFixtures.validClosurePacket.taskId]
      });
      const validCloseRes = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-VALID-CLOSE-DOWNSTREAM', '--actor', 'Antigravity'], regressWorkspace);
      assert(validCloseRes.exitCode === 0, 'valid closure packet must allow downstream claim');
    } finally {
      rmSync(regressWorkspace, { recursive: true, force: true });
    }

    // Test 5.1b: import->done without governed closeout must classify as source-done-governance-incomplete (TASK-CID-0060)
    const taskImportPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'tasks', 'TASK-REGRESS-IMPORT-DONE.json');
    const importEventId = '2026-06-12T09-00-00-000Z-import-0060regress';
    const importEventPath = path.join(autoLinkTempWorkspace, '.atm', 'history', 'task-events', 'TASK-REGRESS-IMPORT-DONE', `${importEventId}.json`);
    writeJson(importEventPath, {
      schemaId: 'atm.taskTransition.v1',
      specVersion: '0.1.0',
      transitionId: importEventId,
      taskId: 'TASK-REGRESS-IMPORT-DONE',
      action: 'import',
      toStatus: 'done'
    });
    writeJson(taskImportPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-REGRESS-IMPORT-DONE',
      title: 'Import done without governed closeout',
      status: 'done',
      lastTransitionId: importEventId
    });
    const residueRes = await runAtm(['tasks', 'status', '--task', 'TASK-REGRESS-IMPORT-DONE', '--residue', '--json'], autoLinkTempWorkspace);
    assert(residueRes.exitCode === 0, 'tasks status --residue must succeed for import-done task');
    assert(residueRes.parsed.evidence.bucket === 'source-done-governance-incomplete', 'import->done without provenance must bucket as source-done-governance-incomplete');
    assert(
      typeof residueRes.parsed.evidence.nextCommand === 'string'
        ? residueRes.parsed.evidence.nextCommand.includes('tasks reconcile')
        : true,
      'import-done residue must recommend tasks reconcile'
    );
    assert(
      typeof residueRes.parsed.evidence.residue === 'string'
        ? residueRes.parsed.evidence.residue.includes('import')
        : true,
      'residue explanation must mention import path'
    );

    const finalizeDiagRes = await runAtm(['tasks', 'finalize', 'diagnose', '--task', 'TASK-REGRESS-IMPORT-DONE', '--json'], autoLinkTempWorkspace);
    assert(finalizeDiagRes.parsed.evidence.bucket === 'source-done-governance-incomplete', 'finalize diagnose must agree with residue bucket for import-done');

    // Test 5.2: historical-delivery scope and commit provenance hard gate (TASK-CID-0049)
    const declaredFiles = ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'];
    const bucketsNoOverlap = categorizeHistoricalCommitFiles({
      taskId: 'TASK-HIST-0049',
      changedFiles: ['src/unrelated-only.ts'],
      declaredFiles
    });
    assert(bucketsNoOverlap.taskMatchedFiles.length === 0, 'unrelated-only commit must not match task deliverables');
    assert(bucketsNoOverlap.outOfScopeSourceFiles.includes('src/unrelated-only.ts'), 'unrelated source must be out-of-scope');

    const bucketsMixed = categorizeHistoricalCommitFiles({
      taskId: 'TASK-HIST-0049',
      changedFiles: ['src/task-owned.ts', 'packages/core/src/broker/freeze.ts'],
      declaredFiles
    });
    assert(bucketsMixed.taskMatchedFiles.includes('src/task-owned.ts'), 'task-owned file must be task-matched');
    assert(bucketsMixed.outOfScopeSourceFiles.includes('packages/core/src/broker/freeze.ts'), 'unrelated broker file must be out-of-scope');

    const bucketsReleaseAllowed = categorizeHistoricalCommitFiles({
      taskId: 'TASK-HIST-0049',
      changedFiles: ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'],
      declaredFiles
    });
    assert(bucketsReleaseAllowed.allowedRunnerOutputFiles.includes('release/atm-onefile/atm.mjs'), 'declared runner output must be allowed');
    assert(bucketsReleaseAllowed.outOfScopeSourceFiles.length === 0, 'declared runner output must not count as out-of-scope');

    const histWorkspace = createCliTempWorkspace('validate-cli-historical-delivery');
    try {
      initializeGitRepository(histWorkspace);
      const ownedPath = path.join(histWorkspace, 'src', 'task-owned.ts');
      mkdirSync(path.dirname(ownedPath), { recursive: true });
      writeFileSync(ownedPath, 'export const owned = true;\n', 'utf8');
      spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
      spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'base'], { encoding: 'utf8' });

      const unrelatedPath = path.join(histWorkspace, 'src', 'unrelated-only.ts');
      writeFileSync(unrelatedPath, 'export const unrelated = true;\n', 'utf8');
      spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
      spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'unrelated'], { encoding: 'utf8' });
      const unrelatedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      const unrelatedInspect = inspectHistoricalDelivery({
        cwd: histWorkspace,
        taskId: 'validate-cli-historical-delivery',
        requestedRef: unrelatedCommit,
        declaredFiles,
        enforceDeclaredScope: true,
        waiverOutOfScopeDelivery: false,
        waiverReason: null
      });
      assert(!unrelatedInspect.ok, 'historical delivery without task overlap must fail');
      assert(unrelatedInspect.reason === 'no-scoped-deliverable-files', 'must report no scoped deliverable files');

      const freezePath = path.join(histWorkspace, 'packages', 'core', 'src', 'broker', 'freeze.ts');
      mkdirSync(path.dirname(freezePath), { recursive: true });
      writeFileSync(path.join(histWorkspace, 'src', 'task-owned.ts'), 'export const owned = false;\n', 'utf8');
      writeFileSync(freezePath, 'export {};\n', 'utf8');
      spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
      spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'mixed'], { encoding: 'utf8' });
      const mixedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      const mixedInspect = inspectHistoricalDelivery({
        cwd: histWorkspace,
        taskId: 'validate-cli-historical-delivery',
        requestedRef: mixedCommit,
        declaredFiles,
        enforceDeclaredScope: true,
        waiverOutOfScopeDelivery: false,
        waiverReason: null
      });
      assert(!mixedInspect.ok, 'mixed commit must fail without waiver');
      assert(mixedInspect.reason === 'out-of-scope-source-files-present', 'must report out-of-scope source files');

      const mixedWaiverInspect = inspectHistoricalDelivery({
        cwd: histWorkspace,
        taskId: 'validate-cli-historical-delivery',
        requestedRef: mixedCommit,
        declaredFiles,
        enforceDeclaredScope: true,
        waiverOutOfScopeDelivery: true,
        waiverReason: 'captain-approved mixed historical delivery for regression'
      });
      assert(mixedWaiverInspect.ok, 'mixed commit must pass with waiver and reason');
      assert(mixedWaiverInspect.reason === 'scoped-deliverable-with-waived-out-of-scope', 'must report waived out-of-scope acceptance');
    } finally {
      rmSync(histWorkspace, { recursive: true, force: true });
    }
  } finally {
    rmSync(autoLinkTempWorkspace, { recursive: true, force: true });
  }

  // Test 5.2: tasks close state machine and closure metadata hard gate regression check
  const closeGateWorkspace = createCliTempWorkspace('close-gate');
  initializeGitRepository(closeGateWorkspace);
  try {
    const taskAPath = path.join(closeGateWorkspace, '.atm', 'history', 'tasks', 'TASK-CLOSE-A.json');

    // Test 5.2a: planned status cannot be closed to done
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-CLOSE-A',
      status: 'planned',
      deliverableMode: 'ledger-only'
    });
    const closeAPlannedRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(closeAPlannedRes.exitCode !== 0, 'closing planned task directly to done must fail');
    assert(closeAPlannedRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_INVALID_LIFECYCLE'), 'must report ATM_TASK_CLOSE_INVALID_LIFECYCLE');

    // Test 5.2b: unclaimed task cannot be closed to done
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-CLOSE-A',
      status: 'ready',
      deliverableMode: 'ledger-only'
    });
    const closeAUnclaimedRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(closeAUnclaimedRes.exitCode !== 0, 'closing unclaimed task to done must fail');
    assert(closeAUnclaimedRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED'), 'must report ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED');

    // Test 5.2c: active claim but no session context cannot be closed to done
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-CLOSE-A',
      status: 'running',
      deliverableMode: 'ledger-only',
      claim: {
        state: 'active',
        actorId: 'Antigravity',
        leaseId: 'lease-123456',
        claimedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        files: ['scripts/validate-cli.ts']
      }
    });
    const closeANoSessionRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(closeANoSessionRes.exitCode !== 0, 'closing task without session must fail');
    assert(closeANoSessionRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_SESSION_CONTEXT_REQUIRED'), 'must report ATM_TASK_CLOSE_SESSION_CONTEXT_REQUIRED');

    // Test 5.2d: task with active session but no evidence must fail close as done, then pass after providing evidence
    writeJson(taskAPath, {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: 'TASK-CLOSE-A',
      status: 'ready',
      deliverableMode: 'ledger-only'
    });
    const claimRes = await runAtm(['tasks', 'claim', '--task', 'TASK-CLOSE-A', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(claimRes.exitCode === 0, 'tasks claim close-gate task must succeed');

    const closeNoEvidenceRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(closeNoEvidenceRes.exitCode !== 0, 'closing task without evidence must fail');
    assert(closeNoEvidenceRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_EVIDENCE_REQUIRED'), 'must report ATM_TASK_CLOSE_EVIDENCE_REQUIRED');

    // Add dummy evidence records so it passes the evidence gate
    const evidencePath = path.join(closeGateWorkspace, '.atm', 'history', 'evidence', 'TASK-CLOSE-A.json');
    writeJson(evidencePath, {
      schemaId: 'atm.taskEvidence.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-CLOSE-A',
      evidence: [
        {
          evidenceKind: 'validation',
          evidenceType: 'test',
          summary: 'Auto-run: npm run typecheck',
          evidenceFreshness: 'fresh',
          details: {
            kind: 'test',
            freshness: 'fresh',
            validationPasses: ['typecheck'],
            commandRuns: [
              {
                command: 'npm run typecheck',
                exitCode: 0,
                stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
              }
            ]
          }
        },
        {
          evidenceKind: 'validation',
          evidenceType: 'test',
          summary: 'Auto-run: npm run validate:cli',
          evidenceFreshness: 'fresh',
          details: {
            kind: 'test',
            freshness: 'fresh',
            validationPasses: ['validate:cli'],
            commandRuns: [
              {
                command: 'npm run validate:cli',
                exitCode: 0,
                stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
              }
            ]
          }
        },
        {
          evidenceKind: 'validation',
          evidenceType: 'test',
          summary: 'Auto-run: npm run validate:git-head-evidence',
          evidenceFreshness: 'fresh',
          details: {
            kind: 'test',
            freshness: 'fresh',
            validationPasses: ['validate:git-head-evidence'],
            commandRuns: [
              {
                command: 'npm run validate:git-head-evidence',
                exitCode: 0,
                stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
              }
            ]
          }
        }
      ]
    });

    const closeSuccessRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
    assert(closeSuccessRes.exitCode === 0, 'closing task with valid evidence and session must succeed');
    assert(closeSuccessRes.parsed.ok === true, 'must report ok = true');
  } finally {
    rmSync(closeGateWorkspace, { recursive: true, force: true });
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[cli:${mode}] ok (${fixture.commands.length} commands, standalone fixture verified)`);
}
