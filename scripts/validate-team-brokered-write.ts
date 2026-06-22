import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  DEFAULT_TEAM_STEWARD_ID,
  buildTeamWriteIntent,
  buildTeamBrokerRuntimeActivationHandshake,
  buildTeamBrokerRunRecord,
  buildTeamBrokerRunRecordEnvelope,
  evaluateTeamBrokerLane,
  loadRegistry,
  registerIntent,
  saveRegistry
} from '../packages/core/src/broker/index.ts';
import { calculateBrokerDecision, composeBrokerProposals } from '../packages/core/src/broker/index.ts';
import type { WriteBrokerRegistryDocument, WriteIntent } from '../packages/core/src/broker/types.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import { runTeam } from '../packages/cli/src/commands/team.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const retainArtifactsDir = process.argv.includes('--retain-artifacts-dir')
  ? process.argv[process.argv.indexOf('--retain-artifacts-dir') + 1]
  : null;

function check(condition: unknown, message: string) {
  assert.ok(condition, `[team-brokered-write:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const writeTransactionSchema = readJson('schemas/team-agents/team-broker-write-transaction.schema.json');
const brokerLaneSchema = readJson('schemas/team-agents/team-broker-lane.schema.json');
const brokerOperationRunRecordSchema = readJson('schemas/broker/operation-run-record.schema.json');
ajv.addSchema(writeTransactionSchema);
ajv.addSchema(brokerLaneSchema);
const validateWriteTransaction = ajv.compile(writeTransactionSchema);
const validateBrokerOperationRunRecord = ajv.compile(brokerOperationRunRecordSchema);
const validateRuntimeActivation = ajv.compile(readJson('schemas/team-agents/team-broker-runtime-activation.schema.json'));
const maybeValidateBrokerLane = ajv.getSchema('https://schemas.ai-atomic-framework.dev/team-agents/team-broker-lane.schema.json');
check(maybeValidateBrokerLane, 'team broker lane schema must be registered for validator');
const validateBrokerLane = maybeValidateBrokerLane!;

function formatAjvErrors(errors: typeof validateWriteTransaction.errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRetainArtifactsDir(): string | null {
  if (!retainArtifactsDir || retainArtifactsDir.startsWith('--')) {
    return null;
  }
  return path.resolve(root, retainArtifactsDir);
}

async function runAtm(args: string[], cwd = root) {
  const normalizedArgs = args.filter((arg) => arg !== 'broker' && arg !== '--json');
  try {
    const parsed = await runBroker([...normalizedArgs, '--cwd', cwd]);
    return { exitCode: 0, parsed };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      parsed: { ok: false, evidence: error?.details ?? {} }
    };
  }
}

function commitText(cwd: string, message: string) {
  const add = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8' });
  check(add.status === 0, `git add failed: ${add.stderr || add.stdout}`);
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=ATM', '-c', 'user.email=atm@example.com', 'commit', '-m', message], {
    encoding: 'utf8'
  });
  check(result.status === 0, `git commit failed: ${result.stderr || result.stdout}`);
  const sha = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(sha.status === 0, `git rev-parse HEAD failed: ${sha.stderr || sha.stdout}`);
  return String(sha.stdout ?? '').trim();
}

function readCurrentBranch(cwd: string) {
  const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
  check(result.status === 0, `git symbolic-ref failed: ${result.stderr || result.stdout}`);
  return String(result.stdout ?? '').trim();
}

function ensureRequiredFiles() {
  for (const relativePath of [
    'package.json',
    'scripts/validators.config.json',
    'packages/core/src/broker/team-lane.ts',
    'packages/core/src/broker/index.ts',
    'packages/cli/src/commands/team.ts',
    'packages/cli/src/commands/command-specs/team.spec.ts'
  ]) {
    check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
  }
}

function ensureConfigWiring() {
  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['validate:team-brokered-write'] === 'node --strip-types scripts/validate-team-brokered-write.ts --mode validate',
    'package.json must expose validate:team-brokered-write'
  );

  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: { name?: string }) => entry.name === 'validate-team-brokered-write');
  check(Boolean(validatorDef), 'validators.config.json must register validate-team-brokered-write');
  check(validatorDef?.entry === 'scripts/validate-team-brokered-write.ts', 'validate-team-brokered-write entry path mismatch');
  check(validatorDef?.slow === false, 'validate-team-brokered-write should be a fast validator');
  check(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-team-brokered-write') === true,
    'standard profile must include validate-team-brokered-write'
  );
}

function writeTaskCard(cwd: string, taskId: string, scopePaths: string[], atomId: string, extras: Record<string, unknown> = {}) {
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeJson(path.join(taskDir, `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: `Team broker fixture ${taskId}`,
    status: 'planned',
    scopePaths,
    deliverables: scopePaths,
    atomizationImpact: {
      ownerAtomOrMap: atomId
    },
    ...extras
  });
}

function seedRegistry(cwd: string, intent: WriteIntent) {
  const registryPath = path.join(cwd, '.atm', 'runtime', 'write-broker.registry.json');
  const emptyRegistry: WriteBrokerRegistryDocument = {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'team-broker-fixture',
    workspaceId: 'main',
    activeIntents: []
  };
  const registry = registerIntent(emptyRegistry, intent, 'direct-brokered');
  saveRegistry(registryPath, registry);
  return registryPath;
}

function writeIntentFile(cwd: string, filename: string, intent: WriteIntent) {
  const filePath = path.join(cwd, filename);
  writeJson(filePath, intent);
  return filePath;
}

function writeProposalFile(cwd: string, filename: string, proposal: Record<string, unknown>) {
  const filePath = path.join(cwd, filename);
  writeJson(filePath, proposal);
  return filePath;
}

