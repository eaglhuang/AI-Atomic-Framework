import type { ValidateCliContext } from './context.ts';
import {
  assert,
  assertMessageCode,
  assertReadable,
  createCliTempWorkspace,
  existsSync,
  initializeGitRepository,
  mkdirSync,
  path,
  readFileSync,
  rmSync,
  root,
  runAtm,
  safeRmSync,
  writeFileSync,
  writeJson
} from './context.ts';
import { createHumanReviewQueueDocument, createHumanReviewQueueRecord } from '../../packages/plugin-human-review/src/index.ts';

export async function runFullSuite(ctx: ValidateCliContext) {
  ctx.logProgress('full fixture workspace setup');
  const tempRoot = createCliTempWorkspace('atm-cli-');
  try {
    await assertEmergencyAndCacheFixtures(tempRoot);
    await assertOnboardingAndIntegrationFixtures(tempRoot);
    await assertSpecVerifyReviewFixtures(tempRoot, ctx);
    await assertEvidenceCommandQuotingAndAutoLink(tempRoot, ctx);
  } finally {
    safeRmSync(tempRoot);
  }
}

async function assertEmergencyAndCacheFixtures(tempRoot: string) {
  const emergencyPermissions = await runAtm(['emergency', 'permissions', '--json'], tempRoot);
  assert(emergencyPermissions.exitCode === 0, 'emergency permissions must exit 0');
  assertReadable(emergencyPermissions, 'emergency permissions');
  const reconcilePermission = emergencyPermissions.parsed.evidence.permissions.find((entry: any) => entry.id === 'backend.tasks.reconcile');
  assert(reconcilePermission?.normalLane === 'taskflow close', 'emergency permission registry must expose normalLane');
  assert(reconcilePermission?.requiresHumanApprovalText === true, 'emergency permission registry must require human approval text');

  const approval = await runAtm([
    'emergency', 'approve', '--cwd', tempRoot, '--task', 'TASK-CID-TEST', '--actor', 'validator',
    '--permission', 'backend.tasks.reconcile', '--approval-text', 'Human approved validator emergency reconcile test',
    '--reason', 'validator exercises emergency lease lifecycle', '--json'
  ], tempRoot);
  assert(approval.exitCode === 0, 'emergency approve must exit 0');
  const leaseId = approval.parsed.evidence?.lease?.leaseId;
  assert(typeof leaseId === 'string' && leaseId.startsWith('EMG-'), 'emergency approve must return a lease id');
  const revoke = await runAtm(['emergency', 'revoke', '--cwd', tempRoot, '--lease', leaseId, '--actor', 'captain', '--json'], tempRoot);
  assert(revoke.parsed.evidence?.lease?.status === 'revoked', 'emergency revoke must mark the lease revoked');

  writeJson(path.join(tempRoot, '.atm/history/tasks/TASK-CID-TEST.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-CID-TEST',
    title: 'Emergency reconcile approval gate fixture',
    status: 'running'
  });
  const backendWithoutApproval = await runAtm(['tasks', 'reconcile', '--cwd', tempRoot, '--task', 'TASK-CID-TEST', '--actor', 'validator', '--delivery-commit', 'deadbeef', '--json'], tempRoot);
  assert(backendWithoutApproval.exitCode === 1, 'protected direct tasks reconcile without emergency approval must fail closed');
  assertMessageCode(backendWithoutApproval, 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED');

  const cacheRoot = path.join(tempRoot, 'onefile-cache');
  for (const entryName of ['old-a', 'old-b', 'new-c']) {
    const entryRoot = path.join(cacheRoot, entryName);
    mkdirSync(entryRoot, { recursive: true });
    writeFileSync(path.join(entryRoot, 'payload.txt'), entryName, 'utf8');
  }
  const cacheDryRun = await runAtm(['cache', 'prune', '--runtime', 'onefile', '--keep', '1', '--dry-run', '--json'], root, { ATM_ONEFILE_CACHE_ROOT: cacheRoot });
  assert(cacheDryRun.exitCode === 0, 'cache prune dry-run must exit 0');
  assertReadable(cacheDryRun, 'cache');
}

async function assertOnboardingAndIntegrationFixtures(tempRoot: string) {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });
  const init = await runAtm(['init'], blankRepo);
  assert(init.exitCode === 0, 'init must exit 0 in blank repo');
  assert(existsSync(path.join(blankRepo, '.atm/config.json')), 'init must create config file');

  const atmChartRepo = path.join(tempRoot, 'atm-chart-repo');
  mkdirSync(atmChartRepo, { recursive: true });
  initializeGitRepository(atmChartRepo);
  assert((await runAtm(['bootstrap', '--cwd', atmChartRepo, '--json'], atmChartRepo)).exitCode === 0, 'bootstrap must exit 0 before ATMChart render');
  const render = await runAtm(['atm-chart', 'render', '--cwd', atmChartRepo, '--json'], atmChartRepo);
  assert(render.exitCode === 0, 'atm-chart render must exit 0 after bootstrap');
  assert(existsSync(path.join(atmChartRepo, '.atm/memory/atm-chart.md')), 'atm-chart render must write .atm/memory/atm-chart.md');
  assert((await runAtm(['atm-chart', 'verify', '--cwd', atmChartRepo, '--json'], atmChartRepo)).exitCode === 0, 'atm-chart verify must exit 0 immediately after render');

  for (const adapter of ['claude-code', 'codex', 'antigravity']) {
    const integrationRepo = path.join(tempRoot, `integration-${adapter}`);
    mkdirSync(integrationRepo, { recursive: true });
    const add = await runAtm(['integration', 'add', adapter, '--cwd', integrationRepo, '--actor', 'validate-cli', '--at', '2026-01-01T00:00:00.000Z'], integrationRepo);
    assert(add.exitCode === 0, `integration add ${adapter} must exit 0`);
    const verify = await runAtm(['integration', 'verify', adapter, '--cwd', integrationRepo], integrationRepo);
    assert(verify.exitCode === 0, `integration verify ${adapter} must exit 0 after install`);
    const remove = await runAtm(['integration', 'remove', adapter, '--cwd', integrationRepo], integrationRepo);
    assert(remove.exitCode === 0, `integration remove ${adapter} must exit 0`);
  }
}

