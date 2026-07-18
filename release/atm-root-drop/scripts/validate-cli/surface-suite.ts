import type { ValidateCliContext } from './context.ts';
import {
  assert,
  assertMessageCode,
  assertReadable,
  createCliTempWorkspace,
  existsSync,
  initializeGitRepository,
  path,
  readFileSync,
  readJson,
  resolveTaskScopedCommitBundle,
  root,
  runAtm,
  runAtmSpawned,
  safeRmSync,
  spawnSync,
  writeJson
} from './context.ts';
import { runFocusedRegressions } from './focused-regressions.ts';

export async function runSurfaceSuite(ctx: ValidateCliContext) {
  assert(existsSync(ctx.aao0063TaskFixturePath), 'missing TASK-AAO-0063 task fixture path for validate-cli regression tests');
  assertRequiredFixtureFiles(ctx);
  assertSourceSurfaceContracts(ctx);

  ctx.logProgress('bootstrap and command registry smoke');
  const packageManifest = readJson('package.json');
  if (ctx.childProcessSmokeEnabled) {
    const spawnedVersion = await runAtmSpawned(['--version'], root);
    assert(spawnedVersion.exitCode === 0, 'spawned --version smoke test must exit 0');
    assertReadable(spawnedVersion, 'spawned --version');
    assert(spawnedVersion.parsed.ok === true, 'spawned --version smoke test must report ok=true');
  }

  const version = await runAtm(['--version'], root);
  assert(version.exitCode === 0, '--version must exit 0');
  assertReadable(version, '--version');
  assert(version.parsed.evidence?.frameworkVersion === packageManifest.version, '--version must report package.json version');
  assert(version.parsed.evidence?.runnerMode?.schemaId === 'atm.runnerMode.v1', '--version must include runner mode evidence');
  assertMessageCode(version, 'ATM_CLI_VERSION');

  await assertHelpSurfaces(ctx);
  ctx.logProgress('focused regression subprocess tests');
  await runFocusedRegressions();
  assertProtectedForeignStagedOwnership();
  await assertLifecycleHelpSurfaces();
}

function assertRequiredFixtureFiles(ctx: ValidateCliContext) {
  for (const relativePath of [
    ctx.fixture.entrypoint,
    'packages/cli/src/commands/atm-chart.ts',
    'packages/cli/src/commands/bootstrap-entry.ts',
    'packages/cli/src/commands/cache.ts',
    'packages/cli/src/commands/candidates.ts',
    'packages/cli/src/commands/create.ts',
    'packages/cli/src/commands/doctor.ts',
    'packages/cli/src/commands/emergency.ts',
    'packages/cli/src/commands/framework-development.ts',
    'packages/cli/src/commands/internal-release.ts',
    'packages/cli/src/commands/next.ts',
    'packages/cli/src/commands/tasks.ts',
    'packages/cli/src/commands/taskflow.ts',
    'packages/cli/src/commands/welcome.ts',
    'templates/enforcement/pre-commit.sh',
    'templates/enforcement/ci-atm-onboarding.yml',
    'fixtures/upgrade/hash-diff-report.json',
    'fixtures/upgrade/quality-comparison-pass.json',
    'fixtures/upgrade/quality-comparison-blocked.json',
    'fixtures/upgrade/proposal-pass.json',
    'fixtures/upgrade/proposal-blocked.json',
    'fixtures/evolution/evidence-patterns/no-signal.json',
    'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json',
    'fixtures/registry/v1-with-versions.json',
    'tests/police-fixtures/positive/non-regression-report.json',
    'tests/police-fixtures/positive/registry-candidate-report.json',
    'tests/schema-fixtures/positive/minimal-execution-evidence.json',
    ctx.fixture.validAtomicSpec,
    'atomic-registry.json',
    'fixtures/verify/guard-evidence-pass.json',
    'fixtures/verify/guard-evidence-missing-justification.json'
  ]) {
    assert(existsSync(path.join(root, relativePath)), `missing CLI fixture dependency: ${relativePath}`);
  }
}

function assertSourceSurfaceContracts(ctx: ValidateCliContext) {
  const dependencyGatesSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/dependency-gates.ts'), 'utf8');
  assert(dependencyGatesSource.includes("from './dependency-gate.ts'"), 'dependency-gates facade must preserve dependency-gate.ts as the implementation owner');
  const surfaceInvariantsSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/surface-invariants.ts'), 'utf8');
  for (const symbol of ['resolveTaskflowCloseMode', 'resolveTaskflowCloseBackend', 'taskflowCloseEvidenceValidators', 'taskflowCloseGovernanceEvidenceValidator']) {
    assert(surfaceInvariantsSource.includes(symbol), `surface-invariants missing required closeout strategy export: ${symbol}`);
  }
  const tasksCommandSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks.ts'), 'utf8');
  assert(tasksCommandSource.includes("from './tasks/dependency-gates.ts'"), 'tasks.ts must consume dependency admission through the plural dependency-gates facade');
  const cliIndex = readFileSync(path.join(root, 'packages/cli/src/index.ts'), 'utf8');
  for (const commandName of ctx.fixture.commands) {
    assert(cliIndex.includes(`commandName: '${commandName}'`), `index.ts missing command descriptor: ${commandName}`);
  }
}

