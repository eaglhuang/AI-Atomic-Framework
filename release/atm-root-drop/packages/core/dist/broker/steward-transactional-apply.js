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
        let after = before;
        for (const proposal of proposals) {
            // Patches compose against the immutable base; canonical writes happen later.
            after = applyUnifiedPatch(after, proposal.patch);
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
