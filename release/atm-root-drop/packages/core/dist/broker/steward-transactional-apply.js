import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sortProposalsForCompose } from './merge-plan.js';
import { composeJsonPointerPatches } from './steward-json-pointer-compose.js';
import { commitCanonicalFiles, defaultStewardCommitLockRoot } from './steward-commit-guard.js';
import { composeTextPatchesAgainstBase } from './steward-base-composer.js';
import { applyUnifiedPatch, parseUnifiedPatchHunks, UnifiedPatchApplicationError } from './unified-patch.js';
import { proposalRegionIdentity } from './steward-region-rebase.js';
import { findCommittedBaseText, renderTranslatedPatch, translateStalePatch } from './stale-base-translation.js';
export function buildPatchProposalComposition(input) {
    const sorted = sortProposalsForCompose(input.proposals);
    const byFile = new Map();
    for (const proposal of sorted) {
        const group = byFile.get(proposal.targetFile) ?? [];
        group.push(proposal);
        byFile.set(proposal.targetFile, group);
    }
    const outputFiles = [];
    const fileSlices = [];
    const attribution = [];
    const selectedIds = [];
    let blocked = null;
    let checkedPermutationCount = 0;
    for (const [filePath, proposals] of [...byFile].sort((left, right) => left[0].localeCompare(right[0]))) {
        const targetPath = path.resolve(input.cwd, filePath);
        const before = readFileSync(targetPath, 'utf8');
        // #363 AC4: re-check declared bases in the apply queue; stale ones are translated, never re-composed.
        const rebased = translateStaleProposals(input.cwd, filePath, before, proposals);
        if ('block' in rebased) {
            blocked = rebased.block;
            break;
        }
        const composed = composeProposalPatchesAgainstImmutableBase(filePath, before, rebased.proposals);
        if (!composed.ok) {
            blocked = composed.block;
            break;
        }
        checkedPermutationCount += composed.checkedPermutationCount;
        const after = composed.content;
        for (const proposal of proposals) {
            selectedIds.push(proposal.proposalId);
            attribution.push({
                requestId: proposal.proposalId,
                actorId: proposal.actorId,
                taskId: proposal.taskId,
                transactionIds: extractProposalTransactionIds(proposal),
                filePath: proposal.targetFile,
                adapterId: `steward.${input.mergePlan.applyMethod}`,
                verdict: 'selected',
                reason: 'patch proposal composed into a single steward-authored output file'
            });
        }
        outputFiles.push({ filePath, content: after });
        fileSlices.push({
            filePath,
            adapterId: `steward.${input.mergePlan.applyMethod}`,
            baseHash: hashContent(before),
            outputHash: hashContent(after),
            selectedRequestIds: proposals.map((proposal) => proposal.proposalId).sort((left, right) => left.localeCompare(right))
        });
    }
    const outputDigest = hashContent(outputFiles.map((file) => `${file.filePath}\0${hashContent(file.content)}`).join('\n'));
    const plan = {
        schemaId: 'atm.compositionPlan.v1',
        specVersion: '0.1.0',
        migration: input.mergePlan.migration,
        planId: `steward-${input.mergePlan.mergePlanId}`,
        baseTree: 'in-memory',
        outputTree: 'in-memory',
        bounded: true,
        selectedRequestIds: blocked ? [] : selectedIds.sort((left, right) => left.localeCompare(right)),
        skippedRequestIds: [],
        blockedRequestIds: blocked ? [...new Set(sorted.map((proposal) => proposal.proposalId))].sort((left, right) => left.localeCompare(right)) : [],
        fileSlices: fileSlices.sort((left, right) => left.filePath.localeCompare(right.filePath)),
        memberAttribution: attribution.sort((left, right) => left.requestId.localeCompare(right.requestId)),
        serializabilityProof: {
            legalSerialOrder: blocked ? [] : selectedIds.sort((left, right) => left.localeCompare(right)),
            // Each file is rendered under every checked proposal order; a differing
            // render blocks the composition, so reaching here means it was stable.
            permutationStable: blocked === null,
            equivalentOutputHash: outputDigest,
            checkedPermutationCount: Math.max(1, checkedPermutationCount)
        },
        rollback: {
            strategy: 'discard-temp-tree',
            tempTreeMutation: false,
            liveWorktreeMutation: false,
            returnedQueueRequestIds: []
        },
        validatorRefs: [...new Set(sorted.flatMap((proposal) => proposal.validators))].sort((left, right) => left.localeCompare(right))
    };
    return {
        plan,
        outputFiles: blocked ? [] : outputFiles.sort((left, right) => left.filePath.localeCompare(right.filePath)),
        blocked
    };
}
/**
 * Proposals whose declared `fileBeforeHash` is not `before` are translated from
 * their committed base to `before` (#363). Region-identity proposals keep the
 * region rebase. A base that is not in history is `stale-base`; a translation
 * conflict is `stale-base-conflict`. Nothing is guessed.
 */
