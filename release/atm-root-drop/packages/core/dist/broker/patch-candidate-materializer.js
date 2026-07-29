import { createHash } from 'node:crypto';
import { composeTransactionalMutations } from './transactional-composer.js';
/**
 * Seal the validator union before any producer can read a locked negative-control
 * fixture. Post-reveal union changes invalidate the cell (digest mismatch).
 */
export function sealValidatorSelection(input) {
    const cardValidators = normalizeRefs(input.cardValidators);
    const adapterStaticChecks = normalizeRefs(input.adapterStaticChecks);
    const catalogTargetedTests = normalizeRefs(input.catalogTargetedTests);
    const selectionInputDigest = digestJson({
        cardValidators,
        adapterStaticChecks,
        catalogTargetedTests
    });
    const requiredValidatorIds = uniqueSorted([
        ...cardValidators,
        ...adapterStaticChecks,
        ...catalogTargetedTests
    ]);
    const sealedSelectionSourceDigest = digestJson({
        selectionInputDigest,
        requiredValidatorIds
    });
    return {
        schemaId: 'atm.sealedValidatorSelection.v1',
        selectionInputDigest,
        sealedSelectionSourceDigest,
        requiredValidatorIds,
        cardValidators,
        adapterStaticChecks,
        catalogTargetedTests
    };
}
/**
 * Materialize an exact composed candidate from an immutable base snapshot.
 * Does not write to the live worktree.
 */
export function materializePatchCandidate(input) {
    const reasons = [];
    if (!input.baseHeadSha || input.baseHeadSha.trim().length === 0) {
        reasons.push('missing-base-head-sha');
    }
    if (!Array.isArray(input.baseFiles) || input.baseFiles.length === 0) {
        reasons.push('missing-base-files');
    }
    if (!Array.isArray(input.requests) || input.requests.length === 0) {
        reasons.push('missing-mutation-requests');
    }
    const sealedSelection = sealValidatorSelection({
        cardValidators: input.cardValidators ?? input.validators ?? [],
        adapterStaticChecks: input.adapterStaticChecks ?? [],
        catalogTargetedTests: input.catalogTargetedTests ?? []
    });
    const composition = composeTransactionalMutations({
        files: input.baseFiles,
        requests: input.requests,
        validators: sealedSelection.requiredValidatorIds,
        adapters: input.adapters,
        maxPermutationChecks: input.maxPermutationChecks
    });
    if (!composition.ok) {
        reasons.push('composition-blocked-or-incomplete');
    }
    if (!composition.plan.serializabilityProof.permutationStable) {
        reasons.push('serializability-proof-unstable');
    }
    for (const request of input.requests) {
        if (!request.requestId || !request.filePath) {
            reasons.push(`malformed-request:${request.requestId || 'unknown'}`);
        }
    }
    const compositionPlanDigest = digestJson(composition.plan);
    const serializabilityProofDigest = digestJson(composition.plan.serializabilityProof);
    const candidateDigest = digestCandidate(composition.plan, composition.outputFiles);
    // Verify plan attribution and slice digests bind to output bytes.
    for (const slice of composition.plan.fileSlices) {
        const output = composition.outputFiles.find((file) => normalizePath(file.filePath) === normalizePath(slice.filePath));
        if (!output) {
            reasons.push(`missing-output-slice:${slice.filePath}`);
            continue;
        }
        if (hashContent(output.content) !== slice.outputHash) {
            reasons.push(`output-hash-mismatch:${slice.filePath}`);
        }
    }
    return {
        schemaId: 'atm.patchCandidate.v1',
        specVersion: '0.1.0',
        baseHeadSha: input.baseHeadSha,
        candidateDigest,
        compositionPlanDigest,
        serializabilityProofDigest,
        serializabilityProofPresent: composition.plan.serializabilityProof.permutationStable,
        liveWorktreeMutation: false,
        plan: composition.plan,
        outputFiles: composition.outputFiles,
        sealedSelection,
        memberAttribution: composition.plan.memberAttribution,
        reasons,
        ok: reasons.length === 0 && composition.ok
    };
}
export function digestCandidate(plan, outputFiles) {
    return digestJson({
        planDigest: digestJson(plan),
        outputs: [...outputFiles]
            .map((file) => ({ filePath: normalizePath(file.filePath), contentHash: hashContent(file.content) }))
            .sort((left, right) => left.filePath.localeCompare(right.filePath))
    });
}
function normalizeRefs(values) {
    return uniqueSorted((values ?? []).map((value) => value.trim()).filter(Boolean));
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function digestJson(value) {
    return hashContent(JSON.stringify(value));
}
function hashContent(value) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
function normalizePath(value) {
    return value.replace(/\\/g, '/');
}
