import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  compileRunbookCompletion
} from '../../scripts/compile-runbook-completion-evidence.ts';
import {
  canonicalWaveExitReceiptPath,
  consumeWaveExitObserverReceipt,
  consumeWaveExitObserverReceiptCandidates,
  deriveBasisIdentityFromEvidence,
  digestWaveExitObserverInputsAtCommit,
  digestText,
  digestWaveExitObserverPolicy,
  digestWaveExitObserverPolicySource,
  loadWaveExitObserverPolicy,
  loadWaveExitObserverPolicyAtCommit,
  resolveWaveExitBasisProducer,
  WAVE_EXIT_OBSERVER_POLICY_PATH,
  WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID,
  WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_PATH
} from '../../packages/core/src/evidence/wave-exit-observer-receipt.ts';

const hex = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;
const commit = (seed: string): string => seed.repeat(40).slice(0, 40);
const observedHead = commit('1');
const compilationHead = commit('2');
const policy = loadWaveExitObserverPolicy();
const headAtTestStart = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(loadWaveExitObserverPolicyAtCommit('.', headAtTestStart)?.schemaId, 'atm.waveExitObserverPolicy.v1');
assert.deepEqual(digestWaveExitObserverInputsAtCommit('.', ['schemas/evidence/wave-exit-observer-policy.json'], headAtTestStart), {
  'schemas/evidence/wave-exit-observer-policy.json': digestText(execFileSync(
    'git', ['show', `${headAtTestStart}:${WAVE_EXIT_OBSERVER_POLICY_PATH}`], { encoding: 'utf8' }
  ))
});
assert.equal(loadWaveExitObserverPolicyAtCommit('.', '0'.repeat(40)), null, 'missing historical policy must stay fail-closed');
const policySource = readFileSync(WAVE_EXIT_OBSERVER_POLICY_PATH, 'utf8');
const policyDigest = digestWaveExitObserverPolicy(policy, policySource);
assert.equal(policy.basisActorResolution, 'active-claim-holder');
assert.deepEqual([...policy.basisEvidenceOwners], ['ATM-GOV-0341']);
assert.notEqual(
  digestText(JSON.stringify(policy)),
  policyDigest,
  'compact JSON.stringify(policy) is not the sealed git-show digest'
);
assert.equal(digestWaveExitObserverPolicySource(policySource), policyDigest);

const claimHolder = resolveWaveExitBasisProducer({
  repoRoot: '.',
  policy,
  readClaimHolder: () => 'cursor-captain',
  readEvidenceActors: () => ['codex-gpt-5.4-mini', 'codex-captain-recovery', 'cursor-captain']
});
assert.deepEqual(claimHolder.actorIds, ['cursor-captain']);

const historicalClaimHolder = resolveWaveExitBasisProducer({
  repoRoot: '.',
  policy,
  basisCommit: observedHead,
  readClaimHolder: () => 'codex-captain',
  readClaimHolderAtCommit: (_taskId, commitAtObservation) => commitAtObservation === observedHead ? 'cursor-captain' : null
});
assert.deepEqual(
  historicalClaimHolder.actorIds,
  ['cursor-captain'],
  'receipt consumption must resolve authority at observedHead, not from a later handoff'
);

const unionActors = resolveWaveExitBasisProducer({
  repoRoot: '.',
  policy: { ...policy, basisActorResolution: 'unique-evidence-actor' },
  readEvidenceActors: () => ['codex-gpt-5.4-mini', 'codex-captain-recovery', 'cursor-captain']
});
assert.equal(unionActors.actorIds.length, 3);
const inputPath = policy.exits['EXIT-02'].inputs[0];
const inputDigest = hex('a');

const legalReceipt = {
  schemaId: WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID,
  schemaVersion: '0.1.0',
  exitItemId: 'EXIT-02',
  wave: 'Wave 1',
  observerActor: 'gemini-wave-exit-observer',
  observerRole: 'wave-exit-observer.gemini',
  declaredBasisActor: 'wave-1-basis-producer',
  independenceVerdict: 'independent' as const,
  command: policy.exits['EXIT-02'].command,
  exitCode: 0,
  stdoutDigest: hex('b'),
  stderrDigest: hex('0'),
  observedAt: '2026-08-16T00:00:00.000Z',
  observedHead,
  policyDigest,
  inputDigests: [{ path: inputPath, digest: inputDigest }],
  artifactPath: canonicalWaveExitReceiptPath(policy, 'EXIT-02')
};

