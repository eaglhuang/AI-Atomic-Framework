/**
 * ATM-BUG-2026-07-13-160 — claim admission must consume matching
 * atm.brokerConflictResolution.v1 artifacts like the governed commit lane.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBrokerConflictResolutionArtifact } from '../../../../../core/src/team-runtime/permission-broker.ts';
import {
  collectResolutionAuthorizedForeignTaskIds,
  readResolutionAuthorizedForeignTaskIds
} from '../../broker-conflict-resolution.ts';
import {
  deriveBrokerVerdict,
  deriveCidVerdict,
  evaluateClaimAdmission,
  resolveEffectiveShouldBlockPerCid
} from '../claim-admission.ts';

const candidateTaskId = 'TASK-AAO-FABLE-004';
const conflictingTaskId = 'TASK-AAO-FABLE-005';
const wrongConflictTaskId = 'TASK-AAO-FABLE-009';

function createRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'claim-broker-resolution-'));
}

function writeResolutionArtifact(
  cwd: string,
  artifact: ReturnType<typeof createBrokerConflictResolutionArtifact>,
  fileName?: string
): string {
  const relativePath = path.join(
    '.atm',
    'runtime',
    'broker-conflict-resolutions',
    fileName ?? `${artifact.resolutionId}.json`
  ).replace(/\\/g, '/');
  mkdirSync(path.dirname(path.join(cwd, relativePath)), { recursive: true });
  writeFileSync(path.join(cwd, relativePath), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return relativePath;
}

function evaluateCidFreezeAdmission(input: {
  readonly cwd: string;
  readonly resolutionAuthorizedForeignTaskIds?: ReadonlySet<string>;
}) {
  const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
    claimIntent: 'write',
    activeWriteConflict: true,
    confirmedBrokerConflict: false,
    insufficientMutationIntent: true,
    overlappingAtomIdCount: 1
  });
  const effectiveShouldBlockPerCid = resolveEffectiveShouldBlockPerCid({
    shouldBlockPerCid,
    conflictingTaskId,
    resolutionAuthorizedForeignTaskIds: input.resolutionAuthorizedForeignTaskIds
  });
  const brokerVerdict = deriveBrokerVerdict({
    queuedPrivateWork: false,
    shouldBlockPerCid: effectiveShouldBlockPerCid
  });
  return evaluateClaimAdmission({
    brokerVerdict,
    cidVerdict,
    candidateTaskId,
    conflictingTaskId,
    overlappingAtomIds: ['atm.next-command-atomic-map']
  });
}

const repo = createRepo();

try {
  // --- no artifact → freeze ---
  const noArtifactAuthorized = collectResolutionAuthorizedForeignTaskIds(repo, candidateTaskId);
  assert.equal(noArtifactAuthorized.size, 0);
  const frozen = evaluateCidFreezeAdmission({
    cwd: repo,
    resolutionAuthorizedForeignTaskIds: noArtifactAuthorized
  });
  assert.equal(frozen.admitted, false);
  assert.equal(frozen.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
  assert.match(frozen.blockReason ?? '', /freeze/i);

  // --- matching BCR → admit ---
  const matchingRepo = createRepo();
  try {
    const matchingArtifact = createBrokerConflictResolutionArtifact({
      primaryTaskId: candidateTaskId,
      conflictingTaskIds: [conflictingTaskId],
      sharedPaths: ['packages/cli/src/commands/next.ts'],
      decisionReason: 'broker-conflict-blocked until the release order grants the next task.'
    });
    const matchingPath = writeResolutionArtifact(matchingRepo, matchingArtifact);
    const matchingAuthorized = collectResolutionAuthorizedForeignTaskIds(matchingRepo, candidateTaskId);
    assert.ok(matchingAuthorized.has(conflictingTaskId.toUpperCase()));
    assert.deepEqual(
      [...readResolutionAuthorizedForeignTaskIds(matchingRepo, matchingPath, candidateTaskId)],
      [conflictingTaskId.toUpperCase()]
    );
    const admitted = evaluateCidFreezeAdmission({
      cwd: matchingRepo,
      resolutionAuthorizedForeignTaskIds: matchingAuthorized
    });
    assert.equal(admitted.admitted, true);
    assert.equal(admitted.blockCode, null);
  } finally {
    rmSync(matchingRepo, { recursive: true, force: true });
  }

  // --- wrong-pair artifact → still freeze ---
  const wrongPairRepo = createRepo();
  try {
    const wrongPairArtifact = createBrokerConflictResolutionArtifact({
      primaryTaskId: candidateTaskId,
      conflictingTaskIds: [wrongConflictTaskId],
      sharedPaths: ['packages/cli/src/commands/next.ts'],
      decisionReason: 'broker-conflict-blocked for an unrelated pair.'
    });
    writeResolutionArtifact(wrongPairRepo, wrongPairArtifact);
    const wrongPairAuthorized = collectResolutionAuthorizedForeignTaskIds(wrongPairRepo, candidateTaskId);
    assert.ok(!wrongPairAuthorized.has(conflictingTaskId.toUpperCase()));
    const stillFrozen = evaluateCidFreezeAdmission({
      cwd: wrongPairRepo,
      resolutionAuthorizedForeignTaskIds: wrongPairAuthorized
    });
    assert.equal(stillFrozen.admitted, false);
    assert.equal(stillFrozen.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
  } finally {
    rmSync(wrongPairRepo, { recursive: true, force: true });
  }

  console.log('[claim-broker-resolution.spec] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
