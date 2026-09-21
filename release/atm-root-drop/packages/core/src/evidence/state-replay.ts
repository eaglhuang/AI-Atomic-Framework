import { createHash } from 'node:crypto';

export const STATE_REPLAY_SCHEMA_ID = 'atm.stateReplay.v1' as const;
export const STATE_REPLAY_SPEC_VERSION = '0.2.0' as const;
export const replayDogfoodSignals = ['cross-lane-shared-index', 'close-deferral', 'active-batch-routing'] as const;
export type ReplayDogfoodSignal = typeof replayDogfoodSignals[number];
export type ReplayVerdict = 'repaired' | 'regressed' | 'stale' | 'forged' | 'missing' | 'unsupported';

export interface ReplayBinding {
  readonly sourceCommit: string;
  readonly runnerDigest: string;
  readonly treeDigest: string;
  readonly provenanceDigest: string;
  readonly fixtureDigest: string;
  readonly repairDigest?: string;
}

export interface ReplayDogfoodWitness {
  readonly signal: ReplayDogfoodSignal;
  readonly laneIds: readonly string[];
  readonly eventDigest: string;
}

export interface ReplayObservation {
  readonly incidentId: string;
  readonly family: string;
  readonly historical: boolean;
  readonly supported: boolean;
  readonly fixtureOnly?: boolean;
  readonly expected: ReplayBinding;
  readonly observed: ReplayBinding;
  readonly dogfoodWitness?: ReplayDogfoodWitness;
  readonly sealDigest: string;
}

export interface ReplayVerdictEntry {
  readonly incidentId: string;
  readonly family: string;
  readonly verdict: ReplayVerdict;
  readonly diagnostics: readonly string[];
}

export interface StateReplayResult {
  readonly schemaId: typeof STATE_REPLAY_SCHEMA_ID;
  readonly specVersion: typeof STATE_REPLAY_SPEC_VERSION;
  readonly authorityDigest: string;
  readonly status: 'proven' | 'blocked';
  readonly verdicts: readonly ReplayVerdictEntry[];
  readonly requiredFamilies: readonly string[];
  readonly requiredDogfoodSignals: readonly ReplayDogfoodSignal[];
  readonly observedDogfoodSignals: readonly ReplayDogfoodSignal[];
  readonly nonClaims: readonly string[];
  readonly historicalIncidentIds: readonly string[];
  readonly diagnostics: readonly string[];
  readonly resultDigest: string;
}

export function sealReplayObservation(observation: Omit<ReplayObservation, 'sealDigest'>): string {
  return digest(canonicalObservation(observation));
}

export function replayState(input: {
  readonly authorityDigest: string;
  readonly observations?: readonly ReplayObservation[];
  readonly requiredFamilies?: readonly string[];
  readonly requiredDogfoodSignals?: readonly ReplayDogfoodSignal[];
}): StateReplayResult {
  const observations = [...(input.observations ?? [])].sort((left, right) => text(left.incidentId).localeCompare(text(right.incidentId)));
  const requiredFamilies = unique(input.requiredFamilies ?? []);
  const requiredSignals = uniqueSignals(input.requiredDogfoodSignals ?? []);
  const verdicts = observations.map(classifyObservation);
  const presentFamilies = new Set(observations.map((item) => text(item.family)));
  for (const family of requiredFamilies.filter((family) => !presentFamilies.has(family))) {
    verdicts.push({ incidentId: `missing-family:${family}`, family, verdict: 'missing', diagnostics: ['required-family-missing'] });
  }

  const observedSignals = uniqueSignals(observations
    .filter((item, index) => verdicts[index]?.verdict === 'repaired')
    .flatMap((item) => item.dogfoodWitness ? [item.dogfoodWitness.signal] : []));
  const diagnostics = verdicts.flatMap((entry) => entry.diagnostics);
  if (!isDigest(input.authorityDigest)) diagnostics.push('authority-missing-or-invalid');
  for (const signal of requiredSignals.filter((signal) => !observedSignals.includes(signal))) diagnostics.push(`required-dogfood-signal-missing:${signal}`);

  const result = {
    schemaId: STATE_REPLAY_SCHEMA_ID,
    specVersion: STATE_REPLAY_SPEC_VERSION,
    authorityDigest: text(input.authorityDigest),
    status: diagnostics.length === 0 ? 'proven' as const : 'blocked' as const,
    verdicts: [...verdicts].sort((left, right) => left.incidentId.localeCompare(right.incidentId)),
    requiredFamilies,
    requiredDogfoodSignals: requiredSignals,
    observedDogfoodSignals: observedSignals,
    nonClaims: ['replay-is-not-close-authority', 'replay-does-not-authorize-plan4-close', 'fixture-only-replay-cannot-prove-dogfood'],
    historicalIncidentIds: observations.filter((item) => item.historical).map((item) => text(item.incidentId)).filter(Boolean).sort(),
    diagnostics: unique(diagnostics),
    resultDigest: '',
  };
  return { ...result, resultDigest: digest({ ...result, resultDigest: undefined }) };
}

