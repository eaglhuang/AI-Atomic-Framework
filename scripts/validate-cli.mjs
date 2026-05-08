import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDecisionSnapshotHash } from '../packages/plugin-human-review/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');

function fail(message) {
  console.error(`[cli:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function runAtm(args, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, fixture.entrypoint), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
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

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertReadable(result, commandName) {
  for (const field of fixture.agentReadableFields) {
    assert(Object.hasOwn(result.parsed, field), `${commandName} output missing field: ${field}`);
  }
  assert(Array.isArray(result.parsed.messages), `${commandName} messages must be an array`);
  assert(result.parsed.evidence && typeof result.parsed.evidence === 'object', `${commandName} evidence must be an object`);
}

function assertMessageCode(result, code) {
  assert(result.parsed.messages.some((entry) => entry.code === code), `expected message code ${code}`);
}

for (const relativePath of [fixture.entrypoint, 'packages/cli/src/commands/bootstrap-entry.mjs', 'packages/cli/src/commands/create.mjs', 'packages/cli/src/commands/init.mjs', 'packages/cli/src/commands/rollback.mjs', 'packages/cli/src/commands/review.mjs', 'packages/cli/src/commands/self-host-alpha.mjs', 'packages/cli/src/commands/spec.mjs', 'packages/cli/src/commands/status.mjs', 'packages/cli/src/commands/upgrade.mjs', 'packages/cli/src/commands/test.mjs', 'packages/cli/src/commands/validate.mjs', 'packages/cli/src/commands/verify.mjs', 'fixtures/upgrade/hash-diff-report.json', 'fixtures/upgrade/quality-comparison-pass.json', 'fixtures/upgrade/quality-comparison-blocked.json', 'fixtures/upgrade/proposal-pass.json', 'fixtures/upgrade/proposal-blocked.json', 'fixtures/registry/v1-with-versions.json', 'tests/police-fixtures/positive/non-regression-report.json', 'tests/police-fixtures/positive/registry-candidate-report.json', 'tests/schema-fixtures/positive/minimal-execution-evidence.json', fixture.validAtomicSpec, 'atomic-registry.json']) {
  assert(existsSync(path.join(root, relativePath)), `missing CLI fixture dependency: ${relativePath}`);
}

const cliIndex = readFileSync(path.join(root, 'packages/cli/src/index.ts'), 'utf8');
for (const commandName of fixture.commands) {
  assert(cliIndex.includes(`commandName: '${commandName}'`), `index.ts missing command descriptor: ${commandName}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-'));
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
  const rolledEntry = rolledRegistry.entries.find((entry) => entry.atomId === 'ATM-FIXTURE-0001');
  assert(rolledEntry.currentVersion === '1.0.0', 'rollback --apply must update currentVersion to target version');
  assert(existsSync(path.join(rollbackRepo, '.atm', 'reports', 'rollback-proof.json')), 'rollback --apply must write rollback-proof.json');

  const reviewRepo = path.join(tempRoot, 'review-repo');
  mkdirSync(reviewRepo, { recursive: true });
  const reviewQueuePath = path.join(reviewRepo, '.atm', 'reports', 'upgrade-proposals.json');
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
  writeJson(path.join(reviewRejectFreshRepo, '.atm', 'reports', 'upgrade-proposals.json'), {
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
  assert(frameworkStatus.parsed.evidence.atomStatus === 'governed', 'status in framework repository root must surface atomStatus=governed');
  assertMessageCode(frameworkStatus, 'ATM_STATUS_PHASE_B1_COMPLETE');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[cli:${mode}] ok (${fixture.commands.length} commands, standalone fixture verified)`);
}