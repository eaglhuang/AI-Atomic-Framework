import { createHash } from 'node:crypto';

export const ENGINEERING_CHANGE_METHOD_PROFILE_SCHEMA_ID = 'atm.engineeringChangeMethodProfile.v1' as const;
export const ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID = 'atm.engineeringChangeMethodFidelityReceipt.v1' as const;

export type EngineeringChangeMethodProfileId =
  | 'expand-contract'
  | 'tdd-oracle-fidelity'
  | 'review-smell-heuristics'
  | 'merge-conflict-intent'
  | 'deep-module-refactor';

export type EngineeringChangeMethodApplicability =
  | 'required'
  | 'recommended'
  | 'not-applicable';

export interface EngineeringChangeMethodProfile {
  readonly schemaId: typeof ENGINEERING_CHANGE_METHOD_PROFILE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly id: EngineeringChangeMethodProfileId;
  readonly title: string;
  readonly triggerEvidence: readonly string[];
  readonly applicability: readonly string[];
  readonly requiredObservations: readonly string[];
  readonly counterexamples: readonly string[];
  readonly completionEvidence: readonly string[];
  readonly rollback: readonly string[];
  readonly guardrails: readonly string[];
}

export interface EngineeringChangeMethodSelectionInput {
  readonly changeSummary: string;
  readonly changedPublicSeams?: readonly string[];
  readonly requestedMethods?: readonly EngineeringChangeMethodProfileId[];
  readonly observedSignals?: readonly string[];
}

export interface EngineeringChangeMethodSelection {
  readonly schemaId: 'atm.engineeringChangeMethodSelection.v1';
  readonly selectedProfileIds: readonly EngineeringChangeMethodProfileId[];
  readonly skippedProfileIds: readonly EngineeringChangeMethodProfileId[];
  readonly reasons: readonly string[];
  readonly profileDigest: string;
}

export interface EngineeringChangeMethodFidelityInput {
  readonly taskId: string;
  readonly profile: EngineeringChangeMethodProfile;
  readonly observations: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly counterexamplesCleared: readonly string[];
  readonly rollbackRefs: readonly string[];
  readonly independentOracleRefs?: readonly string[];
  readonly bothSideIntentRefs?: readonly string[];
  readonly oldFormUsageQueryRef?: string | null;
  readonly zeroCallerGateRef?: string | null;
  readonly smellHeuristicPolicyRef?: string | null;
}

export interface EngineeringChangeMethodFidelityReceipt {
  readonly schemaId: typeof ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly taskId: string;
  readonly profileId: EngineeringChangeMethodProfileId;
  readonly valid: boolean;
  readonly admission: 'admit-method' | 'fail-closed';
  readonly missing: readonly string[];
  readonly antiPatterns: readonly string[];
  readonly receiptDigest: string;
}

export function selectEngineeringChangeMethodProfiles(
  profiles: readonly EngineeringChangeMethodProfile[],
  input: EngineeringChangeMethodSelectionInput
): EngineeringChangeMethodSelection {
  const haystack = [
    input.changeSummary,
    ...(input.changedPublicSeams ?? []),
    ...(input.observedSignals ?? [])
  ].join('\n').toLowerCase();
  const requested = new Set(input.requestedMethods ?? []);
  const selected = profiles
    .filter((profile) => requested.has(profile.id) || profile.triggerEvidence.some((trigger) => haystack.includes(trigger.toLowerCase())))
    .map((profile) => profile.id);
  return {
    schemaId: 'atm.engineeringChangeMethodSelection.v1',
    selectedProfileIds: selected,
    skippedProfileIds: profiles.map((profile) => profile.id).filter((id) => !selected.includes(id)),
    reasons: selected.length > 0 ? selected.map((id) => `selected:${id}`) : ['no-method-profile-triggered'],
    profileDigest: digestJson(profiles)
  };
}

export function evaluateEngineeringChangeMethodFidelity(
  input: EngineeringChangeMethodFidelityInput
): EngineeringChangeMethodFidelityReceipt {
  const observations = new Set(input.observations.map(normalize));
  const evidenceRefs = new Set(input.evidenceRefs.map(normalize));
  const counterexamplesCleared = new Set(input.counterexamplesCleared.map(normalize));
  const rollbackRefs = new Set(input.rollbackRefs.map(normalize));
  const missing: string[] = [];
  const antiPatterns: string[] = [];

  if (!input.taskId.trim()) missing.push('task-id');
  requireAll('required-observation', input.profile.requiredObservations, observations, missing);
  requireAll('completion-evidence', input.profile.completionEvidence, evidenceRefs, missing);
  requireAll('counterexample-cleared', input.profile.counterexamples, counterexamplesCleared, missing);
  requireAll('rollback', input.profile.rollback, rollbackRefs, missing);

  if (input.profile.id === 'expand-contract') {
    if (!hasObservation(input.observations, 'expand step')) missing.push('expand-contract:expand-step');
    if (!hasObservation(input.observations, 'independently green migration batch')) missing.push('expand-contract:independently-green-migration-batches');
    if (!input.oldFormUsageQueryRef) missing.push('expand-contract:old-form-usage-query');
    if (!input.zeroCallerGateRef) missing.push('expand-contract:zero-caller-contract-gate');
  }

  if (input.profile.id === 'tdd-oracle-fidelity') {
    if ((input.independentOracleRefs ?? []).length === 0) missing.push('tdd-oracle:independent-source');
    if (hasObservation(input.observations, 'private method')) antiPatterns.push('tdd-oracle:private-method-test');
    if (hasObservation(input.observations, 'internal mock')) antiPatterns.push('tdd-oracle:internal-mock');
    if (hasObservation(input.observations, 'tautological')) antiPatterns.push('tdd-oracle:tautological-test');
  }

  if (input.profile.id === 'review-smell-heuristics' && !input.smellHeuristicPolicyRef) {
    missing.push('review-smell:replaceable-heuristic-policy-ref');
  }

  if (input.profile.id === 'merge-conflict-intent') {
    if ((input.bothSideIntentRefs ?? []).length < 2) missing.push('merge-conflict:both-side-intent-provenance');
    if (!hasObservation(input.observations, 'abort safely') && !hasObservation(input.observations, 'fail closed')) {
      missing.push('merge-conflict:safe-abort-or-fail-closed');
    }
    if (hasObservation(input.observations, 'ours/theirs')) antiPatterns.push('merge-conflict:mandates-ours-theirs');
  }

  const valid = missing.length === 0 && antiPatterns.length === 0;
  return {
    schemaId: ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID,
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial engineering change method fidelity receipt.'
    },
    taskId: input.taskId.trim(),
    profileId: input.profile.id,
    valid,
    admission: valid ? 'admit-method' : 'fail-closed',
    missing,
    antiPatterns,
    receiptDigest: digestJson({
      taskId: input.taskId,
      profileId: input.profile.id,
      observations: input.observations,
      evidenceRefs: input.evidenceRefs,
      counterexamplesCleared: input.counterexamplesCleared,
      rollbackRefs: input.rollbackRefs
    })
  };
}

function requireAll(label: string, required: readonly string[], actual: ReadonlySet<string>, missing: string[]) {
  for (const value of required) {
    if (!actual.has(normalize(value))) missing.push(`${label}:${value}`);
  }
}

function hasObservation(values: readonly string[], needle: string): boolean {
  return values.some((value) => normalize(value).includes(normalize(needle)));
}

function normalize(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
