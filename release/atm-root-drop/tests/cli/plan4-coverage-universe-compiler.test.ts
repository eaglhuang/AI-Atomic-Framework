import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  CoverageUniverseCompiler,
  compileCoverageUniverse,
  COVERAGE_UNIVERSE_COMPILER_ID,
  COVERAGE_UNIVERSE_SCHEMA_ID,
  type CoverageUniverseCompileInput
} from '../../packages/core/src/evidence/coverage-universe-compiler.ts';

const baseInput: CoverageUniverseCompileInput = {
  universeId: 'plan4-foundation',
  generatedAt: '2026-07-31T00:00:00.000Z',
  model: {
    modelId: 'atm.plan4.coverage-model',
    modelVersion: '0.1.0',
    modelDigest: 'sha256:model'
  },
  obligations: [
    {
      semanticKey: 'claim adapter honors broker lane decision',
      semanticFamily: 'claim-adapter',
      owningSeam: 'atm.claimLifecyclePreflightTransaction.v1',
      reachabilityStatus: 'reachable',
      sourceRefs: [{ kind: 'file', ref: 'packages/cli/src/commands/tasks/claim-orchestrator.ts' }],
      validatorRefs: [{ command: 'node --strip-types tests/cli/lane-claim-conflict-matrix.test.ts', caseId: 'claim-lane-matrix' }],
      description: 'Claim adapter must not override broker lane authority.'
    },
    {
      semanticKey: 'commit adapter preserves foreign WIP',
      semanticFamily: 'commit-adapter',
      owningSeam: 'atm.scopedCommitForeignWork.v1',
      reachabilityStatus: 'unreachable',
      sourceRefs: [{ kind: 'file', ref: 'packages/cli/src/commands/git-governance/implementation.ts' }]
    },
    {
      semanticKey: 'unsupported remote browser seam',
      semanticFamily: 'browser-adapter',
      owningSeam: 'atm.externalBrowserAutomation.v1',
      reachabilityStatus: 'unsupported',
      sourceRefs: [{ kind: 'seam', ref: 'external-browser' }]
    },
    {
      semanticKey: 'owner-declared non-goal',
      semanticFamily: 'plan-scope',
      owningSeam: 'atm.plan4.modelBoundary.v1',
      reachabilityStatus: 'excluded',
      exclusionReason: 'Out of Plan 4.0 R1 scope.'
    },
    {
      semanticKey: 'legacy skill projection coverage',
      semanticFamily: 'skill-entry',
      owningSeam: 'atm.skillProjection.v1',
      reachabilityStatus: 'unknown'
    }
  ]
};

const compiled = compileCoverageUniverse(baseInput);
const reordered = new CoverageUniverseCompiler().compile({
  ...baseInput,
  generatedAt: '2026-07-31T01:00:00.000Z',
  obligations: [...baseInput.obligations].reverse()
});

assert.equal(compiled.schemaId, COVERAGE_UNIVERSE_SCHEMA_ID);
assert.equal(compiled.compilerId, COVERAGE_UNIVERSE_COMPILER_ID);
assert.equal(compiled.entries.length, 5);
assert.equal(compiled.universeDigest, reordered.universeDigest, 'input order and generatedAt must not change semantic universe digest');
assert.deepEqual(
  compiled.entries.map((entry) => entry.obligationId),
  reordered.entries.map((entry) => entry.obligationId),
  'canonical obligation ids must be stable under input ordering'
);
assert(compiled.entries.every((entry) => entry.obligationId.startsWith('atm.obligation:')));
assert(compiled.entries.some((entry) => entry.obligationId.includes('claim-adapter')));
assert.deepEqual(compiled.reachabilitySummary, {
  reachable: 1,
  unreachable: 1,
  unsupported: 1,
  excluded: 1,
  unknown: 1
});
assert.equal(compiled.obligationInventory.entries.length, compiled.entries.length);
assert.equal(compiled.gapCandidates.length, 4, 'all non-reachable obligations must be consumable gap/candidate records');
assert(compiled.gapCandidates.some((entry) => entry.reachabilityStatus === 'unreachable' && entry.reason.includes('no reachable validator')));
assert(compiled.gapCandidates.some((entry) => entry.reachabilityStatus === 'unsupported'));
assert(compiled.gapCandidates.some((entry) => entry.reachabilityStatus === 'excluded'));
assert(compiled.gapCandidates.some((entry) => entry.reachabilityStatus === 'unknown'));
assert(compiled.gapCandidates.every((entry) => entry.candidateTestCaseId.startsWith('test_candidate_')));

const schemaText = readFileSync('schemas/evidence/coverage-universe.schema.json', 'utf8');
assert(schemaText.includes('"atm.coverageUniverse.v1"'));
assert(schemaText.includes('"reachable"'));
assert(schemaText.includes('"unsupported"'));

const catalogText = readFileSync('tests/catalog/groups/test_group_plan4_coverage_universe.shard.json', 'utf8');
assert(catalogText.includes('test_atm_gov_0280_coverage_universe_canonical_ids_dfd2a214'));
assert(catalogText.includes('test_atm_gov_0280_reachability_status_mapping_f54a35be'));

console.log(JSON.stringify({
  marker: '[plan4-coverage-universe-compiler:test] ok',
  universeDigest: compiled.universeDigest,
  obligationIds: compiled.entries.map((entry) => entry.obligationId),
  gapCandidates: compiled.gapCandidates.map((entry) => entry.reachabilityStatus)
}));
