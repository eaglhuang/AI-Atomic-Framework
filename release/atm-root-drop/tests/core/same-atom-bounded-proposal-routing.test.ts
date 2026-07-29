import assert from 'node:assert/strict';
import { evaluateBrokerAdmission } from '../../packages/core/src/broker/admission/evaluate-broker-admission.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../../packages/core/src/broker/types.ts';

const sharedFile = 'packages/cli/src/commands/git.ts';

function activeIntent(range: { lineStart: number; lineEnd: number }): ActiveWriteIntent {
  return {
    intentId: 'active-intent',
    taskId: 'TASK-SKL-0022',
    teamRunId: null,
    actorId: 'skills-captain',
    baseCommit: 'base-sha',
    resourceKeys: {
      files: [sharedFile],
      atomIds: ['atom-cli-router'],
      atomCids: ['cid-cli-router'],
      atomRanges: [{ filePath: sharedFile, ...range, atomCid: 'cid-cli-router' }],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    admission: {
      trigger: 'same-file-overlap-risk',
      state: 'proposal-submitted',
      requiresProposal: true,
      summarySubmitted: true,
      hotFiles: [sharedFile],
      boundedRegions: [{ filePath: sharedFile, ...range }],
      rearbitrationRequired: false,
      reason: 'bounded active proposal'
    },
    leaseEpoch: 1,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-07-24T00:00:00.000Z',
    lane: 'direct-brokered',
    expiresAt: '2999-01-01T00:00:00.000Z'
  };
}

function candidate(range: { lineStart: number; lineEnd: number }): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'ATM-GOV-0264 TDD fixture' },
    taskId: 'ATM-GOV-0263',
    actorId: 'plan31-captain',
    baseCommit: 'base-sha',
    targetFiles: [sharedFile],
    atomRefs: [{
      atomId: 'atom-cli-router',
      atomCid: 'cid-cli-router',
      operation: 'modify',
      sourceRange: { filePath: sharedFile, ...range }
    }],
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: sharedFile, ...range }]
    },
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto'
  };
}

function registry(active: ActiveWriteIntent): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: [active]
  };
}

const bounded = evaluateBrokerAdmission(
  { intent: candidate({ lineStart: 1, lineEnd: 20 }) },
  registry(activeIntent({ lineStart: 80, lineEnd: 100 })),
  {}
);
assert.equal(bounded.disposition, 'compose');
assert.equal(bounded.decision.verdict, 'needs-physical-split');
assert.equal(bounded.trace.arbitrationVerdict, 'watch');
assert.equal(bounded.trace.gates.length, 7);
assert.ok(bounded.trace.gates
  .filter((gate) => gate.gate === 'atom-id' || gate.gate === 'atom-cid' || gate.gate === 'file-range')
  .every((gate) => gate.status !== 'block'));

const collision = evaluateBrokerAdmission(
  { intent: candidate({ lineStart: 90, lineEnd: 110 }) },
  registry(activeIntent({ lineStart: 80, lineEnd: 100 })),
  {}
);
assert.equal(collision.disposition, 'true-conflict');
assert.equal(collision.trace.arbitrationVerdict, 'freeze');
assert.notEqual(collision.decision.verdict, 'parallel-safe');
assert.ok(collision.trace.gates.some((gate) => gate.gate === 'file-range' && gate.status === 'block'));

console.log('same-atom bounded proposal routing fixtures passed');