export const replayStateReplay = replayState;

export function validateStateReplay(result: StateReplayResult): { readonly ok: boolean; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = [];
  if (result.schemaId !== STATE_REPLAY_SCHEMA_ID || result.specVersion !== STATE_REPLAY_SPEC_VERSION) diagnostics.push('invalid-schema');
  if (!isDigest(result.authorityDigest)) diagnostics.push('invalid-authority-digest');
  if (!result.nonClaims.includes('replay-does-not-authorize-plan4-close')) diagnostics.push('missing-close-authority-non-claim');
  const expectedDigest = digest({ ...result, resultDigest: undefined });
  if (result.resultDigest !== expectedDigest) diagnostics.push('result-digest-mismatch');
  if (result.status === 'proven' && (result.diagnostics.length || result.verdicts.some((entry) => entry.verdict !== 'repaired'))) diagnostics.push('proven-result-has-blockers');
  return { ok: diagnostics.length === 0, diagnostics };
}

function classifyObservation(observation: ReplayObservation): ReplayVerdictEntry {
  const diagnostics: string[] = [];
  if (!text(observation.incidentId) || !text(observation.family)) diagnostics.push('missing-identity');
  if (!observation.supported) diagnostics.push('unsupported-family');
  if (observation.sealDigest !== sealReplayObservation(withoutSeal(observation))) diagnostics.push('observation-seal-mismatch');
  for (const field of ['sourceCommit', 'runnerDigest', 'treeDigest', 'provenanceDigest', 'fixtureDigest'] as const) {
    const expected = text(observation.expected?.[field]);
    const observed = text(observation.observed?.[field]);
    if (!expected || !observed) diagnostics.push(`missing-${bindingName(field)}`);
    else if (expected !== observed) diagnostics.push(`mismatch-${bindingName(field)}`);
  }
  if (observation.expected?.repairDigest && observation.observed?.repairDigest && observation.expected.repairDigest !== observation.observed.repairDigest) diagnostics.push('repair-regressed');
  if (observation.fixtureOnly === true) diagnostics.push('fixture-only-replay');

  let verdict: ReplayVerdict = 'repaired';
  if (diagnostics.includes('unsupported-family')) verdict = 'unsupported';
  else if (diagnostics.some((item) => item.startsWith('missing-'))) verdict = 'missing';
  else if (diagnostics.includes('observation-seal-mismatch')) verdict = 'forged';
  else if (diagnostics.some((item) => item.startsWith('mismatch-'))) verdict = observation.historical ? 'stale' : 'forged';
  else if (diagnostics.includes('repair-regressed')) verdict = 'regressed';
  else if (diagnostics.includes('fixture-only-replay')) verdict = 'unsupported';
  return { incidentId: text(observation.incidentId), family: text(observation.family), verdict, diagnostics: unique(diagnostics) };
}

function validWitness(witness: ReplayDogfoodWitness | undefined): witness is ReplayDogfoodWitness {
  return Boolean(witness && replayDogfoodSignals.includes(witness.signal) && unique(witness.laneIds).length >= 2 && isDigest(witness.eventDigest));
}

function canonicalObservation(observation: Omit<ReplayObservation, 'sealDigest'>): unknown {
  return {
    incidentId: text(observation.incidentId), family: text(observation.family), historical: observation.historical === true, supported: observation.supported === true, fixtureOnly: observation.fixtureOnly === true,
    expected: canonicalBinding(observation.expected), observed: canonicalBinding(observation.observed),
    dogfoodWitness: observation.dogfoodWitness ? { signal: observation.dogfoodWitness.signal, laneIds: unique(observation.dogfoodWitness.laneIds), eventDigest: text(observation.dogfoodWitness.eventDigest) } : null,
  };
}
function canonicalBinding(binding: ReplayBinding): ReplayBinding { return { sourceCommit: text(binding?.sourceCommit), runnerDigest: text(binding?.runnerDigest), treeDigest: text(binding?.treeDigest), provenanceDigest: text(binding?.provenanceDigest), fixtureDigest: text(binding?.fixtureDigest), repairDigest: binding?.repairDigest ? text(binding.repairDigest) : undefined }; }
function withoutSeal(observation: ReplayObservation): Omit<ReplayObservation, 'sealDigest'> { const { sealDigest: _sealDigest, ...rest } = observation; return rest; }
function bindingName(field: keyof ReplayBinding): string { return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`); }
function unique(values: readonly unknown[]): string[] { return [...new Set(values.map(text).filter(Boolean))].sort(); }
function uniqueSignals(values: readonly ReplayDogfoodSignal[]): ReplayDogfoodSignal[] { return [...new Set(values.filter((value): value is ReplayDogfoodSignal => replayDogfoodSignals.includes(value)))].sort() as ReplayDogfoodSignal[]; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function isDigest(value: unknown): value is string { return /^sha256:[a-f0-9]{64}$/i.test(text(value)); }
function digest(value: unknown): string { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
