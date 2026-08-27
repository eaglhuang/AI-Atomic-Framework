import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sortProposalsForCompose } from './merge-plan.js';
import { applyUnifiedPatch } from './unified-patch.js';
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
    for (const [filePath, proposals] of [...byFile].sort((left, right) => left[0].localeCompare(right[0]))) {
        const targetPath = path.resolve(input.cwd, filePath);
        const before = readFileSync(targetPath, 'utf8');
        const after = composeProposalPatchesAgainstImmutableBase(before, proposals);
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
        selectedRequestIds: selectedIds.sort((left, right) => left.localeCompare(right)),
        skippedRequestIds: [],
        blockedRequestIds: [],
        fileSlices: fileSlices.sort((left, right) => left.filePath.localeCompare(right.filePath)),
        memberAttribution: attribution.sort((left, right) => left.requestId.localeCompare(right.requestId)),
        serializabilityProof: {
            legalSerialOrder: selectedIds.sort((left, right) => left.localeCompare(right)),
            permutationStable: true,
            equivalentOutputHash: outputDigest,
            checkedPermutationCount: Math.max(1, selectedIds.length)
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
        outputFiles: outputFiles.sort((left, right) => left.filePath.localeCompare(right.filePath))
    };
}
/**
 * Compose each proposal against the same immutable source bytes.  Text patches
 * normally retain strict ordered unified-patch semantics.  JSON-pointer
 * proposals are different: their declared pointers describe disjoint semantic
 * slices, so applying their textual hunks one after another can make the
 * second hunk's surrounding context stale despite a conflict-free intent.
 */
function composeProposalPatchesAgainstImmutableBase(before, proposals) {
    const pointers = proposals.map((proposal) => declaredSingleJsonPointer(proposal));
    const useJsonPointerComposition = pointers.every((pointer) => pointer !== null)
        && new Set(pointers).size === pointers.length;
    if (!useJsonPointerComposition) {
        return proposals.reduce((content, proposal) => applyUnifiedPatch(content, proposal.patch), before);
    }
    let baseDocument;
    try {
        baseDocument = JSON.parse(before);
    }
    catch {
        return proposals.reduce((content, proposal) => applyUnifiedPatch(content, proposal.patch), before);
    }
    if (!isJsonObject(baseDocument)) {
        return proposals.reduce((content, proposal) => applyUnifiedPatch(content, proposal.patch), before);
    }
    const composed = structuredClone(baseDocument);
    for (const [index, proposal] of proposals.entries()) {
        const pointer = pointers[index];
        const patched = JSON.parse(applyUnifiedPatch(before, proposal.patch));
        if (!isJsonObject(patched) || !isOnlyDeclaredPointerMutation(baseDocument, patched, pointer)) {
            // A JSON anchor is an authority boundary, never a hint: any hidden
            // mutation falls back to the strict text route and fails closed if stale.
            return proposals.reduce((content, entry) => applyUnifiedPatch(content, entry.patch), before);
        }
        setJsonPointer(composed, pointer, readJsonPointer(patched, pointer));
    }
    return `${JSON.stringify(composed, null, 2)}\n`;
}
function declaredSingleJsonPointer(proposal) {
    if (proposal.anchors.length !== 1 || proposal.anchors[0]?.kind !== 'json-pointer')
        return null;
    const pointer = proposal.anchors[0]?.hint;
    return typeof pointer === 'string' && pointer.startsWith('/') ? pointer : null;
}
function isOnlyDeclaredPointerMutation(before, after, pointer) {
    const beforeWithoutPointer = structuredClone(before);
    const afterWithoutPointer = structuredClone(after);
    deleteJsonPointer(beforeWithoutPointer, pointer);
    deleteJsonPointer(afterWithoutPointer, pointer);
    return JSON.stringify(beforeWithoutPointer) === JSON.stringify(afterWithoutPointer);
}
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pointerTokens(pointer) {
    return pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}
function readJsonPointer(document, pointer) {
    let current = document;
    for (const token of pointerTokens(pointer)) {
        if (!isJsonObject(current) || !(token in current))
            return undefined;
        current = current[token];
    }
    return structuredClone(current);
}
function setJsonPointer(document, pointer, value) {
    const tokens = pointerTokens(pointer);
    let current = document;
    for (const token of tokens.slice(0, -1)) {
        const next = current[token];
        if (!isJsonObject(next))
            current[token] = {};
        current = current[token];
    }
    const leaf = tokens.at(-1);
    if (!leaf)
        throw new Error('JSON pointer must target a property.');
    if (value === undefined)
        delete current[leaf];
    else
        current[leaf] = value;
}
function deleteJsonPointer(document, pointer) {
    if (!isJsonObject(document))
        return;
    const tokens = pointerTokens(pointer);
    let current = document;
    for (const token of tokens.slice(0, -1)) {
        const next = current[token];
        if (!isJsonObject(next))
            return;
        current = next;
    }
    const leaf = tokens.at(-1);
    if (leaf)
        delete current[leaf];
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
        if (hashContent(before) !== slice.baseHash) {
            blockedReasons.push(`canonical target base hash is stale: ${slice.filePath}`);
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
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-apply-'));
    const backups = new Map();
    const writtenFiles = [];
    const receipts = [];
    let failedFile = null;
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
        let writeCount = 0;
        for (const slice of fileSlices) {
            const output = outputByPath.get(normalizePath(slice.filePath));
            const targetPath = resolveInsideRoot(cwd, slice.filePath);
            const before = readFileSync(targetPath, 'utf8');
            backups.set(slice.filePath, before);
            failedFile = slice.filePath;
            if (input.failAfterWrites !== undefined && writeCount >= input.failAfterWrites) {
                throw new Error(`injected apply failure before ${slice.filePath}`);
            }
            // The neutral steward is the only owner of this canonical write primitive.
            writeFileSync(targetPath, output.content, 'utf8');
            writeCount += 1;
            writtenFiles.push(slice.filePath);
            receipts.push({
                filePath: slice.filePath,
                beforeHash: hashContent(before),
                afterHash: hashContent(output.content),
                canonicalWriteCount: 1,
                tempOutputHash: slice.outputHash
            });
        }
        return {
            ok: true,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files: receipts,
                verdict: 'applied',
                blockedReasons: []
            })
        };
    }
    catch (error) {
        const restoredFiles = [];
        for (const [filePath, content] of [...backups].reverse()) {
            const targetPath = resolveInsideRoot(cwd, filePath);
            if (!targetPath)
                continue;
            writeFileSync(targetPath, content, 'utf8');
            restoredFiles.push(filePath);
        }
        return {
            ok: false,
            receipt: buildReceipt(input, {
                candidateDigest,
                canonicalRoot: cwd,
                files: receipts,
                verdict: 'rolled-back',
                blockedReasons: [error instanceof Error ? error.message : String(error)],
                compensation: {
                    restoredFiles: restoredFiles.sort((left, right) => left.localeCompare(right)),
                    failedFile,
                    reason: writtenFiles.length > 0 ? 'restored canonical files after partial apply failure' : 'discarded materialized temp outputs before canonical write'
                }
            })
        };
    }
    finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
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
    const relative = path.relative(root, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative))
        return null;
    return targetPath;
}