function assertBrokerRunLogKeepsTaskLinkage(cwd: string) {
  const runDir = path.join(cwd, 'broker-runs');
  const logPath = path.join(cwd, 'broker-run-log.md');
  const reportPath = path.join(cwd, 'broker-run-report.md');
  mkdirSync(runDir, { recursive: true });

  const request = {
    schemaId: 'atm.mutationRequest.v1' as const,
    specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: 'team broker log fixture' },
    requestId: 'bench:B-12:TASK-TEAM-BROKER-LOG:req-team-log-1',
    actorId: 'coordinator-1',
    taskId: 'TASK-TEAM-BROKER-LOG',
    filePath: 'src/shared-target.ts',
    op: 'append',
    target: 'EOF',
    value: 'beta'
  };
  const record = buildTeamBrokerRunRecord({
    runId: 'run-team-log-1',
    planId: 'plan-team-log-1',
    request,
    adapterChoice: 'text-range',
    laneDecision: 'neutral-steward',
    mergeVerdict: 'mergeable',
    evidencePath: '.atm/history/evidence/broker-runs/run-team-log-1.json',
    appliedFiles: ['src/shared-target.ts'],
    commitSha: 'abc123teamlogcommit',
    transactionIds: ['txn-team-log-1']
  });
  check(record.transaction_ids?.[0] === 'txn-team-log-1', 'broker run record must preserve transaction id linkage');
  const envelope = buildTeamBrokerRunRecordEnvelope({
    runId: 'run-team-log-1',
    planId: 'plan-team-log-1',
    records: [record]
  });
  check(
    validateBrokerOperationRunRecord(envelope),
    `broker run record envelope must match schema: ${formatAjvErrors(validateBrokerOperationRunRecord.errors)}`
  );
  writeJson(path.join(runDir, 'run-team-log-1.json'), envelope);

  const result = spawnSync(
    process.execPath,
    ['--strip-types', path.join(root, 'scripts', 'scan-broker-runs.ts'), '--run-dir', runDir, '--log-file', logPath, '--report-output', reportPath, '--compact'],
    { encoding: 'utf8' }
  );
  check(result.status === 0, `scan-broker-runs failed: ${result.stderr || result.stdout}`);
  const logText = readFileSync(logPath, 'utf8');
  check(logText.includes('| runId | planId | requestCount | actorCount | scenarioTags | requestIdentities | actors | taskHints | files | tasks | commits | transactions | adapter | lane | verdict | evidence |'), 'broker run log must expose the expanded broker evidence columns');
  check(logText.includes('| run-team-log-1 | plan-team-log-1 | 1 | 1 | B-12 | bench:B-12:TASK-TEAM-BROKER-LOG:req-team-log-1 | coordinator-1 | TASK-TEAM-BROKER-LOG | src/shared-target.ts | TASK-TEAM-BROKER-LOG | abc123teamlogcommit | txn-team-log-1 | text-range | neutral-steward | mergeable | .atm/history/evidence/broker-runs/run-team-log-1.json |'), 'broker run log must preserve task, commit, and transaction linkage');

  const reportText = readFileSync(reportPath, 'utf8');
  check(reportText.includes('| runId | scenario | task | actor | shared files | lane | verdict |'), 'broker evidence report must expose the report columns');
  check(reportText.includes('| run-team-log-1 | B-12 | TASK-TEAM-BROKER-LOG | coordinator-1 | src/shared-target.ts | neutral-steward | mergeable |'), 'broker evidence report must preserve the shared file and lane summary');
}

async function assertBrokerPlanBatchKeepsTransactionLinkage(cwd: string) {
  const brokeredTextFile = 'docs/broker-transaction-log.md';
  const brokeredTextPath = path.join(cwd, brokeredTextFile);
  mkdirSync(path.dirname(brokeredTextPath), { recursive: true });
  writeFileSync(brokeredTextPath, 'alpha\n', 'utf8');
  const requestPath = path.join(cwd, 'broker-request-with-transaction.json');
  const runEvidenceDir = path.join(cwd, 'broker-plan-runs');
  writeJson(requestPath, {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'team broker transaction fixture' },
    requestId: 'req-team-cli-transaction',
    actorId: 'coordinator-1',
    taskId: 'TASK-TEAM-BROKER-CLI-TXN',
    transactionId: 'txn-team-cli-transaction',
    filePath: brokeredTextFile,
    op: 'append',
    target: 'EOF',
    value: 'gamma'
  });

  const result = await runAtm([
    'broker', 'plan-batch',
    '--request-file', requestPath,
    '--apply',
    '--run-evidence-dir', runEvidenceDir
  ], cwd);
  check(result.exitCode === 0 && result.parsed.ok === true, `broker plan-batch apply must pass: ${JSON.stringify(result.parsed)}`);

  const runRecords = (result.parsed.evidence as Record<string, unknown>)?.runRecords as Array<Record<string, unknown>> | undefined;
  check(runRecords?.[0]?.transaction_ids instanceof Array, 'broker plan-batch run record must expose transaction_ids');
  check((runRecords?.[0]?.transaction_ids as string[]).includes('txn-team-cli-transaction'), 'broker plan-batch run record must preserve request transaction id');

  const runEvidencePath = (result.parsed.evidence as Record<string, unknown>)?.runEvidencePath;
  check(typeof runEvidencePath === 'string' && runEvidencePath.length > 0, 'broker plan-batch must report run evidence path');
  const envelope = JSON.parse(readFileSync(path.join(cwd, runEvidencePath as string), 'utf8')) as Record<string, unknown>;
  check(
    validateBrokerOperationRunRecord(envelope),
    `broker plan-batch persisted run envelope must match schema: ${formatAjvErrors(validateBrokerOperationRunRecord.errors)}`
  );
  const persistedRecords = envelope.records as Array<Record<string, unknown>>;
  check(
    (persistedRecords?.[0]?.transaction_ids as string[] | undefined)?.includes('txn-team-cli-transaction') === true,
    'broker plan-batch persisted run envelope must preserve request transaction id'
  );
}

ensureRequiredFiles();
ensureConfigWiring();

