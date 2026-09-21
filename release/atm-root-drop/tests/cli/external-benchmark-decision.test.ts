import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, canonicalJsonSha256, collectMissingPrerequisites, executeExternalBenchmark } from '../../scripts/lib/external-benchmark/runner.ts';

const unavailablePrerequisites = {
  publicNpm: { sealed: true, evidenceDigest: `sha256:${'a'.repeat(64)}` },
  hiddenCorpusAcceptance: { sealed: true, evidenceDigest: `sha256:${'b'.repeat(64)}` },
  independentAdjudication: { sealed: true, evidenceDigest: `sha256:${'c'.repeat(64)}` },
  providerTelemetry: { sealed: true, evidenceDigest: `sha256:${'d'.repeat(64)}` }
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) => `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
assert.equal(canonicalJson({ z: [2, { b: true, a: null }], a: 1 }), '{"a":1,"z":[2,{"a":null,"b":true}]}');
assert.equal(canonicalJsonSha256({ a: 1 }), digest({ a: 1 }));
const signed = <T extends Record<string, unknown>>(value: T): T & { signature: string; publicKeyPem: string } => {
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const signature = sign(null, Buffer.from(stableJson(value)), keyPair.privateKey).toString('base64');
  return { ...value, publicKeyPem, signature };
};
const preregistrationDigest = `sha256:${'e'.repeat(64)}`;
const preRunOnlyProtocol = {
  arms: { atm: { packageAvailability: 'sealed' as const, packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } },
  executionPrerequisites: {
    publicNpm: { sealed: true, evidenceDigest: `sha256:${'a'.repeat(64)}` },
    hiddenCorpusAcceptance: { sealed: true, evidenceDigest: `sha256:${'b'.repeat(64)}` },
    independentAdjudication: { sealed: false, evidenceDigest: null },
    providerTelemetry: { sealed: false, evidenceDigest: null }
  },
  runEligibility: { phase: 'pre-run' as const, eligible: true, blockingReasons: [] }
};
assert.deepEqual(collectMissingPrerequisites(preRunOnlyProtocol, 'pre-run'), []);
assert.deepEqual(collectMissingPrerequisites(preRunOnlyProtocol, 'final-decision'), ['independentAdjudication', 'providerTelemetry']);
const providerRawExport = Buffer.from('provider export');
const verifiedArtifacts = {
  hiddenCorpusAcceptance: signed({ schemaId: 'atm.hiddenCorpusAcceptance.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'hidden-corpus-custodian', signerId: 'custodian', corpusId: 'corpus-1', corpusDigest: `sha256:${'1'.repeat(64)}`, visibility: 'oracle-only', acceptedAt: '2026-08-30T00:00:00.000Z' }),
  independentAdjudication: signed({ schemaId: 'atm.adjudicationManifest.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'independent-adjudicator', signerId: 'adjudicator', hiddenCorpusOwner: 'custodian', inputDigest: `sha256:${'2'.repeat(64)}`, outputDigest: `sha256:${'3'.repeat(64)}`, labeledAt: '2026-08-30T00:00:00.000Z' }),
  providerTelemetry: signed({ schemaId: 'atm.providerCostTelemetry.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'provider-telemetry', signerId: 'billing-export', provider: 'provider', observedAt: '2026-08-30T00:00:00.000Z', rawExportSha256: `sha256:${createHash('sha256').update(providerRawExport).digest('hex')}`, runIds: ['baseline-ab', 'atm-ab'] }),
  providerRawExport
};
const prerequisites = {
  publicNpm: { sealed: true, evidenceDigest: `sha256:${'a'.repeat(64)}` },
  hiddenCorpusAcceptance: { sealed: true, evidenceDigest: digest(verifiedArtifacts.hiddenCorpusAcceptance) },
  independentAdjudication: { sealed: true, evidenceDigest: digest(verifiedArtifacts.independentAdjudication) },
  providerTelemetry: { sealed: true, evidenceDigest: digest(verifiedArtifacts.providerTelemetry) }
};
const protocolBase = {
  protocolVersion: '1.0.0',
  preregistrationDigest,
  oracle: { hiddenCorpusOwner: 'custodian', adjudicator: 'adjudicator', baselineImplementer: 'baseline-operator', atmImplementer: 'atm-operator' },
  arms: { atm: { packageAvailability: 'sealed' as const, packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } },
  executionPrerequisites: prerequisites,
  runEligibility: { eligible: true, blockingReasons: [] }
};
const unavailable = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'unavailable', packageVersion: null, packageTarballSha256: null, workspaceLink: false } }, executionPrerequisites: unavailablePrerequisites, runEligibility: { eligible: false, blockingReasons: ['published package is not sealed'] } }, [], []);
assert.equal(unavailable.verdict, 'inconclusive');
const missingIndependentEvidence = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, executionPrerequisites: { ...prerequisites, providerTelemetry: { sealed: false, evidenceDigest: null } }, runEligibility: { eligible: true, blockingReasons: [] } }, [], []);
assert.equal(missingIndependentEvidence.verdict, 'inconclusive');
const absentPrerequisites = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, executionPrerequisites: {} as typeof prerequisites, runEligibility: { eligible: true, blockingReasons: [] } }, [], []);
assert.equal(absentPrerequisites.verdict, 'inconclusive');
const forgedArtifactDecision = executeExternalBenchmark(protocolBase, [], [], { ...verifiedArtifacts, providerRawExport: Buffer.from('forged provider export') });
assert.equal(forgedArtifactDecision.verdict, 'inconclusive');
assert.match(forgedArtifactDecision.rationale.join('\n'), /provider telemetry raw export digest/i);
const tamperedSignatureDecision = executeExternalBenchmark(protocolBase, [], [], {
  ...verifiedArtifacts,
  hiddenCorpusAcceptance: { ...verifiedArtifacts.hiddenCorpusAcceptance, corpusId: 'tampered-corpus' }
});
assert.equal(tamperedSignatureDecision.verdict, 'inconclusive');
assert.match(tamperedSignatureDecision.rationale.join('\n'), /hidden corpus acceptance artifact digest does not match sealed evidence|hidden corpus acceptance artifact detached signature is invalid/i);
const collapsedIdentityDecision = executeExternalBenchmark(protocolBase, [], [], {
  ...verifiedArtifacts,
  independentAdjudication: { ...verifiedArtifacts.independentAdjudication, signerId: 'custodian' }
});
assert.equal(collapsedIdentityDecision.verdict, 'inconclusive');
assert.match(collapsedIdentityDecision.rationale.join('\n'), /artifact digest does not match sealed evidence|artifact detached signature is invalid|distinct signer identities/i);
const incompleteSemanticDecision = executeExternalBenchmark(protocolBase, [], [], {
  ...verifiedArtifacts,
  hiddenCorpusAcceptance: signed({ schemaId: 'atm.hiddenCorpusAcceptance.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'hidden-corpus-custodian', signerId: 'custodian', corpusId: 'corpus-1', corpusDigest: `sha256:${'1'.repeat(64)}`, visibility: 'public' })
});
assert.equal(incompleteSemanticDecision.verdict, 'inconclusive');
assert.match(incompleteSemanticDecision.rationale.join('\n'), /oracle-only visibility/i);
const boundRuns = [
  { runId: 'baseline-ab', roundId: 'round-ab', sequence: 'AB' as const, arm: 'baseline' as const, repository: 'example/repo', commitSha: 'a'.repeat(40), startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', prompt: 'run', tokens: 1, billedCost: 2, humanMinutes: 0, retries: 0, commands: ['git status'], repairs: [], environmentDigest: `sha256:${'4'.repeat(64)}` },
  { runId: 'atm-ba', roundId: 'round-ba', sequence: 'BA' as const, arm: 'atm' as const, repository: 'example/repo', commitSha: 'a'.repeat(40), startedAt: '2026-08-30T00:00:02.000Z', finishedAt: '2026-08-30T00:00:03.000Z', prompt: 'run', tokens: 1, billedCost: 1, humanMinutes: 0, retries: 0, commands: ['atm --version'], repairs: [], environmentDigest: `sha256:${'4'.repeat(64)}` }
];
const boundAdjudications = [
  { runId: 'baseline-ab', adjudicator: 'adjudicator', hiddenCorpusOwner: 'custodian', implementer: 'baseline-operator', arm: 'baseline' as const, falseBlock: false, missedConflict: false, completed: true },
  { runId: 'atm-ba', adjudicator: 'adjudicator', hiddenCorpusOwner: 'custodian', implementer: 'atm-operator', arm: 'atm' as const, falseBlock: false, missedConflict: false, completed: true }
];
const boundArtifacts = {
  hiddenCorpusAcceptance: verifiedArtifacts.hiddenCorpusAcceptance,
  independentAdjudication: signed({ schemaId: 'atm.adjudicationManifest.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'independent-adjudicator', signerId: 'adjudicator', hiddenCorpusOwner: 'custodian', inputDigest: digest(boundRuns), outputDigest: digest(boundAdjudications), labeledAt: '2026-08-30T00:00:00.000Z' }),
  providerTelemetry: signed({ schemaId: 'atm.providerCostTelemetry.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'provider-telemetry', signerId: 'billing-export', provider: 'provider', observedAt: '2026-08-30T00:00:00.000Z', rawExportSha256: `sha256:${createHash('sha256').update(providerRawExport).digest('hex')}`, runIds: boundRuns.map((run) => run.runId) }),
  providerRawExport
};
const boundProtocol = { ...protocolBase, executionPrerequisites: {
  ...protocolBase.executionPrerequisites,
  independentAdjudication: { sealed: true, evidenceDigest: digest(boundArtifacts.independentAdjudication) },
  providerTelemetry: { sealed: true, evidenceDigest: digest(boundArtifacts.providerTelemetry) }
} };
const unboundAdjudication = signed({ schemaId: 'atm.adjudicationManifest.v1', protocolVersion: '1.0.0', protocolDigest: preregistrationDigest, signerRole: 'independent-adjudicator', signerId: 'adjudicator', hiddenCorpusOwner: 'custodian', inputDigest: `sha256:${'9'.repeat(64)}`, outputDigest: digest(boundAdjudications), labeledAt: '2026-08-30T00:00:00.000Z' });
const unboundAdjudicationDecision = executeExternalBenchmark({ ...boundProtocol, executionPrerequisites: { ...boundProtocol.executionPrerequisites, independentAdjudication: { sealed: true, evidenceDigest: digest(unboundAdjudication) } } }, boundRuns, boundAdjudications, {
  ...boundArtifacts,
  independentAdjudication: unboundAdjudication
});
assert.equal(unboundAdjudicationDecision.verdict, 'inconclusive');
assert.match(unboundAdjudicationDecision.rationale.join('\n'), /input digest/i);
assert.throws(() => executeExternalBenchmark(protocolBase, [], [], verifiedArtifacts), /no raw runs for baseline/);
console.log('external-benchmark-decision ok');
