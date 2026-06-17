import type { MigrationRecord } from './types.ts';
import type { PatchEnvelope } from './patch-envelope.ts';
export declare const ATM_CORE_PATCH_ENVELOPE_SCHEMA_ID: "atm.patchEnvelope.atmCore.v1";
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
export declare function annotateForAtmCore(base: PatchEnvelope, input: {
    readonly scopeClass: AtmCoreScopeClass;
    readonly publishIntent: AtmCorePublishIntent;
    readonly targetRunnerRef?: string | null;
    readonly declaredSourceCommit?: string | null;
}): AtmCorePatchEnvelope;
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
export declare function validateAtmCorePatchEnvelope(env: AtmCorePatchEnvelope): AtmCorePatchEnvelopeValidation;