async function assertSpecVerifyReviewFixtures(tempRoot: string, ctx: ValidateCliContext) {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  const validSpecPath = path.join(root, ctx.fixture.validAtomicSpec);
  const validateSpec = await runAtm(['validate', '--spec', validSpecPath], blankRepo);
  assert(validateSpec.exitCode === 0, 'validate --spec valid fixture must exit 0');
  assertMessageCode(validateSpec, 'ATM_VALIDATE_SPEC_OK');
  assert((await runAtm(['verify', '--self'], root)).exitCode === 0, 'verify --self must exit 0 in repository root');
  assert((await runAtm(['verify', '--neutrality'], root)).exitCode === 0, 'verify --neutrality must exit 0 in repository root');
  assert((await runAtm(['verify', '--agents-md', '--json'], root)).exitCode === 0, 'verify --agents-md must exit 0 in repository root');

  const reviewRepo = path.join(tempRoot, 'review-repo');
  mkdirSync(path.join(reviewRepo, '.atm/history/reports'), { recursive: true });
  const proposal = JSON.parse(readFileSync(path.join(root, 'fixtures/upgrade/proposal-pass.json'), 'utf8'));
  writeJson(
    path.join(reviewRepo, '.atm/history/reports/upgrade-proposals.json'),
    createHumanReviewQueueDocument([createHumanReviewQueueRecord(proposal)], { generatedAt: '2026-01-01T00:00:00.000Z' })
  );
  const reviewList = await runAtm(['review', 'list', '--cwd', reviewRepo], reviewRepo);
  assert(reviewList.exitCode === 0, 'review list must exit 0');
  assertReadable(reviewList, 'review');
}

async function assertEvidenceCommandQuotingAndAutoLink(tempRoot: string, ctx: ValidateCliContext) {
  ctx.logProgress('evidence command quoting and auto-link fixtures');
  const workspace = createCliTempWorkspace('validate-cli-autolink');
  try {
    initializeGitRepository(workspace);
    const importRes = await runAtm(['tasks', 'import', '--from', ctx.aao0063TaskFixturePath, '--write'], workspace);
    assert(importRes.parsed.ok === true, 'import task must succeed');
    await runAtm(['next', '--claim', '--actor', 'Antigravity', '--task', 'TASK-AAO-0063'], workspace);
    const addRes = await runAtm([
      'evidence', 'add', '--task', 'TASK-AAO-0063', '--actor', 'Antigravity', '--kind', 'test',
      '--command', 'npm run validate:cli', '--exit-code', '0',
      '--stdout-sha256', `sha256:${'1'.repeat(64)}`,
      '--stderr-sha256', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ], workspace);
    assert(addRes.parsed.ok === true, 'evidence add without --validators must succeed');
    const evidence = JSON.parse(readFileSync(path.join(workspace, '.atm/history/evidence/TASK-AAO-0063.json'), 'utf8'));
    assert(evidence.evidence[0].details.validationPasses.includes('validate:cli'), 'auto-link must automatically link validate:cli');

    const taskAPath = path.join(workspace, '.atm/history/tasks/TASK-REGRESS-DEP-A.json');
    const taskBPath = path.join(workspace, '.atm/history/tasks/TASK-REGRESS-DEP-B.json');
    writeJson(taskAPath, { schemaVersion: 'atm.workItem.v0.2', workItemId: 'TASK-REGRESS-DEP-A', title: 'Dependency A', status: 'done' });
    writeJson(taskBPath, { schemaVersion: 'atm.workItem.v0.2', workItemId: 'TASK-REGRESS-DEP-B', title: 'Dependency B', status: 'ready', dependencies: ['TASK-REGRESS-DEP-A'] });
    const claimRes = await runAtm(['tasks', 'claim', '--task', 'TASK-REGRESS-DEP-B', '--actor', 'Antigravity'], workspace);
    assert(claimRes.exitCode !== 0, 'tasks claim B must fail because dependency A has no closeout provenance');
    assertMessageCode(claimRes, 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED');
  } finally {
    safeRmSync(workspace);
    rmSync(path.join(tempRoot, 'unused'), { recursive: true, force: true });
  }
}