const consume = (receipt: unknown, overrides: Record<string, unknown> = {}) => consumeWaveExitObserverReceipt({
  receipt,
  policy,
  compilationHead,
  derivedBasis: deriveBasisIdentityFromEvidence({
    producerActors: ['wave-1-basis-producer'],
    producerRole: policy.basisProducerRole
  }),
  currentInputDigests: { [inputPath]: inputDigest },
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  policyDigestAtCompilationHead: policyDigest,
  readPolicySourceAtCommit: () => policySource,
  ...overrides
});

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(JSON.parse(readFileSync(WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_PATH, 'utf8')));
assert.equal(validateSchema(legalReceipt), true, 'legal receipt must match the published schema');
assert.equal(policy.schemaId, 'atm.waveExitObserverPolicy.v1');
assert.equal(policy.compilerCommandPath, 'scripts/compile-runbook-completion-evidence.ts');
assert.equal(policy.exits['EXIT-02'].observerRole, 'wave-exit-observer.gemini');
assert.equal(policy.exits['EXIT-04'].observerRole, 'wave-exit-observer.claude');
assert.equal(policy.exits['EXIT-07'].observerRole, 'wave-exit-observer.codex-sidecar');
assert.equal(policy.exits['EXIT-11'].command.includes('review-runbook-release-authority'), true);
assert.equal(policy.exits['EXIT-02'].command.includes('compile-runbook-completion-evidence'), false);

const proven = consume(legalReceipt);
assert.equal(proven.status, 'proven');
assert.deepEqual(proven.diagnostics, []);
assert.equal(proven.canonicalArtifactPath, 'docs/reports/wave-exit-observer-receipts/EXIT-02.json');

const evolvedPolicy = {
  ...policy,
  roles: {
    ...policy.roles,
    'wave-exit-observer.unrelated': { kind: 'observer' as const, executor: 'unrelated' }
  }
};
const evolvedPolicySource = `${JSON.stringify(evolvedPolicy, null, 2)}\n`;
const evolvedPolicyDigest = digestWaveExitObserverPolicySource(evolvedPolicySource);
const legacyReceiptAfterUnrelatedRoleAddition = consumeWaveExitObserverReceipt({
  receipt: legalReceipt,
  policy: evolvedPolicy,
  compilationHead,
  derivedBasis: deriveBasisIdentityFromEvidence({
    producerActors: ['wave-1-basis-producer'],
    producerRole: evolvedPolicy.basisProducerRole
  }),
  currentInputDigests: { [inputPath]: inputDigest },
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  policyDigestAtCompilationHead: evolvedPolicyDigest,
  readPolicySourceAtCommit: () => policySource
});
assert.equal(legacyReceiptAfterUnrelatedRoleAddition.status, 'proven', 'unrelated role addition preserves legacy receipt');

const changedExitPolicy = {
  ...evolvedPolicy,
  exits: {
    ...evolvedPolicy.exits,
    'EXIT-02': { ...evolvedPolicy.exits['EXIT-02'], observerRole: 'wave-exit-observer.claude' }
  }
};
const changedExitPolicySource = `${JSON.stringify(changedExitPolicy, null, 2)}\n`;
const changedExitPolicyVerdict = consumeWaveExitObserverReceipt({
  receipt: legalReceipt,
  policy: changedExitPolicy,
  compilationHead,
  derivedBasis: deriveBasisIdentityFromEvidence({
    producerActors: ['wave-1-basis-producer'],
    producerRole: changedExitPolicy.basisProducerRole
  }),
  currentInputDigests: { [inputPath]: inputDigest },
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  policyDigestAtCompilationHead: digestWaveExitObserverPolicySource(changedExitPolicySource),
  readPolicySourceAtCommit: () => policySource
});
assert.equal(changedExitPolicyVerdict.status, 'unproven', 'changed EXIT role rejects legacy receipt');
assert.ok(changedExitPolicyVerdict.diagnostics.includes('observer-role-mismatch'));