function translateStaleProposals(cwd, filePath, before, proposals) {
    const currentHash = hashContent(before).replace(/^sha256:/, '');
    const out = [];
    for (const proposal of proposals) {
        const declared = String(proposal.fileBeforeHash ?? '').replace(/^sha256:/, '');
        if (!declared || declared === currentHash || proposalRegionIdentity(proposal) !== null) {
            out.push(proposal);
            continue;
        }
        const block = (code, detail) => ({ block: { code, filePath, proposalIds: [proposal.proposalId], detail: `proposal '${proposal.proposalId}' ${detail}` } });
        const base = findCommittedBaseText(cwd, filePath, declared);
        if (base === null)
            return block('stale-base', `declares base ${declared.slice(0, 12)} of ${filePath}, which is not in committed history; it cannot be translated to the current file`);
        let hunks = null;
        try {
            hunks = parseUnifiedPatchHunks(proposal.patch, { targetFile: filePath });
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
        }
        if (hunks === null) {
            out.push(proposal);
            continue;
        }
        const translated = translateStalePatch({ baseText: base, currentText: before, hunks });
        if (!translated.ok)
            return block(translated.reason === 'stale-base-conflict' ? 'stale-base-conflict' : 'stale-base', translated.detail);
        const patch = renderTranslatedPatch(filePath, before, translated.blocks);
        let roundTrip = null;
        try {
            roundTrip = applyUnifiedPatch(before, patch);
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
        }
        if (roundTrip !== translated.text)
            return block('stale-base-conflict', 'translation could not be rendered as a patch on the current file');
        out.push({ ...proposal, patch, fileBeforeHash: hashContent(before) });
    }
    return { proposals: out };
}
function composeProposalPatchesAgainstImmutableBase(filePath, before, proposals) {
    return composeJsonPointerPatches(before, proposals)
        ?? composeTextPatchesAgainstBase(filePath, before, proposals);
}
export function buildStewardSemanticValidationReceipt(input) {
    const digest = digestCandidate(input.plan, input.outputFiles);
    return {
        schemaId: 'atm.stewardSemanticValidationReceipt.v1',
        candidateDigest: digest,
        outputDigest: digest,
        ok: true
    };
}
export function applyTransactionalStewardPlan(input) {
    const cwd = path.resolve(input.cwd);
    const outputByPath = new Map(input.outputFiles.map((file) => [normalizePath(file.filePath), file]));
    const scopeSet = new Set(input.scopeFiles.map(normalizePath));
    const fileSlices = [...input.plan.fileSlices].sort((left, right) => left.filePath.localeCompare(right.filePath));
    const blockedReasons = [];
    const staleReasons = [];
    if (input.writerRole !== 'neutral-steward') {
        blockedReasons.push('canonical writes require the neutral-steward writer role');
    }
    if (!input.plan.serializabilityProof.permutationStable) {
        blockedReasons.push('serializability proof is not permutation-stable');
    }
    const candidateDigest = digestCandidate(input.plan, input.outputFiles);
    if (input.semanticValidation.ok !== true || input.semanticValidation.candidateDigest !== candidateDigest || input.semanticValidation.outputDigest !== candidateDigest) {
        blockedReasons.push('semantic validation receipt does not authorize the exact composed candidate digest');
    }
    input.commitHooks?.beforePrecheck?.();
    for (const slice of fileSlices) {
        if (!scopeSet.has(normalizePath(slice.filePath))) {
            blockedReasons.push(`declared output is outside steward scope: ${slice.filePath}`);
        }
        const output = outputByPath.get(normalizePath(slice.filePath));
        if (!output) {
            blockedReasons.push(`missing composed output file: ${slice.filePath}`);
            continue;
        }
        if (hashContent(output.content) !== slice.outputHash) {
            blockedReasons.push(`composed output hash mismatch: ${slice.filePath}`);
        }
        const targetPath = resolveInsideRoot(cwd, slice.filePath);
        if (!targetPath) {
            blockedReasons.push(`declared output is outside canonical root: ${slice.filePath}`);
            continue;
        }
        if (!existsSync(targetPath)) {
            blockedReasons.push(`canonical target is missing: ${slice.filePath}`);
            continue;
        }
        const before = readFileSync(targetPath, 'utf8');
        const observed = hashContent(before);
        if (observed !== slice.baseHash) {
            staleReasons.push(`re-compose: canonical target base hash is stale: ${slice.filePath} (expected ${slice.baseHash}, observed ${observed}). Re-read the file and compose again against the current bytes.`);
        }
    }
    if (blockedReasons.length > 0) {
        return {
            ok: false,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files: [],
                verdict: 'blocked',
                blockedReasons
            })
        };
    }
    if (staleReasons.length > 0) {
        return {
            ok: false,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files: [],
                verdict: 're-compose',
                blockedReasons: staleReasons
            })
        };
    }
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-apply-'));
    let materializeError = null;
    try {
        // Materialize all candidates away from the canonical tree before any side effect.
        for (const slice of fileSlices) {
            const output = outputByPath.get(normalizePath(slice.filePath));
            const tempPath = path.join(tempRoot, normalizePath(slice.filePath));
            mkdirSync(path.dirname(tempPath), { recursive: true });
            writeFileSync(tempPath, output.content, 'utf8');
            if (hashContent(readFileSync(tempPath, 'utf8')) !== slice.outputHash) {
                throw new Error(`temporary output hash mismatch: ${slice.filePath}`);
            }
        }
    }
    catch (error) {
        materializeError = error instanceof Error ? error : new Error(String(error));
    }
    finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
    if (materializeError) {
        return {
            ok: false,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files: [],
                verdict: 'rolled-back',
                blockedReasons: [materializeError.message],
                compensation: {
                    restoredFiles: [],
                    failedFile: null,
                    reason: 'discarded materialized temp outputs before canonical write'
                }
            })
        };
    }
    // The barrier sits outside the commit lock so a peer can finish its own commit first.
    input.commitHooks?.afterPrecheck?.();
    const committed = commitCanonicalFiles({
        entries: fileSlices.map((slice) => ({
            filePath: slice.filePath,
            targetPath: resolveInsideRoot(cwd, slice.filePath),
            expectedBaseHash: slice.baseHash,
            content: outputByPath.get(normalizePath(slice.filePath)).content,
            outputHash: slice.outputHash
        })),
        cwd,
        lockRoot: input.commitLockRoot ?? defaultStewardCommitLockRoot(cwd),
        lockWaitMs: input.commitLockWaitMs,
        lockPollMs: input.commitLockPollMs,
        failAfterWrites: input.failAfterWrites,
        commitFault: input.commitFault
    });
    const files = committed.files.map((file) => ({
        filePath: file.filePath,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
        canonicalWriteCount: 1,
        tempOutputHash: file.outputHash
    }));
    if (committed.status === 'applied') {
        return {
            ok: true,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files,
                verdict: 'applied',
                blockedReasons: []
            })
        };
    }
    if (committed.status === 'rolled-back') {
        return {
            ok: false,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files,
                verdict: 'rolled-back',
                blockedReasons: [committed.reason],
                compensation: {
                    restoredFiles: committed.restoredFiles,
                    failedFile: committed.failedFile,
                    reason: files.length > 0
                        ? 'restored canonical files after partial apply failure'
                        : 'discarded materialized temp outputs before canonical write'
                }
            })
        };
    }
    return {
        ok: false,
        receipt: buildReceipt(input, {
            candidateDigest,
            canonicalRoot: cwd,
            files: [],
            verdict: committed.status,
            blockedReasons: [committed.reason]
        })
    };
}
function buildReceipt(input, details) {
    return {
        schemaId: 'atm.transactionalStewardApplyReceipt.v1',
        specVersion: '0.1.0',
        migration: input.plan.migration,
        stewardId: input.stewardId,
        writerRole: input.writerRole,
        compositionPlanId: input.plan.planId,
        compositionPlanDigest: hashJson(input.plan),
        serializabilityProofDigest: hashJson(input.plan.serializabilityProof),
        candidateDigest: details.candidateDigest,
        canonicalRoot: details.canonicalRoot,
        baseHead: input.baseHead ?? null,
        memberAttribution: input.plan.memberAttribution,
        files: [...details.files].sort((left, right) => left.filePath.localeCompare(right.filePath)),
        verdict: details.verdict,
        blockedReasons: [...details.blockedReasons],
        ...(details.compensation ? { compensation: details.compensation } : {})
    };
}
function digestCandidate(plan, outputFiles) {
    return hashJson({
        planDigest: hashJson(plan),
        outputs: [...outputFiles]
            .map((file) => ({ filePath: normalizePath(file.filePath), contentHash: hashContent(file.content) }))
            .sort((left, right) => left.filePath.localeCompare(right.filePath))
    });
}
function hashJson(value) {
    return hashContent(JSON.stringify(value));
}
function hashContent(value) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
function extractProposalTransactionIds(proposal) {
    const values = [
        proposal.transactionId,
        ...(proposal.transactionIds ?? []),
        ...(proposal.transaction_ids ?? [])
    ];
    return values
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean);
}
function normalizePath(value) {
    return value.replace(/\\/g, '/');
}
function resolveInsideRoot(root, relativePath) {
    const targetPath = path.resolve(root, relativePath);
    const outside = (base, target) => {
        const relative = path.relative(base, target);
        return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    };
    if (outside(root, targetPath))
        return null;
    // Resolve directory junctions as well as file symlinks before reading or writing.
    // Return the physical target, not the alias checked above. Concurrent directory
    // replacement still requires stronger filesystem isolation, not a lexical gate.
    if (!existsSync(targetPath))
        return targetPath;
    try {
        const physicalRoot = realpathSync(root);
        const physicalTarget = realpathSync(targetPath);
        return outside(physicalRoot, physicalTarget) ? null : physicalTarget;
    }
    catch {
        return null;
    }
}
