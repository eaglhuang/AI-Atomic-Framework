export const ATM_CORE_PATCH_ENVELOPE_SCHEMA_ID = 'atm.patchEnvelope.atmCore.v1';
export function annotateForAtmCore(base, input) {
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
/**
 * Cross-field validation for the ATM core annotation:
 *  - version-publish intent requires a targetRunnerRef (must name the version being cut).
 *  - in-dev-bump intent requires a targetRunnerRef of the in-dev control ref family.
 *  - release-only scope cannot carry a textual-diff base envelope (release artifacts
 *    must come from a clean steward rebuild, not an agent's patch).
 */
export function validateAtmCorePatchEnvelope(env) {
    if (env.atmCore.publishIntent === 'version-publish' && !env.atmCore.targetRunnerRef) {
        return { ok: false, reason: 'version-publish intent requires targetRunnerRef' };
    }
    if (env.atmCore.publishIntent === 'in-dev-bump' &&
        !(env.atmCore.targetRunnerRef ?? '').startsWith('in-dev/')) {
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
