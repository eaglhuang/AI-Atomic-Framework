import { rebaseProposalsByRegionIdentity } from './steward-region-rebase.js';
import { parseUnifiedPatchHunks } from './unified-patch.js';
/** Exhaustive permutation checks stay cheap up to this many proposals per file. */
const MAX_EXHAUSTIVE_PERMUTATION_PROPOSALS = 4;
export function composeTextPatchesAgainstBase(filePath, before, proposals) {
    const declared = composeTextPatchesAtDeclaredLines(filePath, before, proposals);
    if (declared.ok || declared.block.code !== 'compose-context-mismatch')
        return declared;
    return rebaseProposalsByRegionIdentity(filePath, before, proposals) ?? declared;
}
function composeTextPatchesAtDeclaredLines(filePath, before, proposals) {
    const lineEnding = /\r\n/.test(before) ? '\r\n' : '\n';
    const endsWithNewline = before.endsWith('\n');
    const baseLines = before.split(/\r?\n/);
    if (endsWithNewline)
        baseLines.pop();
    const edits = [];
    for (const proposal of proposals) {
        const edit = resolveProposalEdit(proposal, baseLines);
        if ('detail' in edit) {
            return { ok: false, block: { code: 'compose-context-mismatch', filePath, proposalIds: [proposal.proposalId], detail: edit.detail } };
        }
        edits.push(edit);
    }
    for (let left = 0; left < edits.length; left += 1) {
        for (let right = left + 1; right < edits.length; right += 1) {
            const overlap = describeOverlap(edits[left], edits[right]);
            if (overlap) {
                const proposalIds = [edits[left].proposalId, edits[right].proposalId].sort((a, b) => a.localeCompare(b));
                return {
                    ok: false,
                    block: {
                        code: 'steward-final-patch-required',
                        filePath,
                        proposalIds,
                        detail: `proposals '${proposalIds[0]}' and '${proposalIds[1]}' ${overlap} of ${filePath}; a steward-authored final patch is required`
                    }
                };
            }
        }
    }
    const orders = permutationsToCheck(edits);
    const outputs = new Set(orders.map((order) => renderComposition(baseLines, order, lineEnding, endsWithNewline)));
    if (outputs.size !== 1) {
        return {
            ok: false,
            block: { code: 'compose-permutation-unstable', filePath, proposalIds: edits.map((edit) => edit.proposalId).sort((a, b) => a.localeCompare(b)), detail: `composition of ${filePath} differs across ${orders.length} proposal orders` }
        };
    }
    return { ok: true, content: [...outputs][0], checkedPermutationCount: orders.length };
}
/** Human-readable blocked reason, prefixed with its code like other steward reasons. */
export function formatStewardCompositionBlock(block) {
    return `${block.code}: ${block.detail} [proposals: ${block.proposalIds.join(', ')}]`;
}
function resolveProposalEdit(proposal, baseLines) {
    const span = new Set();
    const deleted = new Set();
    const inserts = new Map();
    let cursor = 0;
    for (const hunk of parseUnifiedPatchHunks(proposal.patch)) {
        const start = hunk.oldStart - 1;
        if (start < cursor)
            return { detail: `proposal '${proposal.proposalId}' hunk at old line ${hunk.oldStart} overlaps an earlier hunk` };
        if (start > baseLines.length)
            return { detail: `proposal '${proposal.proposalId}' hunk at old line ${hunk.oldStart} starts past the end of a ${baseLines.length}-line base` };
        cursor = start;
        for (const entry of hunk.lines) {
            const marker = entry[0];
            const content = entry.slice(1);
            if (marker === '+') {
                const gap = inserts.get(cursor) ?? [];
                gap.push(content);
                inserts.set(cursor, gap);
                continue;
            }
            if (baseLines[cursor] !== content) {
                return { detail: `proposal '${proposal.proposalId}' context mismatch at base line ${cursor + 1}: expected ${JSON.stringify(content)}, found ${JSON.stringify(baseLines[cursor] ?? null)}` };
            }
            span.add(cursor);
            if (marker === '-')
                deleted.add(cursor);
            cursor += 1;
        }
    }
    return { proposalId: proposal.proposalId, span, deleted, inserts };
}
function describeOverlap(left, right) {
    const changedCovered = firstShared(left.deleted, right.span) ?? firstShared(right.deleted, left.span);
    if (changedCovered !== null)
        return `change overlapping base line ${changedCovered + 1}`;
    for (const [owner, other] of [[left, right], [right, left]]) {
        for (const gap of owner.inserts.keys()) {
            if (other.inserts.has(gap))
                return `both insert before base line ${gap + 1}`;
            if (other.deleted.has(gap - 1) || other.deleted.has(gap) || (other.span.has(gap - 1) && other.span.has(gap))) {
                return `insert inside the other proposal's hunk before base line ${gap + 1}`;
            }
        }
    }
    return null;
}
function firstShared(left, right) {
    const shared = [...left].filter((value) => right.has(value)).sort((a, b) => a - b);
    return shared[0] ?? null;
}
function renderComposition(baseLines, edits, lineEnding, endsWithNewline) {
    const output = [];
    for (let gap = 0; gap <= baseLines.length; gap += 1) {
        for (const edit of edits)
            output.push(...(edit.inserts.get(gap) ?? []));
        if (gap < baseLines.length && !edits.some((edit) => edit.deleted.has(gap)))
            output.push(baseLines[gap]);
    }
    const joined = output.join(lineEnding);
    return endsWithNewline ? `${joined}${lineEnding}` : joined;
}
function permutationsToCheck(edits) {
    if (edits.length <= 1)
        return [[...edits]];
    if (edits.length > MAX_EXHAUSTIVE_PERMUTATION_PROPOSALS) {
        // Beyond the exhaustive bound, check every rotation plus the reversal.
        const rotations = edits.map((_, shift) => [...edits.slice(shift), ...edits.slice(0, shift)]);
        return [...rotations, [...edits].reverse()];
    }
    const result = [];
    const permute = (prefix, rest) => {
        if (rest.length === 0) {
            result.push(prefix);
            return;
        }
        rest.forEach((edit, index) => permute([...prefix, edit], [...rest.slice(0, index), ...rest.slice(index + 1)]));
    };
    permute([], [...edits]);
    return result;
}