const changedGlobalPolicy = {
  ...evolvedPolicy,
  compilerCommandPath: 'scripts/other-compiler.ts'
};
const changedGlobalPolicySource = `${JSON.stringify(changedGlobalPolicy, null, 2)}\n`;
const changedGlobalPolicyVerdict = consumeWaveExitObserverReceipt({
  receipt: legalReceipt,
  policy: changedGlobalPolicy,
  compilationHead,
  derivedBasis: deriveBasisIdentityFromEvidence({
    producerActors: ['wave-1-basis-producer'],
    producerRole: changedGlobalPolicy.basisProducerRole
  }),
  currentInputDigests: { [inputPath]: inputDigest },
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  policyDigestAtCompilationHead: digestWaveExitObserverPolicySource(changedGlobalPolicySource),
  readPolicySourceAtCommit: () => policySource
});
assert.equal(changedGlobalPolicyVerdict.status, 'unproven', 'changed global compiler contract rejects legacy receipt');
assert.ok(changedGlobalPolicyVerdict.diagnostics.includes('receipt-stale'));

const malformedHistoricalPolicy = consume(legalReceipt, { readPolicySourceAtCommit: () => '{' });
assert.equal(malformedHistoricalPolicy.status, 'unproven');
assert.ok(malformedHistoricalPolicy.diagnostics.includes('historical-policy-invalid'));
const missingHistoricalPolicy = consume(legalReceipt, { readPolicySourceAtCommit: () => null });
assert.equal(missingHistoricalPolicy.status, 'unproven');
assert.ok(missingHistoricalPolicy.diagnostics.includes('historical-policy-invalid'));

const uniqueCandidate = consumeWaveExitObserverReceiptCandidates({
  repoRoot: '.',
  receipts: [legalReceipt],
  policy,
  compilationHead,
  currentInputDigests: { [inputPath]: inputDigest },
  policyDigestAtCompilationHead: policyDigest,
  readPolicySourceAtCommit: () => policySource,
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  basisActors: ['wave-1-basis-producer']
});
assert.equal(uniqueCandidate.receipt?.exitItemId, 'EXIT-02');
assert.deepEqual(uniqueCandidate.diagnostics, []);
const ambiguousCandidates = consumeWaveExitObserverReceiptCandidates({
  repoRoot: '.',
  receipts: [legalReceipt, legalReceipt],
  policy,
  compilationHead,
  currentInputDigests: { [inputPath]: inputDigest },
  policyDigestAtCompilationHead: policyDigest,
  readPolicySourceAtCommit: () => policySource,
  isAncestor: (ancestor, descendant) => ancestor === observedHead && descendant === compilationHead,
  basisActors: ['wave-1-basis-producer']
});
assert.equal(ambiguousCandidates.receipt, null);
assert.deepEqual(ambiguousCandidates.diagnostics, ['receipt-ambiguity']);

const equalHeadStillValid = consume(legalReceipt, {
  compilationHead: observedHead,
  isAncestor: (ancestor: string, descendant: string) => ancestor === descendant
});
assert.equal(equalHeadStillValid.status, 'proven', 'observedHead may equal compilationHead because it is still an ancestor');

const missing = consume({ ...legalReceipt, observedHead: undefined });
assert.equal(missing.status, 'unproven');
assert.ok(missing.diagnostics.includes('missing-field'));

const schemaMismatch = consume({ ...legalReceipt, schemaId: 'atm.not.a.receipt.v1' });
assert.equal(schemaMismatch.status, 'unproven');
assert.ok(schemaMismatch.diagnostics.includes('schema-mismatch'));

const unapproved = consume({ ...legalReceipt, command: 'node --strip-types scripts/compile-runbook-completion-evidence.ts --mode validate' });
assert.equal(unapproved.status, 'unproven');
assert.ok(unapproved.diagnostics.includes('unapproved-command'));
assert.ok(unapproved.diagnostics.includes('compiler-command-forbidden'));

const actorConflict = consume(legalReceipt, {
  derivedBasis: deriveBasisIdentityFromEvidence({
    producerActors: ['gemini-wave-exit-observer'],
    producerRole: policy.basisProducerRole
  })
});
assert.equal(actorConflict.status, 'unproven');
assert.ok(actorConflict.diagnostics.includes('observer-basis-actor-conflict'));

