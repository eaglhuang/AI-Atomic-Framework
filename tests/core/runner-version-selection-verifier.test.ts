import assert from 'node:assert/strict';
import { buildRunnerRegistrySnapshot } from '../../packages/core/src/broker/runner-registry-snapshot.ts';
import { selectRunnerVersionFromSnapshot, type PublishedRunnerVersion } from '../../packages/core/src/broker/runner-version-registry.ts';
import { verifyRunnerSelection } from '../../packages/core/src/broker/runner-version-selection-verifier.ts';
import type { RunnerSelectionVerificationCase } from '../../packages/core/src/broker/runner-selection-verification-ports.ts';

const baseVersion: PublishedRunnerVersion = {
  sealedSourceSha: 'a'.repeat(40),
  aggregateInputTreeHash: 'sha256:' + '1'.repeat(64),
  publishedSurfaces: ['release/atm-onefile/atm.mjs', 'packages/cli/dist'],
  publishedAt: '2026-07-29T00:00:00.000Z',
  lifecycleState: 'published',
  compatibilityKey: 'runner-abi-1',
  capabilityProof: { validators: ['typecheck'], schemas: ['atm.runnerVersionSelectionReceipt.v1'] }
};

const newerCompatible: PublishedRunnerVersion = {
  ...baseVersion,
  sealedSourceSha: 'b'.repeat(40),
  publishedAt: '2026-07-29T01:00:00.000Z'
};

function caseFor(input: {
  caseId: string;
  versions: readonly PublishedRunnerVersion[];
  requirement?: Partial<Parameters<typeof selectRunnerVersionFromSnapshot>[1]>;
  expectedVerdict?: RunnerSelectionVerificationCase['expectedVerdict'];
  coverageTags?: readonly string[];
}): RunnerSelectionVerificationCase {
  const snapshot = buildRunnerRegistrySnapshot({
    versions: input.versions,
    generatedAt: '2026-07-29T02:00:00.000Z',
    policyVersion: 'runner-selection-policy@0.2.0'
  });
  const receipt = selectRunnerVersionFromSnapshot(snapshot, {
    sealedSourceSha: baseVersion.sealedSourceSha,
    aggregateInputTreeHash: baseVersion.aggregateInputTreeHash,
    requiredSurfaces: ['release/atm-onefile/atm.mjs'],
    compatibilityKey: 'runner-abi-1',
    requiredValidatorCapabilities: ['typecheck'],
    requiredSchemaCapabilities: ['atm.runnerVersionSelectionReceipt.v1'],
    ...input.requirement
  }, '2026-07-29T02:10:00.000Z');
  return {
    caseId: input.caseId,
    description: input.caseId,
    sealedRegistrySnapshot: snapshot,
    receipt,
    expectedVerdict: input.expectedVerdict,
    coverageTags: input.coverageTags
  };
}

const cases: RunnerSelectionVerificationCase[] = [
  caseFor({ caseId: 'highest-trusted-compatible', versions: [baseVersion], expectedVerdict: 'qualified', coverageTags: ['counterfactual', 'highest-trusted-compatible'] }),
  caseFor({ caseId: 'compatible-non-latest', versions: [newerCompatible, baseVersion], expectedVerdict: 'qualified', coverageTags: ['counterfactual', 'compatible-non-latest'] }),
  caseFor({ caseId: 'missing-required-capability', versions: [{ ...baseVersion, capabilityProof: { validators: [], schemas: baseVersion.capabilityProof.schemas } }], expectedVerdict: 'revalidation-required', coverageTags: ['counterfactual', 'missing-required-capability'] }),
  caseFor({ caseId: 'schema-incompatibility', versions: [{ ...baseVersion, capabilityProof: { validators: ['typecheck'], schemas: [] } }], expectedVerdict: 'revalidation-required', coverageTags: ['counterfactual', 'schema-incompatibility'] }),
  {
    ...caseFor({ caseId: 'pending-contract', versions: [baseVersion], expectedVerdict: 'pending-contract', coverageTags: ['counterfactual', 'pending-contract'] }),
    receipt: {
      ...caseFor({ caseId: 'pending-contract-base', versions: [baseVersion] }).receipt,
      policyVersion: undefined,
      registrySnapshotDigest: undefined,
      selection: { ...caseFor({ caseId: 'pending-contract-base-2', versions: [baseVersion] }).receipt.selection, orderedCandidates: undefined }
    }
  },
  {
    ...caseFor({ caseId: 'expired-revalidation-boundary', versions: [baseVersion], expectedVerdict: 'revalidation-required', coverageTags: ['counterfactual', 'expired-revalidation-boundary'] }),
    receipt: {
      ...caseFor({ caseId: 'expired-revalidation-boundary-base', versions: [baseVersion] }).receipt,
      selection: {
        ...caseFor({ caseId: 'expired-revalidation-boundary-base-2', versions: [baseVersion] }).receipt.selection,
        revalidationBoundaryGeneration: '2026-07-29T01:59:59.000Z'
      } as never
    }
  },
  caseFor({ caseId: 'untrusted-lifecycle-state', versions: [{ ...baseVersion, lifecycleState: 'provisional' }], expectedVerdict: 'revalidation-required', coverageTags: ['counterfactual', 'untrusted-lifecycle-state'] })
];

const report = verifyRunnerSelection({
  ports: { readCases: () => cases },
  generatedAt: '2026-07-29T03:00:00.000Z',
  sealedIndependentReport: true
});

assert.equal(report.caseCount, cases.length);
assert.equal(report.verdictCounts.qualified, 2);
assert.equal(report.verdictCounts['pending-contract'], 1);
assert.ok(report.verdictCounts['revalidation-required'] >= 3);
assert.equal(report.metrics.pendingContractFieldGapCounts.policyVersion, 1);
assert.equal(report.promotionPreconditions.promotionAllowed, false);
assert.equal(report.promotionPreconditions.zeroFalseCompatible, true);
assert.ok(report.metrics.perCapabilityCoverage.counterfactual >= cases.length);

const memoryOnlyPorts = { readCases: () => [caseFor({ caseId: 'memory-only', versions: [baseVersion] })] };
assert.equal(verifyRunnerSelection({ ports: memoryOnlyPorts, generatedAt: '2026-07-29T03:00:00.000Z' }).results[0]?.verdict, 'qualified');

console.log('runner-version-selection-verifier.test.ts: 9 cases passed');
