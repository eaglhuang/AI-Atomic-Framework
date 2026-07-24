import assert from 'node:assert/strict';
import { evaluateNextClaimAdmissionAdapter } from '../claim-admission.ts';
import type { WriteIntent } from '../../../../../core/src/broker/types.ts';

function intent(targetFiles: readonly string[]): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'generic same-atom replay' },
    taskId: 'CANDIDATE-TASK',
    actorId: 'candidate-actor',
    baseCommit: 'base-sha',
    targetFiles,
    atomRefs: [{ atomId: 'shared-atom', atomCid: 'candidate-cid', operation: 'modify' }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto'
  };
}

const disjoint = evaluateNextClaimAdmissionAdapter({
  candidateIntent: intent(['packages/cli/src/commands/git.ts']),
  conflictTaskId: 'ACTIVE-TASK',
  conflictActorId: 'active-actor',
  conflictFiles: [],
  overlappingAtomIds: ['shared-atom']
});
assert.equal(disjoint.admitted, true);
assert.equal(disjoint.canonical.disposition, 'direct');
assert.notEqual(disjoint.canonical.trace.arbitrationVerdict, 'freeze');

const sameFile = evaluateNextClaimAdmissionAdapter({
  candidateIntent: intent(['packages/cli/src/commands/git.ts']),
  conflictTaskId: 'ACTIVE-TASK',
  conflictActorId: 'active-actor',
  conflictFiles: ['packages/cli/src/commands/git.ts'],
  overlappingAtomIds: ['shared-atom']
});
assert.equal(sameFile.admitted, false);
assert.equal(sameFile.canonical.disposition, 'true-conflict');
assert.equal(sameFile.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');

const authorized = evaluateNextClaimAdmissionAdapter({
  candidateIntent: intent(['packages/cli/src/commands/git.ts']),
  conflictTaskId: 'ACTIVE-TASK',
  conflictActorId: 'active-actor',
  conflictFiles: ['packages/cli/src/commands/git.ts'],
  overlappingAtomIds: ['shared-atom'],
  resolutionAuthorizedForeignTaskIds: new Set(['ACTIVE-TASK'])
});
assert.equal(authorized.admitted, true);
assert.equal(authorized.canonical.disposition, 'direct');

console.log('[same-atom-proposal-admission.test] ok');

const boundedIntent: WriteIntent = {
  ...intent(['packages/cli/src/commands/git.ts']),
  atomRefs: [{
    atomId: 'shared-atom',
    atomCid: 'candidate-cid',
    operation: 'modify',
    sourceRange: {
      filePath: 'packages/cli/src/commands/git.ts',
      lineStart: 1,
      lineEnd: 10
    }
  }],
  proposalAdmission: {
    trigger: 'same-file-overlap-risk',
    summarySubmitted: true,
    boundedRegions: [{
      filePath: 'packages/cli/src/commands/git.ts',
      lineStart: 1,
      lineEnd: 10
    }]
  }
};
const bounded = evaluateNextClaimAdmissionAdapter({
  candidateIntent: boundedIntent,
  conflictTaskId: 'ACTIVE-TASK',
  conflictActorId: 'active-actor',
  conflictFiles: ['packages/cli/src/commands/git.ts'],
  overlappingAtomIds: ['shared-atom'],
  conflictBoundedRegions: [{
    filePath: 'packages/cli/src/commands/git.ts',
    lineStart: 80,
    lineEnd: 100
  }]
});
assert.equal(bounded.admitted, true);
assert.equal(bounded.canonical.disposition, 'compose');