const declaredMismatch = consume({ ...legalReceipt, declaredBasisActor: 'forged-basis' });
assert.equal(declaredMismatch.status, 'unproven');
assert.ok(declaredMismatch.diagnostics.includes('declared-basis-actor-mismatch'));

const unreachable = consume(legalReceipt, { isAncestor: () => false });
assert.equal(unreachable.status, 'unproven');
assert.ok(unreachable.diagnostics.includes('target-head-unreachable'));

const stalePolicy = consume({ ...legalReceipt, policyDigest: hex('f') });
assert.equal(stalePolicy.status, 'unproven');
assert.ok(stalePolicy.diagnostics.includes('receipt-stale'));

const digestDrift = consume(legalReceipt, { currentInputDigests: { [inputPath]: hex('c') } });
assert.equal(digestDrift.status, 'unproven');
assert.ok(digestDrift.diagnostics.includes('input-digest-drift'));

const unresolvedBasis = consume(legalReceipt, {
  derivedBasis: deriveBasisIdentityFromEvidence({ producerActors: [], producerRole: policy.basisProducerRole })
});
assert.equal(unresolvedBasis.status, 'unproven');
assert.ok(unresolvedBasis.diagnostics.includes('basis-actor-unresolved'));

const twoWaveSource = [
  '## Wave 0 — Preserve',
  '- [x] freeze requirement',
  '退出條件：freeze exit',
  '## Wave 1 — Restore',
  '退出條件：restore exit'
].join('\n');
const mappedReceipt = { ...legalReceipt, exitItemId: 'EXIT-02', wave: 'Wave 1' };
const compilerWithMappedExit = compileRunbookCompletion(
  twoWaveSource,
  compilationHead,
  compilationHead,
  compilationHead,
  { proven: true, diagnostics: [] },
  '2026-08-16T00:00:00.000Z',
  [],
  ['docs/reports/plan-3x-4x-runbook-completion-evidence.json'],
  {
    policy,
    receipts: { 'EXIT-02': mappedReceipt },
    currentInputDigests: { [inputPath]: inputDigest },
    policyDigestAtCompilationHead: policyDigest,
    basisActorsByWave: { 'Wave 1': ['wave-1-basis-producer'] },
    repoRoot: process.cwd(),
    isAncestor: (ancestor: string, descendant: string) => ancestor === observedHead && descendant === compilationHead,
    readPolicySourceAtCommit: () => policySource
  }
);
const exit02 = compilerWithMappedExit.waveExits.find((row) => row.itemId === 'EXIT-02');
assert.equal(exit02?.status, 'proven');
assert.equal(exit02?.diagnostics.length, 0);
assert.equal(exit02?.evidence.some((tuple) => tuple.command === policy.exits['EXIT-02'].command), true);

const illegalCompiler = compileRunbookCompletion(
  twoWaveSource,
  compilationHead,
  compilationHead,
  compilationHead,
  { proven: true, diagnostics: [] },
  '2026-08-16T00:00:00.000Z',
  [],
  ['docs/reports/plan-3x-4x-runbook-completion-evidence.json'],
  {
    policy,
    receipts: {
      'EXIT-02': {
        ...mappedReceipt,
        command: 'node --strip-types scripts/compile-runbook-completion-evidence.ts --mode validate'
      }
    },
    currentInputDigests: { [inputPath]: inputDigest },
    policyDigestAtCompilationHead: policyDigest,
    basisActorsByWave: { 'Wave 1': ['wave-1-basis-producer'] },
    repoRoot: process.cwd(),
    isAncestor: (ancestor: string, descendant: string) => ancestor === observedHead && descendant === compilationHead,
    readPolicySourceAtCommit: () => policySource
  }
);
const illegalExit = illegalCompiler.waveExits.find((row) => row.itemId === 'EXIT-02');
assert.equal(illegalExit?.status, 'unproven');
assert.ok(illegalExit?.diagnostics.includes('compiler-command-forbidden'));

assert.equal(readFileSync(WAVE_EXIT_OBSERVER_POLICY_PATH, 'utf8').includes('"EXIT-02"'), true);
console.log(`wave-exit-observer-receipt fixtures: legal proven, illegal fail-closed; sealedPolicyDigest=${policyDigest}`);
