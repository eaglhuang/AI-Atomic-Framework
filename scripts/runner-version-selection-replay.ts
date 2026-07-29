#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { buildRunnerRegistrySnapshot } from '../packages/core/src/broker/runner-registry-snapshot.ts';
import { selectRunnerVersionFromSnapshot, type PublishedRunnerVersion } from '../packages/core/src/broker/runner-version-registry.ts';
import { verifyRunnerSelection } from '../packages/core/src/broker/runner-version-selection-verifier.ts';
import type { RunnerSelectionVerificationCase } from '../packages/core/src/broker/runner-selection-verification-ports.ts';

const generatedAt = new Date().toISOString();

const baseVersion: PublishedRunnerVersion = {
  sealedSourceSha: 'a'.repeat(40),
  aggregateInputTreeHash: 'sha256:' + '1'.repeat(64),
  publishedSurfaces: ['release/atm-onefile/atm.mjs', 'packages/cli/dist'],
  publishedAt: '2026-07-29T00:00:00.000Z',
  lifecycleState: 'published',
  compatibilityKey: 'runner-abi-1',
  capabilityProof: { validators: ['typecheck'], schemas: ['atm.runnerVersionSelectionReceipt.v1'] }
};

function replayCase(caseId: string, versions: readonly PublishedRunnerVersion[], expectedVerdict: RunnerSelectionVerificationCase['expectedVerdict'], tags: readonly string[]): RunnerSelectionVerificationCase {
  const snapshot = buildRunnerRegistrySnapshot({
    versions,
    generatedAt: '2026-07-29T02:00:00.000Z',
    policyVersion: 'runner-selection-policy@0.2.0'
  });
  return {
    caseId,
    description: caseId,
    expectedVerdict,
    coverageTags: ['counterfactual', ...tags],
    sealedRegistrySnapshot: snapshot,
    receipt: selectRunnerVersionFromSnapshot(snapshot, {
      sealedSourceSha: baseVersion.sealedSourceSha,
      aggregateInputTreeHash: baseVersion.aggregateInputTreeHash,
      requiredSurfaces: ['release/atm-onefile/atm.mjs'],
      compatibilityKey: 'runner-abi-1',
      requiredValidatorCapabilities: ['typecheck'],
      requiredSchemaCapabilities: ['atm.runnerVersionSelectionReceipt.v1']
    }, '2026-07-29T02:10:00.000Z')
  };
}

const cases = [
  replayCase('highest-trusted-compatible', [baseVersion], 'qualified', ['highest-trusted-compatible']),
  replayCase('compatible-non-latest-selection', [{ ...baseVersion, sealedSourceSha: 'b'.repeat(40), publishedAt: '2026-07-29T03:00:00.000Z' }, baseVersion], 'qualified', ['compatible-non-latest']),
  replayCase('missing-required-capability', [{ ...baseVersion, capabilityProof: { validators: [], schemas: baseVersion.capabilityProof.schemas } }], 'revalidation-required', ['missing-required-capability']),
  replayCase('schema-incompatibility', [{ ...baseVersion, capabilityProof: { validators: ['typecheck'], schemas: [] } }], 'revalidation-required', ['schema-incompatibility']),
  replayCase('untrusted-lifecycle-state', [{ ...baseVersion, lifecycleState: 'provisional' }], 'revalidation-required', ['untrusted-lifecycle-state'])
];

const pending = replayCase('pending-contract-field-gap', [baseVersion], 'pending-contract', ['pending-contract']);
cases.push({
  ...pending,
  receipt: {
    ...pending.receipt,
    policyVersion: undefined,
    registrySnapshotDigest: undefined,
    selection: { ...pending.receipt.selection, orderedCandidates: undefined }
  }
});

const expired = replayCase('newer-runner-input-segment-revalidation', [baseVersion], 'revalidation-required', ['newer-runner-input-segment']);
cases.push({
  ...expired,
  receipt: {
    ...expired.receipt,
    selection: { ...expired.receipt.selection, revalidationBoundaryGeneration: '2026-07-29T01:59:59.000Z' } as never
  }
});

const report = verifyRunnerSelection({
  ports: { readCases: () => cases },
  generatedAt,
  sealedIndependentReport: true,
  ownerApprovedPromotionRecord: false
});

const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
if (outputArg) {
  writeFileSync(outputArg.slice('--out='.length), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
