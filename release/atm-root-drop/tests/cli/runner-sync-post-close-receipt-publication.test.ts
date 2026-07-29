import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerSyncReceipt,
  buildRunnerSyncReleaseCommand,
  writeRunnerSyncReceipt
} from '../../scripts/runner-sync-incremental-build.ts';
import type { RunnerSyncAdmissionReport } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import type { SealedBuildTimings } from '../../scripts/run-sealed-runner-build.ts';

// ATM-BUG-2026-07-21-220: post-close runner-sync receipts and release outputs must
// have one governed publication/runtime-only disposition, carry a runnable recovery
// command, and leave no protected-evidence manual-review residue.

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-receipt-publication-'));

function fixtureTimings(): SealedBuildTimings {
  return {
    startedAt: Date.now(),
    inputHashCalculationMs: 1,
    skipDecisionMs: 2,
    worktreeSetupMs: 3,
    typescriptBuildMs: 4,
    rootDropAssemblyMs: 5,
    onefileAssemblyMs: 6,
    artifactSyncMs: 7,
    cleanupMs: 8,
    totalElapsedMs: 36
  };
}

function fixtureAdmission(overrides: Partial<RunnerSyncAdmissionReport> = {}): RunnerSyncAdmissionReport {
  return {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: true,
    stewardActorId: 'release-steward',
    sealedSourceSha: '1'.repeat(40),
    actorAuthority: {
      schemaId: 'atm.sharedWriteActorAuthority.v1',
      ok: true,
      actorId: 'release-steward',
      resolutionSource: 'option',
      legacyEnvActorId: null,
      legacyEnvDisagrees: false,
      laneSessionId: null,
      queueHeadOwnerActorIds: [],
      activeClaimOwnerActorId: null,
      recoveryCommand: null,
      reason: null
    },
    runnerSyncSteward: {
      stewardWorkId: 'runner-sync-fixture',
      queuePosition: 1,
      suggestedNextAction: 'run runner sync',
      requestedSurfaces: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop'],
      waitingTasks: ['ATM-GOV-0256'],
      requests: [{ taskId: 'ATM-GOV-0256', actorId: 'release-steward', requestedSurfaces: ['release/atm-onefile/atm.mjs'] }]
    },
    queueHeadOwnership: {
      ok: true,
      stewardWorkId: 'runner-sync-fixture',
      queuePosition: 1,
      queueHeadHealth: 'task-active',
      waitingTasks: ['ATM-GOV-0256'],
      ownerActorIds: ['release-steward'],
      reason: null,
      cleanupCommand: null
    },
    foreignNonReleaseWip: [],
    foreignBuildInputConflicts: [],
    releaseWip: [],
    ordinaryTaskReleaseAutoStageAllowed: false,
    brokerTicket: null,
    requiredCommand: null,
    orderedCommandManifests: [],
    ...overrides
  };
}

try {
  const admission = fixtureAdmission();
  const receiptInput = {
    cwd: repo,
    admission,
    actorId: 'release-steward',
    actorIdentitySource: 'explicit' as const,
    sealedSourceSha: '1'.repeat(40),
    buildTarget: 'full' as const,
    buildInputsTreeHash: 'sha256:' + 'a'.repeat(64),
    buildDecision: 'cacheHitSkip' as const,
    decisionReason: 'build input tree hash matches release manifests',
    incrementalPlan: null,
    runtimeTelemetryRef: null,
    tsBuildCache: null,
    timings: fixtureTimings()
  };

  // 1. The receipt carries exactly one runnable, governed recovery/release command —
  // no free-text instruction, no external tool, reconstructible byte-for-byte from
  // the same taskId / stewardWorkId / receiptRef triple recorded on the receipt.
  const receipt = buildRunnerSyncReceipt(receiptInput);
  assert.equal(receipt.schemaId, 'atm.runnerSyncReceipt.v1');
  assert.equal(receipt.taskId, 'ATM-GOV-0256');
  assert.equal(receipt.stewardWorkId, 'runner-sync-fixture');
  assert.match(receipt.autoReleaseCommand, /^node atm\.mjs broker runner-sync release --task "ATM-GOV-0256" --steward-work-id "runner-sync-fixture" --receipt-ref ".*" --json$/);
  const expectedReceiptRef = '.atm/history/evidence/ATM-GOV-0256.runner-sync-receipt.json';
  assert.equal(
    receipt.autoReleaseCommand,
    buildRunnerSyncReleaseCommand({ taskId: receipt.taskId, stewardWorkId: receipt.stewardWorkId, receiptRef: expectedReceiptRef }),
    'autoReleaseCommand must be reconstructible from the receipt-recorded triple, not free text'
  );
  assert.equal(receipt.atomicWrite.strategy, 'temp-file-rename-with-retry');

  // 2. Publication lands under the one governed evidence path and nowhere else —
  // no sidecar "manual review" marker, no numbered/duplicate residue.
  const evidenceDir = path.join(repo, '.atm', 'history', 'evidence');
  const relativeInRepo = writeReceiptIntoRepo(repo, receiptInput);
  assert.equal(relativeInRepo, expectedReceiptRef);
  const entries = readdirSync(evidenceDir);
  assert.deepEqual(entries, ['ATM-GOV-0256.runner-sync-receipt.json'], 'exactly one governed receipt file must exist; no manual-review residue');
  const onDisk = JSON.parse(readFileSync(path.join(repo, expectedReceiptRef), 'utf8'));
  assert.equal(onDisk.schemaId, 'atm.runnerSyncReceipt.v1');
  assert.equal(onDisk.buildDecision, 'cacheHitSkip');

  // 3. Re-publishing (e.g. a subsequent no-op revalidation) overwrites the same
  // governed file in place instead of accumulating a second disposition.
  const secondRelative = writeReceiptIntoRepo(repo, { ...receiptInput, decisionReason: 'revalidated no-op' });
  assert.equal(secondRelative, expectedReceiptRef);
  const entriesAfterRepublish = readdirSync(evidenceDir);
  assert.deepEqual(entriesAfterRepublish, ['ATM-GOV-0256.runner-sync-receipt.json'], 'republication must stay a single governed file, not accumulate residue');
  const onDiskAfterRepublish = JSON.parse(readFileSync(path.join(repo, expectedReceiptRef), 'utf8'));
  assert.equal(onDiskAfterRepublish.decisionReason, 'revalidated no-op');

  console.log('[runner-sync-post-close-receipt-publication.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function writeReceiptIntoRepo(cwd: string, input: Parameters<typeof writeRunnerSyncReceipt>[0]): string {
  return writeRunnerSyncReceipt({ ...input, cwd });
}