async function assertHelpSurfaces(ctx: ValidateCliContext) {
  ctx.logProgress('global and per-command help snapshots');
  const globalHelp = await runAtm(['--help'], root);
  assert(globalHelp.exitCode === 0, '--help must exit 0');
  assertReadable(globalHelp, '--help');
  const listedCommands = (Array.isArray(globalHelp.parsed.evidence?.commands) ? globalHelp.parsed.evidence.commands : [])
    .map((entry: any) => typeof entry === 'string' ? entry : entry.command)
    .filter(Boolean)
    .sort((left: any, right: any) => left.localeCompare(right));
  assert(JSON.stringify(ctx.runnerCommandNames) === JSON.stringify(ctx.allSpecCommandNames), 'runner registry and command spec registry must stay in sync');
  assert(JSON.stringify(listedCommands) === JSON.stringify(ctx.publicCommandNames), '--help command list must match public command specs');
  assert(JSON.stringify(listedCommands) === JSON.stringify([...ctx.helpCommandSnapshot.commands].sort((left, right) => left.localeCompare(right))), '--help command list must match snapshot fixture');

  for (const commandName of ctx.internalCommandNames) {
    assert(!listedCommands.includes(commandName), `${commandName} must stay hidden from the global help command list`);
    const commandHelp = await runAtm([commandName, '--help'], root);
    assert(commandHelp.exitCode === 0, `${commandName} --help must exit 0`);
    assertReadable(commandHelp, `${commandName} --help`);
  }
  for (const commandName of ctx.publicCommandNames) {
    const commandHelp = await runAtm([commandName, '--help'], root);
    assert(commandHelp.exitCode === 0, `${commandName} --help must exit 0`);
    assertReadable(commandHelp, `${commandName} --help`);
    const snapshotUsage = (ctx.perCommandHelpSnapshots as Record<string, any>)[commandName];
    if (snapshotUsage) {
      assert(JSON.stringify(commandHelp.parsed.evidence?.usage ?? null) === JSON.stringify(snapshotUsage), `${commandName} --help usage snapshot must match fixture`);
    }
  }
}

function assertProtectedForeignStagedOwnership() {
  const workspace = createCliTempWorkspace('protected-foreign-staged');
  try {
    initializeGitRepository(workspace);
    const foreignEvidencePath = path.join(workspace, '.atm', 'history', 'evidence', 'TASK-FOREIGN-0001.json');
    writeJson(foreignEvidencePath, { schemaId: 'atm.taskEvidence.v1', taskId: 'TASK-FOREIGN-0001', evidence: [] });
    spawnSync('git', ['-C', workspace, 'add', '.atm/history/evidence/TASK-FOREIGN-0001.json'], { encoding: 'utf8' });
    const report = resolveTaskScopedCommitBundle({
      cwd: workspace,
      taskId: 'TASK-LOCAL-0001',
      taskDocument: { workItemId: 'TASK-LOCAL-0001', scopePaths: ['src/local.ts'] },
      apply: true,
      autoStage: false,
      deferForeignStaged: true,
      message: 'test protected staged ownership',
      actorId: 'validator',
      trailers: []
    });
    assert(report.ok === false, 'protected foreign staged .atm/history files must block defer-foreign-staged');
    assert(report.blockedCode === 'ATM_GIT_COMMIT_PROTECTED_FOREIGN_STAGED_OWNERSHIP', 'protected foreign staged ownership must expose deterministic blocked code');
  } finally {
    safeRmSync(workspace);
  }
}

async function assertLifecycleHelpSurfaces() {
  const nextHelp = await runAtm(['next', '--help'], root);
  const nextUsageText = JSON.stringify(nextHelp.parsed.evidence?.usage ?? {});
  assert(nextUsageText.includes('prefers the explicit --task'), 'next --help must explain known task claim commands');
  const evidenceHelp = await runAtm(['evidence', '--help'], root);
  const evidenceUsageText = JSON.stringify(evidenceHelp.parsed.evidence?.usage ?? {});
  assert(evidenceUsageText.includes('evidence run --task ATM-GOV-0104'), 'evidence --help examples must put evidence run on the normal validator path');
  const emergencyHelp = await runAtm(['emergency', '--help'], root);
  assert(emergencyHelp.exitCode === 0, 'emergency --help must exit 0');
  assertReadable(emergencyHelp, 'emergency --help');
  const rescueHelp = await runAtm(['rescue', '--help'], root);
  assert(JSON.stringify(rescueHelp.parsed.evidence?.usage ?? {}).includes('closure-packet'), 'rescue --help CLI surface must list closure-packet');
}
