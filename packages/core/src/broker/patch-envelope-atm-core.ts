// TASK-MAO-0015: ATM core specialization of the patch envelope (TASK-MAO-0008).
// Adds ATM core targeting fields without modifying the v1 base contract:
// publishing intent (which runner ref this patch targets), source-scope class
// (atm-core vs. external-host), and runner artifact binding hints used by the
// runner submit pipeline (TASK-MAO-0016).
import type { MigrationRecord } from './types.ts';
import type { PatchEnvelope } from './patch-envelope.ts';

export const ATM_CORE_PATCH_ENVELOPE_SCHEMA_ID = 'atm.patchEnvelope.atmCore.v1' as const;

export type AtmCoreScopeClass = 'atm-core' | 'release-only' | 'external-host';
export type AtmCorePublishIntent = 'in-dev-bump' | 'version-publish' | 'patch-only';

export interface AtmCorePatchEnvelopeAnnotation {
  readonly schemaId: typeof ATM_CORE_PATCH_ENVELOPE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly basePatchEnvelopeId: string;
  readonly scopeClass: AtmCoreScopeClass;
  readonly publishIntent: AtmCorePublishIntent;
  readonly targetRunnerRef: string | null;
  /** Optional source commit declared by the agent; verified by runner-submit pipeline. */
  readonly declaredSourceCommit: string | null;
}

export interface AtmCorePatchEnvelope {
  readonly base: PatchEnvelope;
  readonly atmCore: AtmCorePatchEnvelopeAnnotation;
}

export function annotateForAtmCore(
  base: PatchEnvelope,
  input: {
    readonly scopeClass: AtmCoreScopeClass;
    readonly publishIntent: AtmCorePublishIntent;
    readonly targetRunnerRef?: string | null;
    readonly declaredSourceCommit?: string | null;
  }
): AtmCorePatchEnvelope {
  return {
    base,
    atmCore: {
      schemaId: ATM_CORE_PATCH_ENVELOPE_SCHEMA_ID,
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'ATM core specialization baseline.' },
      basePatchEnvelopeId: base.envelopeId,
      scopeClass: input.scopeClass,
      publishIntent: input.publishIntent,
      targetRunnerRef: input.targetRunnerRef ?? null,
      declaredSourceCommit: input.declaredSourceCommit ?? null
    }
  };
}

export interface AtmCorePatchEnvelopeValidation {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Cross-field validation for the ATM core annotation:
 *  - version-publish intent requires a targetRunnerRef (must name the version being cut).
 *  - in-dev-bump intent requires a targetRunnerRef of the in-dev control ref family.
 *  - release-only scope cannot carry a textual-diff base envelope (release artifacts
 *    must come from a clean steward rebuild, not an agent's patch).
 */
export function validateAtmCorePatchEnvelope(env: AtmCorePatchEnvelope): AtmCorePatchEnvelopeValidation {
  if (env.atmCore.publishIntent === 'version-publish' && !env.atmCore.targetRunnerRef) {
    return { ok: false, reason: 'version-publish intent requires targetRunnerRef' };
  }
  if (
    env.atmCore.publishIntent === 'in-dev-bump' &&
    !(env.atmCore.targetRunnerRef ?? '').startsWith('in-dev/')
  ) {
    return {
      ok: false,
      reason: 'in-dev-bump intent requires targetRunnerRef under the in-dev/ control namespace'
    };
  }
  if (env.atmCore.scopeClass === 'release-only' && env.base.mode === 'textual-diff') {
    return {
      ok: false,
      reason: 'release-only scope cannot carry a textual-diff base envelope; release artifacts require a clean steward rebuild'
    };
  }
  if (env.atmCore.basePatchEnvelopeId !== env.base.envelopeId) {
    return { ok: false, reason: 'basePatchEnvelopeId must match base envelope id' };
  }
  return { ok: true, reason: 'atm core patch envelope is valid' };
}
