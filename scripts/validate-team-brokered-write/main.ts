import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_TEAM_STEWARD_ID,
  buildTeamWriteIntent,
  buildTeamBrokerRuntimeActivationHandshake,
  evaluateTeamBrokerLane,
  loadRegistry,
  registerIntent,
  saveRegistry,
  calculateBrokerDecision
} from '../../packages/core/src/broker/index.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { createTempWorkspace, initializeGitRepository } from '../temp-root.ts';
import {
  check,
  commitText,
  ensureConfigWiring,
  ensureRequiredFiles,
  formatAjvErrors,
  mode,
  readCurrentBranch,
  resolveRetainArtifactsDir,
  runAtm,
  seedRegistry,
  validateBrokerLane,
  validateRuntimeActivation,
  validateWriteTransaction,
  writeIntentFile,
  writeJson,
  writeTaskCard
} from './context.ts';
import { assertBrokerPlanBatchKeepsTransactionLinkage, assertBrokerRunLogKeepsTaskLinkage } from './linkage.ts';
import { runProposalGatedHotFlow } from './proposal-flow.ts';

export async function runTeamBrokeredWriteValidator() {
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
    check((sameOwnerBlockLane.evidence.decision.decompositionRequest?.suggestedAtoms?.length ?? 0) >= 3, 'same-owner overlapping bounded regions must list before/focus/after child atoms');

    await runProposalGatedHotFlow({
      tempRoot,
      hotSharedFile,
      hotFirstTaskId,
      hotDisjointTaskId,
      hotOverlapTaskId,
      hotDisjointLane,
      hotOverlapLane,
      parkJoinLane,
      sameOwnerJoinLane,
      sameOwnerBlockLane,
      firstWriterAdmission,
      retainedArtifactsDir
    });

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
}
