import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  DEFAULT_TEAM_STEWARD_ID,
  buildTeamBrokerRuntimeActivationHandshake,
  buildTeamBrokerRunRecord,
  buildTeamBrokerRunRecordEnvelope,
  evaluateTeamBrokerLane,
  registerIntent,
  saveRegistry
} from '../packages/core/src/broker/index.ts';
import type { WriteBrokerRegistryDocument, WriteIntent } from '../packages/core/src/broker/types.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import { runTeam } from '../packages/cli/src/commands/team.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition: unknown, message: string) {
  assert.ok(condition, `[team-brokered-write:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const writeTransactionSchema = readJson('schemas/team-agents/team-broker-write-transaction.schema.json');
ajv.addSchema(writeTransactionSchema);
const validateWriteTransaction = ajv.compile(writeTransactionSchema);
const validateRuntimeActivation = ajv.compile(readJson('schemas/team-agents/team-broker-runtime-activation.schema.json'));

function formatAjvErrors(errors: typeof validateWriteTransaction.errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function writeTaskCard(cwd: string, taskId: string, scopePaths: string[], atomId: string) {
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
    }
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

function assertBrokerRunLogKeepsTaskLinkage(cwd: string) {
  const runDir = path.join(cwd, 'broker-runs');
  const logPath = path.join(cwd, 'broker-run-log.md');
  mkdirSync(runDir, { recursive: true });

  const request = {
    schemaId: 'atm.mutationRequest.v1' as const,
    specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: 'team broker log fixture' },
    requestId: 'req-team-log-1',
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
  writeJson(path.join(runDir, 'run-team-log-1.json'), envelope);

  const result = spawnSync(
    process.execPath,
    ['--strip-types', path.join(root, 'scripts', 'scan-broker-runs.ts'), '--run-dir', runDir, '--log-file', logPath, '--compact'],
    { encoding: 'utf8' }
  );
  check(result.status === 0, `scan-broker-runs failed: ${result.stderr || result.stdout}`);
  const logText = readFileSync(logPath, 'utf8');
  check(logText.includes('| runId | planId | requestCount | actorCount | files | tasks | commits | transactions | adapter | lane | verdict | evidence |'), 'broker run log must expose tasks, commits, and transactions columns');
  check(logText.includes('| run-team-log-1 | plan-team-log-1 | 1 | 1 | src/shared-target.ts | TASK-TEAM-BROKER-LOG | abc123teamlogcommit | txn-team-log-1 | text-range | neutral-steward | mergeable | .atm/history/evidence/broker-runs/run-team-log-1.json |'), 'broker run log must preserve task, commit, and transaction linkage');
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
  const persistedRecords = envelope.records as Array<Record<string, unknown>>;
  check(
    (persistedRecords?.[0]?.transaction_ids as string[] | undefined)?.includes('txn-team-cli-transaction') === true,
    'broker plan-batch persisted run envelope must preserve request transaction id'
  );
}

ensureRequiredFiles();
ensureConfigWiring();

const tempRoot = createTempWorkspace('atm-team-brokered-write-');
const previousAtmSessionId = process.env.ATM_SESSION_ID;
try {
  process.env.ATM_SESSION_ID = 'team-broker-session-fixture';
  initializeGitRepository(tempRoot);
  writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ name: 'atm-team-brokered-write-temp', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
  const sharedFile = 'src/shared-target.ts';
  const sharedDir = path.join(tempRoot, 'src');
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(path.join(tempRoot, sharedFile), 'alpha\n', 'utf8');
  commitText(tempRoot, 'base shared target for team broker fixture');
  const tempBranchRef = readCurrentBranch(tempRoot);

  const overlapTaskId = 'TASK-TEAM-BROKER-OVERLAP';
  const blockedTaskId = 'TASK-TEAM-BROKER-BLOCKED';
  const safeTaskId = 'TASK-TEAM-BROKER-SAFE';

  writeTaskCard(tempRoot, overlapTaskId, [sharedFile], 'atom-overlap-recipient');
  writeTaskCard(tempRoot, blockedTaskId, [sharedFile], 'atom-overlap-donor');
  writeTaskCard(tempRoot, safeTaskId, ['src/unique-target.ts'], 'atom-safe');

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
  check(overlapResult.evidence.writeTransaction.leaseEpoch > 0, 'write transaction must carry lease epoch');
  check(Date.parse(overlapResult.evidence.writeTransaction.expiresAt) > Date.parse(overlapResult.evidence.writeTransaction.startedAt), 'write transaction expiresAt must be after startedAt');
  check(
    validateWriteTransaction(overlapResult.evidence.writeTransaction),
    `real team broker write transaction must match schema: ${formatAjvErrors(validateWriteTransaction.errors)}`
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

  const overlapPlan = await runTeam(['plan', '--task', overlapTaskId, '--cwd', tempRoot, '--json']);
  check(overlapPlan.ok === true, `team plan must pass for steward lane: ${JSON.stringify(overlapPlan)}`);
  const overlapEvidence = overlapPlan.evidence as Record<string, unknown>;
  check(Boolean(overlapEvidence?.brokerLane), 'team plan evidence must include brokerLane');
  const overlapBrokerLane = overlapEvidence.brokerLane as Record<string, unknown>;
  check(overlapBrokerLane.chosenLane === 'neutral-steward', 'team plan brokerLane must surface steward lane');
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
