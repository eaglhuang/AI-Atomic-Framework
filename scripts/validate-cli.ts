import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDecisionSnapshotHash } from '../packages/plugin-human-review/src/index.ts';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');
const helpCommandSnapshot = readJson('tests/cli-fixtures/help-snapshots/command-list.json');
const perCommandHelpSnapshots = {
  explain: readJson('tests/cli-fixtures/help-snapshots/explain.json'),
  next: readJson('tests/cli-fixtures/help-snapshots/next.json'),
  orient: readJson('tests/cli-fixtures/help-snapshots/orient.json'),
  start: readJson('tests/cli-fixtures/help-snapshots/start.json'),
  guide: readJson('tests/cli-fixtures/help-snapshots/guide.json'),
  upgrade: readJson('tests/cli-fixtures/help-snapshots/upgrade.json')
};

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

function runAtm(args: any, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, fixture.entrypoint), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
    fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed
  };
}

function writeJson(filePath: any, value: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

for (const relativePath of [fixture.entrypoint, 'packages/cli/src/commands/atm-chart.ts', 'packages/cli/src/commands/bootstrap-entry.ts', 'packages/cli/src/commands/create.ts', 'packages/cli/src/commands/doctor.ts', 'packages/cli/src/commands/next.ts', 'packages/cli/src/commands/init.ts', 'packages/cli/src/commands/integration.ts', 'packages/cli/src/commands/rollback.ts', 'packages/cli/src/commands/review.ts', 'packages/cli/src/commands/self-host-alpha.ts', 'packages/cli/src/commands/spec.ts', 'packages/cli/src/commands/status.ts', 'packages/cli/src/commands/upgrade.ts', 'packages/cli/src/commands/test.ts', 'packages/cli/src/commands/validate.ts', 'packages/cli/src/commands/verify.ts', 'packages/cli/src/commands/welcome.ts', 'templates/enforcement/pre-commit.sh', 'templates/enforcement/ci-atm-onboarding.yml', 'fixtures/upgrade/hash-diff-report.json', 'fixtures/upgrade/quality-comparison-pass.json', 'fixtures/upgrade/quality-comparison-blocked.json', 'fixtures/upgrade/proposal-pass.json', 'fixtures/upgrade/proposal-blocked.json', 'fixtures/evolution/evidence-patterns/no-signal.json', 'fixtures/evolution/evidence-patterns/recurring-failure-candidate.json', 'fixtures/registry/v1-with-versions.json', 'tests/police-fixtures/positive/non-regression-report.json', 'tests/police-fixtures/positive/registry-candidate-report.json', 'tests/schema-fixtures/positive/minimal-execution-evidence.json', fixture.validAtomicSpec, 'atomic-registry.json', 'fixtures/verify/guard-evidence-pass.json', 'fixtures/verify/guard-evidence-missing-justification.json']) {
  assert(existsSync(path.join(root, relativePath)), `missing CLI fixture dependency: ${relativePath}`);
}

const cliIndex = readFileSync(path.join(root, 'packages/cli/src/index.ts'), 'utf8');
for (const commandName of fixture.commands) {
  assert(cliIndex.includes(`commandName: '${commandName}'`), `index.ts missing command descriptor: ${commandName}`);
}

const globalHelp = runAtm(['--help'], root);
assert(globalHelp.exitCode === 0, '--help must exit 0');
assertReadable(globalHelp, '--help');
assert(globalHelp.parsed.ok === true, '--help must report ok=true');
const listedCommands = (Array.isArray(globalHelp.parsed.evidence?.commands) ? globalHelp.parsed.evidence.commands : [])
  .map((entry: any) => typeof entry === 'string' ? entry : entry.command)
  .filter(Boolean)
  .sort((left: any, right: any) => left.localeCompare(right));
assert(JSON.stringify(listedCommands) === JSON.stringify([...helpCommandSnapshot.commands].sort((left, right) => left.localeCompare(right))), '--help command list must match snapshot fixture');

for (const commandName of helpCommandSnapshot.commands) {
  const commandHelp = runAtm([commandName, '--help'], root);
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

const tempRoot = createTempWorkspace('atm-cli-');
try {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });

  const missingStatus = runAtm(['status'], blankRepo);
  assert(missingStatus.exitCode === 1, 'status before init must exit 1');
  assertReadable(missingStatus, 'status');
  assert(missingStatus.parsed.ok === false, 'status before init must report ok=false');
  assertMessageCode(missingStatus, 'ATM_CONFIG_MISSING');

  const init = runAtm(['init'], blankRepo);
  assert(init.exitCode === 0, 'init must exit 0 in blank repo');
  assertReadable(init, 'init');
  assert(init.parsed.ok === true, 'init must report ok=true');
  assert(init.parsed.evidence.adapterMode === 'standalone', 'init must report standalone mode');
  assert(init.parsed.evidence.adapterImplemented === false, 'init must not require adapter implementation');
  assert(existsSync(path.join(blankRepo, fixture.configPath)), 'init must create config file');

  const createDryRun = runAtm(['create', '--cwd', blankRepo, '--bucket', 'fixture', '--title', 'CliCreateDryRun', '--description', 'CLI create dry-run fixture.', '--dry-run'], blankRepo);
  assert(createDryRun.exitCode === 0, 'create --dry-run must exit 0 in blank repo');
  assertReadable(createDryRun, 'create');
  assert(createDryRun.parsed.ok === true, 'create --dry-run must report ok=true');
  assert(createDryRun.parsed.evidence.dryRun === true, 'create --dry-run must report dryRun=true');
  assert(createDryRun.parsed.evidence.atomId === 'ATM-FIXTURE-0001', 'create --dry-run must allocate ATM-FIXTURE-0001 from blank repo');
  assertMessageCode(createDryRun, 'ATM_CREATE_DRY_RUN_OK');

  const initDryRun = runAtm(['init', '--adopt', '--dry-run'], blankRepo);
  assert(initDryRun.exitCode === 0, 'init --adopt --dry-run must exit 0');
  assertReadable(initDryRun, 'init');
  assert(initDryRun.parsed.ok === true, 'init --adopt --dry-run must report ok=true');
  assert(initDryRun.parsed.evidence.adoptedAt, 'init --adopt --dry-run must report adoptedAt');
  assert(initDryRun.parsed.evidence.dryRun === true, 'init --adopt --dry-run must report dryRun=true');

  const atmChartRepo = path.join(tempRoot, 'atm-chart-repo');
  mkdirSync(atmChartRepo, { recursive: true });
  const atmChartBootstrap = runAtm(['bootstrap', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartBootstrap.exitCode === 0, 'bootstrap must exit 0 before ATMChart render');

  const atmChartRender = runAtm(['atm-chart', 'render', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartRender.exitCode === 0, 'atm-chart render must exit 0 after bootstrap');
  assertReadable(atmChartRender, 'atm-chart');
  assert(atmChartRender.parsed.ok === true, 'atm-chart render must report ok=true');
  assert(atmChartRender.parsed.evidence.atmChartPath === '.atm/memory/atm-chart.md', 'atm-chart render must use the default memory path');
  assert(existsSync(path.join(atmChartRepo, '.atm/memory/atm-chart.md')), 'atm-chart render must write .atm/memory/atm-chart.md');
  assertMessageCode(atmChartRender, 'ATM_CHART_RENDERED');

  const atmChartVerify = runAtm(['atm-chart', 'verify', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartVerify.exitCode === 0, 'atm-chart verify must exit 0 immediately after render');
  assertReadable(atmChartVerify, 'atm-chart');
  assert(atmChartVerify.parsed.ok === true, 'atm-chart verify must report ok=true when fresh');
  assertMessageCode(atmChartVerify, 'ATM_CHART_VERIFY_OK');

  const agentPackList = runAtm(['agent-pack', 'list', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackList.exitCode === 0, 'agent-pack list must exit 0');
  assertReadable(agentPackList, 'agent-pack');
  assert(agentPackList.parsed.ok === true, 'agent-pack list must report ok=true');
  assert(Array.isArray(agentPackList.parsed.evidence.installedPacks), 'agent-pack list must report installedPacks array');

  const agentPackInstall = runAtm(['agent-pack', 'install', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackInstall.exitCode === 0, 'agent-pack install --id must exit 0 after bootstrap');
  assertReadable(agentPackInstall, 'agent-pack');
  assert(agentPackInstall.parsed.ok === true, 'agent-pack install --id must report ok=true');
  assert(agentPackInstall.parsed.evidence.manifestPath === '.atm/agent-pack/claude-code.manifest.json', 'agent-pack install must write the pack manifest path');
  assert(existsSync(path.join(atmChartRepo, '.atm/agent-pack/claude-code.manifest.json')), 'agent-pack install must write the pack manifest');
  assertMessageCode(agentPackInstall, 'ATM_AGENT_PACK_INSTALL');

  const agentPackVerifyFresh = runAtm(['agent-pack', 'verify-fresh', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackVerifyFresh.exitCode === 0, 'agent-pack verify-fresh must exit 0 immediately after install');
  assertReadable(agentPackVerifyFresh, 'agent-pack');
  assert(agentPackVerifyFresh.parsed.ok === true, 'agent-pack verify-fresh must report ok=true when fresh');
  assertMessageCode(agentPackVerifyFresh, 'ATM_AGENT_PACK_VERIFY_FRESH_OK');

  const welcomeDryRun = runAtm(['welcome', '--cwd', atmChartRepo, '--dry-run'], atmChartRepo);
  assert(welcomeDryRun.exitCode === 0, 'welcome --dry-run must exit 0 after ATMChart render');
  assertReadable(welcomeDryRun, 'welcome');
  assert(welcomeDryRun.parsed.ok === true, 'welcome --dry-run must report ok=true');
  assert(welcomeDryRun.parsed.evidence.dryRun === true, 'welcome --dry-run must report dryRun=true');
  assert(welcomeDryRun.parsed.evidence.lineagePath === null, 'welcome --dry-run must not report a persisted lineage path');
  assert(!existsSync(path.join(atmChartRepo, '.atm/runtime/welcome.lineage.json')), 'welcome --dry-run must not write welcome lineage');
  assertMessageCode(welcomeDryRun, 'ATM_WELCOME_DRY_RUN');

  const welcome = runAtm(['welcome', '--cwd', atmChartRepo], atmChartRepo);
  assert(welcome.exitCode === 0, 'welcome must exit 0 after ATMChart render');
  assertReadable(welcome, 'welcome');
  assert(welcome.parsed.ok === true, 'welcome must report ok=true');
  assert(welcome.parsed.evidence.lineagePath === '.atm/runtime/welcome.lineage.json', 'welcome must report the welcome lineage path');
  assert(existsSync(path.join(atmChartRepo, '.atm/runtime/welcome.lineage.json')), 'welcome must write welcome lineage');
  assert(welcome.parsed.evidence.welcomeLineage.welcomeCount === 1, 'welcome lineage must start with welcomeCount=1');
  assert(typeof welcome.parsed.evidence.nextAction?.command === 'string', 'welcome must surface the next action command');
  assertMessageCode(welcome, 'ATM_WELCOME_READY');

  const nextAfterWelcome = runAtm(['next', '--cwd', atmChartRepo], atmChartRepo);
  assertReadable(nextAfterWelcome, 'next');
  assert(nextAfterWelcome.parsed.evidence.agent_pack_hint != null, 'next must surface agent_pack_hint');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.slashCommandId === 'string', 'agent_pack_hint must have slashCommandId');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.route === 'string', 'agent_pack_hint must have route');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.command === 'string', 'agent_pack_hint must have command');
  assert(typeof nextAfterWelcome.parsed.evidence.agent_pack_hint.reason === 'string', 'agent_pack_hint must have reason');

  const welcomeDoctor = runAtm(['doctor', '--cwd', atmChartRepo], atmChartRepo);
  assertReadable(welcomeDoctor, 'doctor');
  const onboardingCheck = welcomeDoctor.parsed.evidence.checks.find((check: any) => check.name === 'onboarding-lifecycle');
  assert(onboardingCheck.ok === true, 'doctor onboarding-lifecycle check must pass after ATMChart render and welcome');
  assert(onboardingCheck.details.stage === 'welcomed', 'doctor onboarding-lifecycle check must report welcomed stage');
  assert(onboardingCheck.details.atmChartFreshness === 'fresh', 'doctor onboarding-lifecycle check must report fresh ATMChart');

  const guardsPath = path.join(atmChartRepo, '.atm', 'runtime', 'default-guards.json');
  const guards = JSON.parse(readFileSync(guardsPath, 'utf8'));
  guards.guards[0].summary = `${guards.guards[0].summary} (drift)`;
  writeFileSync(guardsPath, `${JSON.stringify(guards, null, 2)}\n`, 'utf8');

  const atmChartStale = runAtm(['atm-chart', 'verify', '--cwd', atmChartRepo], atmChartRepo);
  assert(atmChartStale.exitCode === 2, 'atm-chart verify must exit 2 when source guards drift');
  assert(atmChartStale.parsed.ok === false, 'atm-chart verify must report ok=false when stale');
  assertMessageCode(atmChartStale, 'ATM_CHART_STALE');

  const agentPackStale = runAtm(['agent-pack', 'verify-fresh', '--id', 'claude-code', '--cwd', atmChartRepo], atmChartRepo);
  assert(agentPackStale.exitCode === 2, 'agent-pack verify-fresh must exit 2 when source guards drift');
  assert(agentPackStale.parsed.ok === false, 'agent-pack verify-fresh must report ok=false when stale');
  assertMessageCode(agentPackStale, 'ATM_AGENT_PACK_STALE');

  const staleDoctor = runAtm(['doctor', '--cwd', atmChartRepo], atmChartRepo);
  assert(staleDoctor.exitCode === 1, 'doctor must fail when onboarding ATMChart is stale');
  assertReadable(staleDoctor, 'doctor');
  const staleOnboardingCheck = staleDoctor.parsed.evidence.checks.find((check: any) => check.name === 'onboarding-lifecycle');
  assert(staleOnboardingCheck.ok === false, 'doctor onboarding-lifecycle check must fail when ATMChart is stale');
  assert(staleOnboardingCheck.details.atmChartFreshness === 'stale', 'doctor onboarding-lifecycle check must report stale ATMChart');
  assertMessageCode(staleDoctor, 'ATM_DOCTOR_ONBOARDING_STALE');

  const status = runAtm(['status'], blankRepo);
  assert(status.exitCode === 0, 'status after init must exit 0');
  assertReadable(status, 'status');
  assert(status.parsed.ok === true, 'status after init must report ok=true');
  assert(status.parsed.evidence.standaloneMode === true, 'status must report standaloneMode=true');

  const validateRepo = runAtm(['validate'], blankRepo);
  assert(validateRepo.exitCode === 0, 'validate after init must exit 0');
  assertReadable(validateRepo, 'validate');
  assert(validateRepo.parsed.ok === true, 'validate after init must report ok=true');
  assertMessageCode(validateRepo, 'ATM_VALIDATE_REPOSITORY_OK');

  const integrationRepo = path.join(tempRoot, 'integration-repo');
  mkdirSync(integrationRepo, { recursive: true });
  const integrationList = runAtm(['integration', 'list', '--cwd', integrationRepo], integrationRepo);
  assert(integrationList.exitCode === 0, 'integration list must exit 0');
  assertReadable(integrationList, 'integration');
  assert(integrationList.parsed.ok === true, 'integration list must report ok=true');
  assert(integrationList.parsed.evidence.available.includes('claude-code'), 'integration list must include claude-code');
  assert(integrationList.parsed.evidence.available.includes('copilot'), 'integration list must include copilot');
  assert(integrationList.parsed.evidence.available.includes('cursor'), 'integration list must include cursor');
  assert(integrationList.parsed.evidence.available.includes('gemini'), 'integration list must include gemini');
  assertMessageCode(integrationList, 'ATM_INTEGRATION_LIST_OK');

  const integrationAdd = runAtm(['integration', 'add', 'claude-code', '--cwd', integrationRepo, '--actor', 'validate-cli', '--at', '2026-01-01T00:00:00.000Z'], integrationRepo);
  assert(integrationAdd.exitCode === 0, 'integration add claude-code must exit 0');
  assertReadable(integrationAdd, 'integration');
  assert(integrationAdd.parsed.ok === true, 'integration add claude-code must report ok=true');
  assert(integrationAdd.parsed.evidence.manifestPath === '.atm/integrations/claude-code.manifest.json', 'integration add must use per-adapter manifest path');
  assert(existsSync(path.join(integrationRepo, '.atm/integrations/claude-code.manifest.json')), 'integration add must write per-adapter manifest');
  assert(existsSync(path.join(integrationRepo, '.claude/skills/atm-next/SKILL.md')), 'integration add must write agent-native entry files');
  assertMessageCode(integrationAdd, 'ATM_INTEGRATION_ADDED');

  const integrationVerify = runAtm(['integration', 'verify', 'claude-code', '--cwd', integrationRepo], integrationRepo);
  assert(integrationVerify.exitCode === 0, 'integration verify claude-code must exit 0 after install');
  assertReadable(integrationVerify, 'integration');
  assert(integrationVerify.parsed.ok === true, 'integration verify claude-code must report ok=true');
  assert(integrationVerify.parsed.evidence.driftedFiles.length === 0, 'integration verify must report no drift after install');
  assertMessageCode(integrationVerify, 'ATM_INTEGRATION_VERIFY_OK');

  const integrationRemove = runAtm(['integration', 'remove', 'claude-code', '--cwd', integrationRepo], integrationRepo);
  assert(integrationRemove.exitCode === 0, 'integration remove claude-code must exit 0');
  assertReadable(integrationRemove, 'integration');
  assert(integrationRemove.parsed.ok === true, 'integration remove claude-code must report ok=true');
  assert(!existsSync(path.join(integrationRepo, '.atm/integrations/claude-code.manifest.json')), 'integration remove must remove unchanged manifest');
  assert(!existsSync(path.join(integrationRepo, '.claude/skills/atm-next/SKILL.md')), 'integration remove must remove unchanged entry file');
  assertMessageCode(integrationRemove, 'ATM_INTEGRATION_REMOVED');

  const initIntegrationRepo = path.join(tempRoot, 'init-integration-repo');
  mkdirSync(initIntegrationRepo, { recursive: true });
  const initWithIntegration = runAtm(['init', '--cwd', initIntegrationRepo, '--integration', 'cursor'], initIntegrationRepo);
  assert(initWithIntegration.exitCode === 0, 'init --integration cursor must exit 0');
  assertReadable(initWithIntegration, 'init');
  assert(initWithIntegration.parsed.ok === true, 'init --integration cursor must report ok=true');
  assert(initWithIntegration.parsed.evidence.integrationInstall?.adapter?.id === 'cursor', 'init --integration must report installed adapter id');
  assert(existsSync(path.join(initIntegrationRepo, '.atm/integrations/cursor.manifest.json')), 'init --integration must write per-adapter manifest');
  assert(existsSync(path.join(initIntegrationRepo, '.cursor/rules/skills/atm-next/SKILL.md')), 'init --integration must write adapter files');
  assertMessageCode(initWithIntegration, 'ATM_INIT_INTEGRATION_ADDED');

  const initIntegrationDoctor = runAtm(['doctor', '--cwd', initIntegrationRepo], initIntegrationRepo);
  assertReadable(initIntegrationDoctor, 'doctor');
  const integrationDoctorCheck = initIntegrationDoctor.parsed.evidence.checks.find((check: any) => check.name === 'integration-adapters');
  assert(integrationDoctorCheck.ok === true, 'doctor integration-adapters check must pass after init --integration');
  assert(integrationDoctorCheck.details.installed.includes('cursor'), 'doctor integration-adapters check must report installed cursor adapter');

  const cursorSkillPath = path.join(initIntegrationRepo, '.cursor/rules/skills/atm-next/SKILL.md');
  writeFileSync(cursorSkillPath, `${readFileSync(cursorSkillPath, 'utf8')}\n# drift\n`, 'utf8');
  const initIntegrationDoctorDrift = runAtm(['doctor', '--cwd', initIntegrationRepo], initIntegrationRepo);
  assert(initIntegrationDoctorDrift.exitCode === 1, 'doctor must fail after adapter file drift');
  assertReadable(initIntegrationDoctorDrift, 'doctor');
  const integrationDriftCheck = initIntegrationDoctorDrift.parsed.evidence.checks.find((check: any) => check.name === 'integration-adapters');
  assert(integrationDriftCheck.ok === false, 'doctor integration-adapters check must fail after drift');
  assert(integrationDriftCheck.details.failed[0].driftedFiles.includes('.cursor/rules/skills/atm-next/SKILL.md'), 'doctor integration-adapters check must report drifted file');

  const validSpecPath = path.join(root, fixture.validAtomicSpec);
  const validateSpec = runAtm(['validate', '--spec', validSpecPath], blankRepo);
  assert(validateSpec.exitCode === 0, 'validate --spec valid fixture must exit 0');
  assertReadable(validateSpec, 'validate');
  assert(validateSpec.parsed.ok === true, 'validate --spec valid fixture must report ok=true');
  assertMessageCode(validateSpec, 'ATM_VALIDATE_SPEC_OK');

  const specValidate = runAtm(['spec', '--validate', validSpecPath], blankRepo);
  assert(specValidate.exitCode === 0, 'spec --validate valid fixture must exit 0');
  assertReadable(specValidate, 'spec');
  assert(specValidate.parsed.ok === true, 'spec --validate valid fixture must report ok=true');
  assertMessageCode(specValidate, 'ATM_SPEC_VALIDATE_OK');

  const invalidSpecPath = path.join(blankRepo, 'invalid.atom.json');
  writeFileSync(invalidSpecPath, JSON.stringify({ schemaId: 'atm.atomicSpec', specVersion: '0.1.0' }, null, 2), 'utf8');
  const validateInvalidSpec = runAtm(['validate', '--spec', invalidSpecPath], blankRepo);
  assert(validateInvalidSpec.exitCode === 1, 'validate --spec invalid fixture must exit 1');
  assertReadable(validateInvalidSpec, 'validate');
  assert(validateInvalidSpec.parsed.ok === false, 'validate --spec invalid fixture must report ok=false');
  assertMessageCode(validateInvalidSpec, 'ATM_SPEC_REQUIRED_FIELD');

  const specValidateInvalid = runAtm(['spec', '--validate', invalidSpecPath], blankRepo);
  assert(specValidateInvalid.exitCode === 1, 'spec --validate invalid fixture must exit 1');
  assertReadable(specValidateInvalid, 'spec');
  assert(specValidateInvalid.parsed.ok === false, 'spec --validate invalid fixture must report ok=false');
  assertMessageCode(specValidateInvalid, 'ATM_SPEC_REQUIRED_FIELD');

  const validateMissingSpec = runAtm(['validate', '--spec', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(validateMissingSpec.exitCode === 1, 'validate --spec missing fixture must exit 1');
  assertReadable(validateMissingSpec, 'validate');
  assert(validateMissingSpec.parsed.ok === false, 'validate --spec missing fixture must report ok=false');
  assertMessageCode(validateMissingSpec, 'ATM_SPEC_NOT_FOUND');

  const specValidateMissing = runAtm(['spec', '--validate', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(specValidateMissing.exitCode === 1, 'spec --validate missing fixture must exit 1');
  assertReadable(specValidateMissing, 'spec');
  assert(specValidateMissing.parsed.ok === false, 'spec --validate missing fixture must report ok=false');
  assertMessageCode(specValidateMissing, 'ATM_SPEC_NOT_FOUND');

  const bootstrapRepo = path.join(tempRoot, 'bootstrap-repo');
  mkdirSync(bootstrapRepo, { recursive: true });
  const bootstrap = runAtm(['bootstrap', '--cwd', bootstrapRepo, '--task', 'Bootstrap ATM self-hosting alpha'], bootstrapRepo);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 in blank repo');
  assertReadable(bootstrap, 'bootstrap');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true');
  assert(bootstrap.parsed.evidence.adoptedProfile === 'default', 'bootstrap must adopt default profile');
  assert(existsSync(path.join(bootstrapRepo, 'AGENTS.md')), 'bootstrap must create AGENTS.md');

  const verifySelf = runAtm(['verify', '--self'], root);
  assert(verifySelf.exitCode === 0, 'verify --self must exit 0 in repository root');
  assertReadable(verifySelf, 'verify');
  assert(verifySelf.parsed.ok === true, 'verify --self must report ok=true');
  assertMessageCode(verifySelf, 'ATM_VERIFY_SELF_OK');

  const verifyNeutrality = runAtm(['verify', '--neutrality'], root);
  assert(verifyNeutrality.exitCode === 0, 'verify --neutrality must exit 0 in repository root');
  assertReadable(verifyNeutrality, 'verify');
  assert(verifyNeutrality.parsed.ok === true, 'verify --neutrality must report ok=true');
  assertMessageCode(verifyNeutrality, 'ATM_VERIFY_NEUTRALITY_OK');

  const verifyAgentsMd = runAtm(['verify', '--agents-md'], root);
  assert(verifyAgentsMd.exitCode === 0, 'verify --agents-md must exit 0 in repository root');
  assertReadable(verifyAgentsMd, 'verify');
  assert(verifyAgentsMd.parsed.ok === true, 'verify --agents-md must report ok=true');
  assertMessageCode(verifyAgentsMd, 'ATM_VERIFY_AGENTS_MD_OK');

  const verifyGuardsPass = runAtm(['verify', '--guards', '--evidence', path.join(root, 'fixtures/verify/guard-evidence-pass.json')], root);
  assert(verifyGuardsPass.exitCode === 0, 'verify --guards --evidence pass must exit 0');
  assertReadable(verifyGuardsPass, 'verify');
  assert(verifyGuardsPass.parsed.ok === true, 'verify --guards --evidence pass must report ok=true');
  assertMessageCode(verifyGuardsPass, 'ATM_VERIFY_GUARDS_OK');

  const verifyGuardsMissing = runAtm(['verify', '--guards', '--evidence', path.join(root, 'fixtures/verify/guard-evidence-missing-justification.json')], root);
  assert(verifyGuardsMissing.exitCode === 1, 'verify --guards --evidence missing-justification must exit 1');
  assertReadable(verifyGuardsMissing, 'verify');
  assert(verifyGuardsMissing.parsed.ok === false, 'verify --guards --evidence missing-justification must report ok=false');
  assertMessageCode(verifyGuardsMissing, 'ATM_VERIFY_GUARDS_MISSING_JUSTIFICATION');
  assert(verifyGuardsMissing.parsed.evidence.requiredJustification !== null, 'verify --guards missing-justification must report requiredJustification');
  assert(Array.isArray(verifyGuardsMissing.parsed.evidence.missingJustifications), 'verify --guards missing-justification must list missingJustifications');
  assert(verifyGuardsMissing.parsed.evidence.missingJustifications.includes('evidence-after-change'), 'verify --guards missing-justification must name the offending guardId');

  const upgradePass = runAtm([
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

  const upgradeBlocked = runAtm([
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

  const upgradeScanEmpty = runAtm([
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

  const upgradeScanDraft = runAtm([
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

  const rollbackPlan = runAtm([
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

  const rollbackApply = runAtm([
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

  const reviewList = runAtm(['review', 'list', '--cwd', reviewRepo], reviewRepo);
  assert(reviewList.exitCode === 0, 'review list must exit 0');
  assertReadable(reviewList, 'review');
  assert(reviewList.parsed.ok === true, 'review list must report ok=true');
  assertMessageCode(reviewList, 'ATM_REVIEW_LIST_OK');

  const reviewShow = runAtm(['review', 'show', reviewProposal.proposalId, '--cwd', reviewRepo], reviewRepo);
  assert(reviewShow.exitCode === 0, 'review show must exit 0');
  assertReadable(reviewShow, 'review');
  assert(reviewShow.parsed.ok === true, 'review show must report ok=true');
  assert(reviewShow.parsed.evidence.proposal?.proposalId === reviewProposal.proposalId, 'review show must return requested proposal');
  assertMessageCode(reviewShow, 'ATM_REVIEW_SHOW_OK');

  const reviewApprove = runAtm([
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
  const reviewRejectMissingReason = runAtm(['review', 'reject', reviewProposal.proposalId, '--cwd', reviewRejectFreshRepo], reviewRejectFreshRepo);
  assert(reviewRejectMissingReason.exitCode === 2, 'review reject without --reason must exit 2');
  assertReadable(reviewRejectMissingReason, 'review');
  assert(reviewRejectMissingReason.parsed.ok === false, 'review reject without --reason must report ok=false');
  assertMessageCode(reviewRejectMissingReason, 'ATM_CLI_USAGE');

  const reviewReject = runAtm([
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

  const testHelloWorld = runAtm(['test', '--atom', 'hello-world'], root);
  assert(testHelloWorld.exitCode === 0, 'test --atom hello-world must exit 0 in repository root');
  assertReadable(testHelloWorld, 'test');
  assert(testHelloWorld.parsed.ok === true, 'test --atom hello-world must report ok=true');
  assert(testHelloWorld.parsed.evidence.passCount === 5, 'test --atom hello-world must report 5 passCount');
  assert(testHelloWorld.parsed.evidence.total === 5, 'test --atom hello-world must report 5 total checks');
  assertMessageCode(testHelloWorld, 'ATM_TEST_HELLO_WORLD_OK');

  const selfHostAlpha = runAtm(['self-host-alpha', '--verify'], root);
  assert(selfHostAlpha.exitCode === 0, 'self-host-alpha --verify must exit 0 in repository root');
  assertReadable(selfHostAlpha, 'self-host-alpha');
  assert(selfHostAlpha.parsed.ok === true, 'self-host-alpha --verify must report ok=true');
  assert(selfHostAlpha.parsed.criteria1 === true, 'self-host-alpha criteria1 must be true');
  assert(selfHostAlpha.parsed.criteria2 === true, 'self-host-alpha criteria2 must be true');
  assert(selfHostAlpha.parsed.criteria3 === true, 'self-host-alpha criteria3 must be true');
  assert(selfHostAlpha.parsed.criteria4 === true, 'self-host-alpha criteria4 must be true');
  assertMessageCode(selfHostAlpha, 'ATM_SELF_HOST_ALPHA_OK');

  const selfHostAlphaClaude = runAtm(['self-host-alpha', '--verify', '--agent', 'claude-code'], root);
  assert(selfHostAlphaClaude.exitCode === 0, 'self-host-alpha --verify --agent claude-code must exit 0 in repository root');
  assertReadable(selfHostAlphaClaude, 'self-host-alpha');
  assert(selfHostAlphaClaude.parsed.ok === true, 'self-host-alpha --verify --agent claude-code must report ok=true');
  assert(selfHostAlphaClaude.parsed.agent === 'claude-code', 'self-host-alpha --verify --agent claude-code must echo the resolved agent id');
  assert(selfHostAlphaClaude.parsed.evidence.confidence?.advisory === true, 'self-host-alpha --verify --agent claude-code must mark confidence as advisory');
  assert(selfHostAlphaClaude.parsed.evidence.confidence?.confidenceReady === true, 'self-host-alpha --verify --agent claude-code must report confidenceReady=true');
  assertMessageCode(selfHostAlphaClaude, 'ATM_SELF_HOST_ALPHA_CONFIDENCE_ADVISORY');

  const frameworkStatus = runAtm(['status'], root);
  assert(frameworkStatus.exitCode === 0, 'status in framework repository root must exit 0');
  assertReadable(frameworkStatus, 'status');
  assert(frameworkStatus.parsed.ok === true, 'status in framework repository root must report ok=true');
  assert(frameworkStatus.parsed.evidence.frameworkPhase === 'B1-complete', 'status in framework repository root must surface frameworkPhase=B1-complete');
  assert(frameworkStatus.parsed.evidence.atomStatus === 'active', 'status in framework repository root must surface atomStatus=active');
  assert(frameworkStatus.parsed.evidence.governanceTier === 'governed', 'status in framework repository root must surface governanceTier=governed');
  assertMessageCode(frameworkStatus, 'ATM_STATUS_PHASE_B1_COMPLETE');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[cli:${mode}] ok (${fixture.commands.length} commands, standalone fixture verified)`);
}