const tempRoot = createTempWorkspace('atm-team-brokered-write-');
const retainedArtifactsDir = resolveRetainArtifactsDir();
const previousAtmSessionId = process.env.ATM_SESSION_ID;
try {
  process.env.ATM_SESSION_ID = 'team-broker-session-fixture';
  initializeGitRepository(tempRoot);
  writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ name: 'atm-team-brokered-write-temp', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
  const sharedFile = 'src/shared-target.ts';
  const sharedDir = path.join(tempRoot, 'src');
  const hotSharedFile = 'packages/cli/src/commands/broker.ts';
  mkdirSync(sharedDir, { recursive: true });
  mkdirSync(path.join(tempRoot, 'packages', 'cli', 'src', 'commands'), { recursive: true });
  writeFileSync(path.join(tempRoot, sharedFile), 'alpha\n', 'utf8');
  writeFileSync(
    path.join(tempRoot, hotSharedFile),
    [
      'export function brokerHotFixture() {',
      '  const lines = [',
      "    'line-01',",
      "    'line-02',",
      "    'line-03',",
      "    'line-04',",
      "    'line-05',",
      "    'line-06',",
      "    'line-07',",
      "    'line-08',",
      "    'line-09',",
      "    'line-10',",
      "    'line-11',",
      "    'line-12',",
      "    'line-13',",
      "    'line-14',",
      "    'line-15',",
      "    'line-16',",
      "    'line-17',",
      "    'line-18',",
      "    'line-19',",
      "    'line-20',",
      "    'line-21',",
      "    'line-22',",
      "    'line-23',",
      "    'line-24',",
      "    'line-25',",
      "    'line-26',",
      "    'line-27',",
      "    'line-28',",
      "    'line-29',",
      "    'line-30'",
      '  ];',
      "  return lines.join('\\n');",
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  commitText(tempRoot, 'base shared target for team broker fixture');
  const tempBranchRef = readCurrentBranch(tempRoot);

  const overlapTaskId = 'TASK-TEAM-BROKER-OVERLAP';
  const blockedTaskId = 'TASK-TEAM-BROKER-BLOCKED';
  const safeTaskId = 'TASK-TEAM-BROKER-SAFE';
  const hotFirstTaskId = 'TASK-TEAM-BROKER-HOT-FIRST';
  const hotDisjointTaskId = 'TASK-TEAM-BROKER-HOT-DISJOINT';
  const hotOverlapTaskId = 'TASK-TEAM-BROKER-HOT-OVERLAP';
  const hotParkSeedTaskId = 'TASK-TEAM-BROKER-HOT-PARK-SEED';
  const hotParkJoinTaskId = 'TASK-TEAM-BROKER-HOT-PARK-JOIN';
  const sameOwnerSeedTaskId = 'TASK-TEAM-BROKER-SAME-OWNER-SEED';
  const sameOwnerJoinTaskId = 'TASK-TEAM-BROKER-SAME-OWNER-JOIN';
  const sameOwnerBlockTaskId = 'TASK-TEAM-BROKER-SAME-OWNER-BLOCK';

  writeTaskCard(tempRoot, overlapTaskId, [sharedFile], 'atom-overlap-recipient');
  writeTaskCard(tempRoot, blockedTaskId, [sharedFile], 'atom-overlap-donor');
  writeTaskCard(tempRoot, safeTaskId, ['src/unique-target.ts'], 'atom-safe');
  writeTaskCard(tempRoot, hotFirstTaskId, [hotSharedFile], 'atom-hot-first', {
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: false,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 1, lineEnd: 12 }],
      notes: 'First writer must submit proposal before hot-file write.'
    }
  });
  writeTaskCard(tempRoot, hotDisjointTaskId, [hotSharedFile], 'atom-hot-disjoint', {
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 18, lineEnd: 24 }],
      notes: 'Second writer proposes a disjoint bounded region.'
    }
  });
  writeTaskCard(tempRoot, hotOverlapTaskId, [hotSharedFile], 'atom-hot-overlap', {
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 8, lineEnd: 12 }],
      notes: 'Second writer overlaps the same bounded region.'
    }
  });
  writeTaskCard(tempRoot, hotParkSeedTaskId, [hotSharedFile], 'atom-hot-park-seed');
  writeTaskCard(tempRoot, hotParkJoinTaskId, [hotSharedFile], 'atom-hot-park-join', {
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 14, lineEnd: 16 }],
      notes: 'Second writer joins while the first writer has not yet submitted bounded-region detail.'
    }
  });
  writeTaskCard(tempRoot, sameOwnerSeedTaskId, [hotSharedFile], 'atm.hot-owner-map', {
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: [hotSharedFile],
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 1, lineEnd: 20 }],
      notes: 'Owner-map seed writer for same-owner bounded-region broker evidence.'
    }
  });
  writeTaskCard(tempRoot, sameOwnerJoinTaskId, [hotSharedFile], 'atm.hot-owner-map', {
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 24, lineEnd: 28 }],
      notes: 'Same owner map, disjoint bounded region joiner should route to composer.'
    }
  });
  writeTaskCard(tempRoot, sameOwnerBlockTaskId, [hotSharedFile], 'atm.hot-owner-map', {
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: hotSharedFile, lineStart: 10, lineEnd: 10 }],
      notes: 'Same owner map, overlapping bounded region joiner must remain blocked.'
    }
  });

  seedRegistry(tempRoot, {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
    taskId: 'TASK-TEAM-BROKER-DONOR',
    actorId: 'donor-actor',
    baseCommit: 'fixture-commit',
    targetFiles: [sharedFile],
    atomRefs: [{ atomId: 'atom-overlap-donor', atomCid: 'cid-donor', operation: 'modify' }],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto'
  });

  const overlapTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${overlapTaskId}.json`), 'utf8'));
  const blockedTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${blockedTaskId}.json`), 'utf8'));
  const safeTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${safeTaskId}.json`), 'utf8'));
  const hotFirstTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${hotFirstTaskId}.json`), 'utf8'));
  const hotDisjointTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${hotDisjointTaskId}.json`), 'utf8'));
  const hotOverlapTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${hotOverlapTaskId}.json`), 'utf8'));
  const hotParkJoinTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${hotParkJoinTaskId}.json`), 'utf8'));
  const sameOwnerSeedTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${sameOwnerSeedTaskId}.json`), 'utf8'));
  const sameOwnerJoinTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${sameOwnerJoinTaskId}.json`), 'utf8'));
  const sameOwnerBlockTask = JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${sameOwnerBlockTaskId}.json`), 'utf8'));

  const overlapResult = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: overlapTaskId,
    actorId: 'team-planner',
    task: overlapTask,
    writePaths: [sharedFile]
  });
  check(overlapResult.ok === true, 'same-file CID-disjoint overlap must remain safe to start');
  check(overlapResult.evidence.chosenLane === 'neutral-steward', 'same-file CID-disjoint overlap must surface steward lane');
  check(overlapResult.evidence.stewardId === DEFAULT_TEAM_STEWARD_ID, 'steward lane must use neutral-write-steward');
  check(overlapResult.evidence.composerPath === 'broker compose -> steward plan/apply', 'steward lane must expose composer path');
  check(overlapResult.evidence.decision.verdict === 'needs-physical-split', 'broker decision must record needs-physical-split');
  check(overlapResult.evidence.writeTransaction.schemaId === 'atm.teamBrokerWriteTransaction.v1', 'broker lane must include write transaction evidence');
  check(overlapResult.evidence.writeTransaction.transactionId.startsWith('txn-'), 'write transaction must include stable transaction id prefix');
  check(overlapResult.evidence.writeTransaction.taskId === overlapTaskId, 'write transaction must carry task id');
  check(overlapResult.evidence.writeTransaction.principalId === 'team-planner', 'write transaction must carry principal id');
  check(overlapResult.evidence.writeTransaction.actorId === 'team-planner', 'write transaction must carry actor id');
  check(overlapResult.evidence.writeTransaction.sessionId === 'team-broker-session-fixture', 'write transaction must carry session id when available');
  check(overlapResult.evidence.writeTransaction.instanceId === 'team-planner@local', 'write transaction must carry instance id');
  check(overlapResult.evidence.writeTransaction.worktreeId === tempRoot, 'write transaction must carry worktree id');
  check(overlapResult.evidence.writeTransaction.branchRef === tempBranchRef, 'write transaction must carry current branch ref');
  check(overlapResult.evidence.writeTransaction.baseHead === overlapResult.evidence.writeIntent.baseCommit, 'write transaction baseHead must match write intent base commit');
  check(overlapResult.evidence.writeTransaction.allowedFiles.includes(sharedFile), 'write transaction must include allowed files');
  check(overlapResult.evidence.writeTransaction.readSet.includes(sharedFile), 'write transaction must include read set');
  check(overlapResult.evidence.writeTransaction.writeSet.includes(sharedFile), 'write transaction must include write set');
  check(String(overlapResult.evidence.writeTransaction.fileHashesBefore[sharedFile] ?? '').startsWith('sha256:'), 'write transaction must record file hash before write');
  check(overlapResult.evidence.writeTransaction.brokerDecision.verdict === overlapResult.evidence.decision.verdict, 'write transaction broker decision verdict must match lane decision');
  check(overlapResult.evidence.writeTransaction.brokerDecision.lane === overlapResult.evidence.decision.lane, 'write transaction broker decision lane must match lane decision');
  check(overlapResult.evidence.writeTransaction.brokerDecision.parallelSafetyReason === null, 'non-parallel-safe transaction must not claim parallel-safe reason');
  check(overlapResult.evidence.writeTransaction.leaseEpoch > 0, 'write transaction must carry lease epoch');
  check(Date.parse(overlapResult.evidence.writeTransaction.expiresAt) > Date.parse(overlapResult.evidence.writeTransaction.startedAt), 'write transaction expiresAt must be after startedAt');
  check(
    validateWriteTransaction(overlapResult.evidence.writeTransaction),
    `real team broker write transaction must match schema: ${formatAjvErrors(validateWriteTransaction.errors)}`
  );
  check(
    validateBrokerLane(overlapResult.evidence),
    `real team broker lane evidence must match schema: ${formatAjvErrors(validateBrokerLane.errors)}`
  );

  const blockedResult = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: blockedTaskId,
    actorId: 'team-planner',
    task: blockedTask,
    writePaths: [sharedFile]
  });
  check(blockedResult.ok === false, 'CID conflict must fail closed before team run');
  check(blockedResult.evidence.chosenLane === 'blocked', 'CID conflict must choose blocked lane');
  check(blockedResult.evidence.decision.verdict === 'blocked-cid-conflict', 'CID conflict must record blocked-cid-conflict verdict');

  const safeResult = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: safeTaskId,
    actorId: 'team-planner',
    task: safeTask,
    writePaths: ['src/unique-target.ts']
  });
  check(safeResult.ok === true, 'parallel-safe task must remain safe to start');
  check(safeResult.evidence.chosenLane === 'direct-brokered', 'parallel-safe task must route to direct-brokered');
  check(safeResult.evidence.writeTransaction.brokerDecision.parallelSafetyReason === 'no-known-textual-or-resource-conflict', 'parallel-safe transaction must record no-known textual/resource conflict reason');
  check(
    validateWriteTransaction(safeResult.evidence.writeTransaction),
    `parallel-safe write transaction must match schema: ${formatAjvErrors(validateWriteTransaction.errors)}`
  );

  const overlapPlan = await runTeam(['plan', '--task', overlapTaskId, '--cwd', tempRoot, '--json']);
  check(overlapPlan.ok === true, `team plan must pass for steward lane: ${JSON.stringify(overlapPlan)}`);
  const overlapEvidence = overlapPlan.evidence as Record<string, unknown>;
  check(Boolean(overlapEvidence?.brokerLane), 'team plan evidence must include brokerLane');
  const overlapBrokerLane = overlapEvidence.brokerLane as Record<string, unknown>;
  check(overlapBrokerLane.chosenLane === 'neutral-steward', 'team plan brokerLane must surface steward lane');
  check(
    validateBrokerLane(overlapBrokerLane),
    `team plan brokerLane evidence must match schema: ${formatAjvErrors(validateBrokerLane.errors)}`
  );
  const overlapBriefing = (overlapEvidence.teamPlan as Record<string, unknown>)?.briefingContract as Record<string, unknown>;
  check((overlapBriefing?.brokerAdvisory as Record<string, unknown>)?.verdict === 'steward-lane', 'briefing contract must advertise steward lane');

  const blockedPlan = await runTeam(['plan', '--task', blockedTaskId, '--cwd', tempRoot, '--json']);
  check(blockedPlan.ok === false, 'team plan must fail closed on broker CID conflict');
  const blockedEvidence = blockedPlan.evidence as Record<string, unknown>;
  const blockedValidation = blockedEvidence.validation as { findings?: Array<{ code?: string }> };
  check(
    blockedValidation?.findings?.some((finding) => finding.code === 'blocked-broker-cid-conflict') === true,
    'team plan validation must include blocked-broker-cid-conflict finding'
  );

  const blockedStart = await runTeam(['start', '--task', blockedTaskId, '--actor', 'coordinator-1', '--cwd', tempRoot, '--json']);
  check(blockedStart.ok === false, 'team start must fail closed on broker CID conflict');
  check((blockedStart.evidence as Record<string, unknown>)?.runtimeWritten === false, 'team start must not write runtime on broker block');

  const overlapStart = await runTeam(['start', '--task', overlapTaskId, '--actor', 'coordinator-1', '--cwd', tempRoot, '--json']);
  check(overlapStart.ok === true, `team start must pass for steward lane: ${JSON.stringify(overlapStart)}`);
  const overlapRunEvidence = overlapStart.evidence as Record<string, unknown>;
  const overlapTeamRun = overlapRunEvidence.teamRun as Record<string, unknown>;
  check(Boolean(overlapTeamRun?.brokerLane), 'team run record must include brokerLane evidence');
  check((overlapTeamRun.brokerLane as Record<string, unknown>)?.chosenLane === 'neutral-steward', 'team run brokerLane must record steward path');
  check(
    validateBrokerLane(overlapTeamRun.brokerLane),
    `team run brokerLane evidence must match schema: ${formatAjvErrors(validateBrokerLane.errors)}`
  );

  const runtimeHandshake = buildTeamBrokerRuntimeActivationHandshake({
    cwd: tempRoot,
    taskId: overlapTaskId,
    actorId: 'team-planner',
    task: overlapTask,
    writePaths: [sharedFile]
  });
  check(runtimeHandshake.ok === true, 'broker runtime activation handshake must approve steward lane input');
  check(runtimeHandshake.evidence.activationState === 'activated', 'broker runtime activation handshake must report activated state');
  check(runtimeHandshake.evidence.runtimeBoundary.gitWrite === false, 'broker runtime activation handshake must deny git.write');
  check(runtimeHandshake.evidence.runtimeBoundary.taskLifecycle === false, 'broker runtime activation handshake must deny task.lifecycle');
  check(runtimeHandshake.evidence.runtimeBoundary.selfClose === false, 'broker runtime activation handshake must deny self-close');
  check(runtimeHandshake.evidence.scopedWriteExecution.approved === true, 'broker runtime activation handshake must approve scoped write execution');
  check(runtimeHandshake.evidence.scopedWriteExecution.allowedFiles.includes(sharedFile), 'broker runtime activation handshake must carry allowed files');
  check(
    validateRuntimeActivation(runtimeHandshake.evidence),
    `real broker runtime activation handshake must match schema: ${formatAjvErrors(validateRuntimeActivation.errors)}`
  );

  const runtimeCliHandshake = await runAtm([
    'broker', 'runtime', 'activate',
    '--task', overlapTaskId,
    '--actor', 'team-planner',
    '--scope-file', sharedFile
  ], tempRoot);
  check(runtimeCliHandshake.exitCode === 0 && runtimeCliHandshake.parsed.ok === true, `broker runtime activate CLI must approve handshake: ${JSON.stringify(runtimeCliHandshake.parsed)}`);
  const runtimeEvidence = runtimeCliHandshake.parsed.evidence as Record<string, unknown>;
  check((runtimeEvidence.handshake as Record<string, unknown>)?.activationState === 'activated', 'broker runtime activate CLI evidence must include activated handshake');
  check(((runtimeEvidence.handshake as Record<string, unknown>)?.runtimeBoundary as Record<string, unknown> | undefined)?.gitWrite === false, 'broker runtime activate CLI evidence must keep git.write denied');
  check(((runtimeEvidence.handshake as Record<string, unknown>)?.runtimeBoundary as Record<string, unknown> | undefined)?.selfClose === false, 'broker runtime activate CLI evidence must keep self-close denied');
  check(
    validateRuntimeActivation(runtimeEvidence.handshake),
    `broker runtime activate CLI handshake must match schema: ${formatAjvErrors(validateRuntimeActivation.errors)}`
  );

  const firstWriterPlan = await runTeam(['plan', '--task', hotFirstTaskId, '--cwd', tempRoot, '--json']);
  check(firstWriterPlan.ok === false, 'hot-file first writer must enter proposal-first mode before a second writer exists');
  const firstWriterPlanBrokerLane = (firstWriterPlan.evidence as Record<string, unknown>)?.brokerLane as Record<string, unknown>;
  check(firstWriterPlanBrokerLane?.safeToStart === false, 'hot-file first writer must not be marked safeToStart');
  check((firstWriterPlanBrokerLane?.admission as Record<string, unknown>)?.state === 'proposal-submitted', 'hot-file first writer must emit proposal-submitted admission state');

  const hotFirstIntent = buildTeamWriteIntent({
    cwd: tempRoot,
    taskId: hotFirstTaskId,
    actorId: 'coordinator-1',
    task: hotFirstTask,
    writePaths: [hotSharedFile]
  });
  const hotFirstDecision = calculateBrokerDecision(hotFirstIntent, loadRegistry(path.join(tempRoot, '.atm', 'runtime', 'write-broker.registry.json')));
  const hotFirstIntentFile = writeIntentFile(tempRoot, 'hot-first.intent.json', hotFirstIntent);
  const registerHotFirst = await runAtm([
    'broker', 'register',
    '--task', hotFirstTaskId,
    '--intent-file', hotFirstIntentFile
  ], tempRoot);
  check(registerHotFirst.exitCode === 0 && registerHotFirst.parsed.ok === true, `first hot writer register must succeed: ${JSON.stringify(registerHotFirst.parsed)}`);
  check((registerHotFirst.parsed.evidence as Record<string, unknown>)?.decision, 'broker register must report decision evidence for first hot writer');

  const brokerStatusAfterFirst = await runAtm(['broker', 'status'], tempRoot);
  check(brokerStatusAfterFirst.exitCode === 0 && brokerStatusAfterFirst.parsed.ok === true, 'broker status must succeed after first hot writer registers');
  const admissionStates = ((brokerStatusAfterFirst.parsed.evidence as Record<string, unknown>)?.admissionStates ?? []) as Array<Record<string, unknown>>;
  const firstWriterAdmission = admissionStates.find((entry) => entry.taskId === hotFirstTaskId);
  check(firstWriterAdmission?.admissionState === 'proposal-submitted', 'registry status must preserve proposal-submitted state for the first hot writer');
  check(firstWriterAdmission?.admissionTrigger === 'hot-file', 'registry status must preserve hot-file trigger for the first writer');

  const hotDisjointLane = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: hotDisjointTaskId,
    actorId: 'coordinator-2',
    task: hotDisjointTask,
    writePaths: [hotSharedFile]
  });
  check(hotDisjointLane.ok === true, 'disjoint second writer must be admitted into governed composer/steward path');
  check(hotDisjointLane.evidence.decision.verdict === 'needs-physical-split', 'disjoint second writer must be resolved before apply as needs-physical-split');
  check(hotDisjointLane.evidence.admission.state === 'composer-routed', 'disjoint second writer must emit composer-routed admission state');
  check(hotDisjointLane.evidence.admission.rearbitrationRequired === true, 'disjoint second writer must record rearbitration requirement');

  const hotDisjointStart = await runTeam(['start', '--task', hotDisjointTaskId, '--actor', 'coordinator-2', '--cwd', tempRoot, '--json']);
  check(hotDisjointStart.ok === true, `disjoint second writer team start must enter governed path: ${JSON.stringify(hotDisjointStart)}`);
  const hotDisjointRun = (hotDisjointStart.evidence as Record<string, unknown>)?.teamRun as Record<string, unknown>;
  const hotDisjointBrokerLane = hotDisjointRun?.brokerLane as Record<string, unknown>;
  check(hotDisjointBrokerLane?.chosenLane === 'neutral-steward', 'disjoint second writer must be routed to neutral-steward');
  check((hotDisjointBrokerLane?.admission as Record<string, unknown>)?.state === 'composer-routed', 'team run must keep composer-routed admission state');

  const hotOverlapLane = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: hotOverlapTaskId,
    actorId: 'coordinator-3',
    task: hotOverlapTask,
    writePaths: [hotSharedFile]
  });
  check(hotOverlapLane.ok === false, 'overlapping second writer must be blocked before write');
  check(hotOverlapLane.evidence.decision.verdict === 'blocked-active-lease', 'overlap conflict must block at active lease admission stage');
  check(hotOverlapLane.evidence.admission.state === 'blocked-before-write', 'overlapping second writer must emit blocked-before-write state');

  const parkSeedIntent = buildTeamWriteIntent({
    cwd: tempRoot,
    taskId: hotParkSeedTaskId,
    actorId: 'coordinator-4',
    task: JSON.parse(readFileSync(path.join(tempRoot, '.atm', 'history', 'tasks', `${hotParkSeedTaskId}.json`), 'utf8')),
    writePaths: [hotSharedFile]
  });
  const parkSeedDecision = calculateBrokerDecision(parkSeedIntent, {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'team-broker-fixture',
    workspaceId: 'main',
    currentEpoch: Date.now(),
    activeIntents: []
  });
  const parkRegistryPath = path.join(tempRoot, '.atm', 'runtime', 'write-broker-park.registry.json');
  saveRegistry(
    parkRegistryPath,
    registerIntent(
      {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'team-broker-fixture',
        workspaceId: 'main',
        activeIntents: []
      },
      parkSeedIntent,
      'direct-brokered',
      1800,
      parkSeedDecision.admission
    )
  );
  const parkJoinLane = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: hotParkJoinTaskId,
    actorId: 'coordinator-5',
    task: hotParkJoinTask,
    writePaths: [hotSharedFile],
    registryPath: parkRegistryPath
  });
  check(parkJoinLane.ok === true, 'park-first-writer rearbitration must hand the second writer into governed path instead of direct write');
  check(parkJoinLane.evidence.admission.state === 'parked-for-rearbitration', 'rearbitration case must emit parked-for-rearbitration state');
  check(parkJoinLane.evidence.admission.rearbitrationRequired === true, 'rearbitration case must flag rearbitrationRequired');

  const sameOwnerSeedIntent = buildTeamWriteIntent({
    cwd: tempRoot,
    taskId: sameOwnerSeedTaskId,
    actorId: 'coordinator-6',
    task: sameOwnerSeedTask,
    writePaths: [hotSharedFile]
  });
  const sameOwnerSeedDecision = calculateBrokerDecision(sameOwnerSeedIntent, loadRegistry(path.join(tempRoot, '.atm', 'runtime', 'write-broker.registry.json')));
  const sameOwnerRegistryPath = path.join(tempRoot, '.atm', 'runtime', 'write-broker-same-owner.registry.json');
  saveRegistry(
    sameOwnerRegistryPath,
    registerIntent(
      {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'team-broker-fixture',
        workspaceId: 'main',
        activeIntents: []
      },
      sameOwnerSeedIntent,
      'direct-brokered',
      1800,
      sameOwnerSeedDecision.admission
    )
  );

  const sameOwnerJoinLane = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: sameOwnerJoinTaskId,
    actorId: 'coordinator-7',
    task: sameOwnerJoinTask,
    writePaths: [hotSharedFile],
    registryPath: sameOwnerRegistryPath
  });
  check(sameOwnerJoinLane.ok === true, 'same-owner disjoint bounded regions must route into governed composer path');
  check(sameOwnerJoinLane.evidence.decision.verdict === 'needs-physical-split', 'same-owner disjoint bounded regions must resolve as needs-physical-split');
  check(sameOwnerJoinLane.evidence.admission.state === 'composer-routed', 'same-owner disjoint bounded regions must emit composer-routed admission state');

  const sameOwnerBlockLane = evaluateTeamBrokerLane({
    cwd: tempRoot,
    taskId: sameOwnerBlockTaskId,
    actorId: 'coordinator-8',
    task: sameOwnerBlockTask,
    writePaths: [hotSharedFile],
    registryPath: sameOwnerRegistryPath
  });
  check(sameOwnerBlockLane.ok === false, 'same-owner overlapping bounded regions must fail closed');
  check(sameOwnerBlockLane.evidence.decision.verdict === 'blocked-cid-conflict', 'same-owner overlapping bounded regions must remain blocked-cid-conflict');
  check(sameOwnerBlockLane.evidence.admission.state === 'blocked-before-write', 'same-owner overlapping bounded regions must emit blocked-before-write state');
  check(Boolean(sameOwnerBlockLane.evidence.decision.decompositionRequest), 'same-owner overlapping bounded regions must emit a split suggestion');
  check(sameOwnerBlockLane.evidence.decision.decompositionRequest?.suggestionKind === 'coarse-owner-map-split', 'same-owner overlapping bounded regions must classify the suggestion as coarse-owner-map-split');
  check((sameOwnerBlockLane.evidence.decision.decompositionRequest?.suggestedAtoms?.length ?? 0) >= 1, 'same-owner overlapping bounded regions must list suggested child atoms');

  const baseHotFile = readFileSync(path.join(tempRoot, hotSharedFile), 'utf8');
  const hotBaseHash = `sha256:${createHash('sha256').update(baseHotFile).digest('hex')}`;
  const hotBaseCommit = spawnSync('git', ['-C', tempRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(hotBaseCommit.status === 0, `git rev-parse HEAD failed for proposal-gated hot flow: ${hotBaseCommit.stderr || hotBaseCommit.stdout}`);
  const hotBaseCommitSha = String(hotBaseCommit.stdout ?? '').trim();
  const firstProposalPath = writeProposalFile(tempRoot, 'proposal-first-hot.json', {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'proposal-gated hot writer first region' },
    proposalId: 'proposal-hot-first',
    taskId: hotFirstTaskId,
    actorId: 'coordinator-1',
    targetFile: hotSharedFile,
    baseCommit: hotBaseCommitSha,
    fileBeforeHash: hotBaseHash,
    atomRefs: [{ atomId: 'atom-hot-first', atomCid: 'cid-hot-first', operation: 'modify' }],
    anchors: [{ kind: 'line-range', hint: 'first-region' }],
    intent: 'Replace the first writer bounded region after proposal-first admission.',
    patch: '@@ -4,3 +4,3 @@\n-    \'line-02\',\n-    \'line-03\',\n-    \'line-04\',\n+    \'line-02-first\',\n+    \'line-03-first\',\n+    \'line-04-first\',\n',
    validators: ['node --strip-types scripts/validate-team-brokered-write.ts --mode validate'],
    rollback: 'Restore the original broker hot fixture lines 2-4.'
  });
  const secondProposalPath = writeProposalFile(tempRoot, 'proposal-second-hot.json', {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'proposal-gated hot writer disjoint region' },
    proposalId: 'proposal-hot-second',
    taskId: hotDisjointTaskId,
    actorId: 'coordinator-2',
    targetFile: hotSharedFile,
    baseCommit: hotBaseCommitSha,
    fileBeforeHash: hotBaseHash,
    atomRefs: [{ atomId: 'atom-hot-disjoint', atomCid: 'cid-hot-disjoint', operation: 'modify' }],
    anchors: [{ kind: 'line-range', hint: 'second-region' }],
    intent: 'Replace the disjoint late-joiner bounded region through composer/steward.',
    patch: '@@ -20,3 +20,3 @@\n-    \'line-18\',\n-    \'line-19\',\n-    \'line-20\',\n+    \'line-18-second\',\n+    \'line-19-second\',\n+    \'line-20-second\',\n',
    validators: ['node --strip-types scripts/validate-team-brokered-write.ts --mode validate'],
    rollback: 'Restore the original broker hot fixture lines 18-20.'
  });

  const hotCompose = await runAtm([
    'broker', 'compose',
    '--proposal-file', firstProposalPath,
    '--proposal-file', secondProposalPath
  ], tempRoot);
  check(hotCompose.exitCode === 0 && hotCompose.parsed.ok === true, `proposal-gated compose must succeed for disjoint hot regions: ${JSON.stringify(hotCompose.parsed)}`);
  const hotMergePlan = (hotCompose.parsed.evidence as Record<string, unknown>)?.mergePlan as Record<string, unknown>;
  check(hotMergePlan?.verdict === 'parallel-safe', 'disjoint patch proposals must remain compose-mergeable');
  const hotMergePlanPath = path.join(tempRoot, 'hot-merge-plan.json');
  writeJson(hotMergePlanPath, hotMergePlan);

  const stewardEvidenceRelative = path.join('.atm', 'runtime', 'proposal-gated-hot-apply.json');
  const stewardApply = await runAtm([
    'broker', 'steward', 'apply',
    '--merge-plan-file', hotMergePlanPath,
    '--proposal-file', firstProposalPath,
    '--proposal-file', secondProposalPath,
    '--task', hotDisjointTaskId,
    '--actor', 'coordinator-2',
    '--scope-file', hotSharedFile,
    '--evidence-out', stewardEvidenceRelative
  ], tempRoot);
  check(stewardApply.exitCode === 0 && stewardApply.parsed.ok === true, `governed steward apply must succeed after proposal gating: ${JSON.stringify(stewardApply.parsed)}`);
  const stewardEvidence = (stewardApply.parsed.evidence as Record<string, unknown>)?.applyEvidence as Record<string, unknown>;
  const scopedWriteExecution = (stewardApply.parsed.evidence as Record<string, unknown>)?.scopedWriteExecution as Record<string, unknown>;
  check(scopedWriteExecution?.verdict === 'applied', 'scoped governed write execution must end in applied state');
  check((scopedWriteExecution?.handshake as Record<string, unknown>)?.brokerLane, 'scoped execution must keep broker lane handshake evidence');
  check(Array.isArray((stewardEvidence?.appliedFiles as unknown[])) && (stewardEvidence.appliedFiles as string[]).includes(hotSharedFile), 'steward apply evidence must record applied hot file');
  check(readFileSync(path.join(tempRoot, hotSharedFile), 'utf8').includes('line-19-second'), 'governed steward apply must mutate the disjoint second region');
  check(readFileSync(path.join(tempRoot, hotSharedFile), 'utf8').includes('line-03-first'), 'governed steward apply must preserve the first writer region update');

  const composeDirect = composeBrokerProposals([
    JSON.parse(readFileSync(firstProposalPath, 'utf8')),
    JSON.parse(readFileSync(secondProposalPath, 'utf8'))
  ]);
  check(composeDirect.ok === true && composeDirect.mergePlan.verdict === 'parallel-safe', 'direct compose helper must agree with CLI compose for disjoint hot regions');

  const applyEvidencePath = path.join(tempRoot, stewardEvidenceRelative);
  const applyEvidenceJson = JSON.parse(readFileSync(applyEvidencePath, 'utf8')) as Record<string, unknown>;
  const brokerOperationRun = applyEvidenceJson.brokerOperationRun as Record<string, unknown>;
  const proposalRunDir = path.join(tempRoot, 'proposal-gated-runs');
  mkdirSync(proposalRunDir, { recursive: true });
  writeJson(path.join(proposalRunDir, 'proposal-gated-hot-run.json'), brokerOperationRun);

  const collectOutputDir = path.join(tempRoot, 'proposal-gated-evidence-bundle');
  const collectResult = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(root, 'scripts', 'collect-broker-evidence.ts'),
      '--run-dir', proposalRunDir,
      '--team-run-dir', path.join(tempRoot, '.atm', 'runtime', 'team-runs'),
      '--output-dir', collectOutputDir,
      '--atm-root', tempRoot,
      '--task-ids', `${hotFirstTaskId},${hotDisjointTaskId}`
    ],
    { encoding: 'utf8' }
  );
  check(collectResult.status === 0, `collect-broker-evidence must succeed for proposal-gated flow: ${collectResult.stderr || collectResult.stdout}`);
  const collectedJson = JSON.parse(readFileSync(path.join(collectOutputDir, 'broker-evidence-bundle.json'), 'utf8')) as { runs?: Array<Record<string, unknown>> };
  const collectedRows = collectedJson.runs ?? [];
  check(collectedRows.some((row) => String(row.tasks ?? '').includes(hotDisjointTaskId) && String(row.lane ?? '').includes('composer-routed')), 'collect-broker-evidence must report composer-routed state for the governed second writer');
  check(collectedRows.some((row) => String(row.tasks ?? '').includes(hotFirstTaskId) && String(row.lane ?? '').includes('proposal-submitted')), 'collect-broker-evidence must report proposal-submitted state for the first hot writer');

  if (retainedArtifactsDir) {
    rmSync(retainedArtifactsDir, { recursive: true, force: true });
    mkdirSync(retainedArtifactsDir, { recursive: true });
    cpSync(collectOutputDir, path.join(retainedArtifactsDir, 'broker-evidence-bundle'), { recursive: true });
    cpSync(proposalRunDir, path.join(retainedArtifactsDir, 'broker-runs'), { recursive: true });
    cpSync(path.join(tempRoot, '.atm', 'runtime', 'team-runs'), path.join(retainedArtifactsDir, 'team-runs'), { recursive: true });
    cpSync(applyEvidencePath, path.join(retainedArtifactsDir, 'proposal-gated-hot-apply.json'));
    writeJson(path.join(retainedArtifactsDir, 'proposal-gated-summary.json'), {
      schemaId: 'atm.proposalGatedWriteAdmissionDogfood.v1',
      generatedAt: new Date().toISOString(),
      mode,
      hotFile: hotSharedFile,
      traces: {
        firstWriterAdmission: firstWriterAdmission ?? null,
        disjointLane: hotDisjointLane.evidence.admission,
        blockedLane: hotOverlapLane.evidence.admission,
        parkedLane: parkJoinLane.evidence.admission,
        sameOwnerPositiveLane: sameOwnerJoinLane.evidence.admission,
        sameOwnerNegativeLane: sameOwnerBlockLane.evidence.admission,
        sameOwnerNegativeSplitSuggestion: sameOwnerBlockLane.evidence.decision.decompositionRequest ?? null,
        scopedWriteVerdict: scopedWriteExecution?.verdict ?? null
      },
      commands: [
        'node --strip-types scripts/validate-team-brokered-write.ts --mode validate',
        'npm run validate:team-agents -- --case capture-broker-evidence',
        'node --strip-types scripts/collect-broker-evidence.ts --run-dir <bundle>/broker-runs --team-run-dir <bundle>/team-runs --output-dir <dir> --atm-root <fixture-root>'
      ],
      artifactPaths: {
        brokerEvidenceBundle: 'broker-evidence-bundle/broker-evidence-bundle.json',
        brokerEvidenceReport: 'broker-evidence-bundle/broker-evidence-bundle.md',
        brokerRunsDir: 'broker-runs',
        teamRunsDir: 'team-runs',
        applyEvidence: 'proposal-gated-hot-apply.json'
      }
    });
  }

  assertBrokerRunLogKeepsTaskLinkage(tempRoot);
  await assertBrokerPlanBatchKeepsTransactionLinkage(tempRoot);

  console.log(`[team-brokered-write:${mode}] ok`);
} finally {
  if (previousAtmSessionId === undefined) {
    delete process.env.ATM_SESSION_ID;
  } else {
    process.env.ATM_SESSION_ID = previousAtmSessionId;
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
