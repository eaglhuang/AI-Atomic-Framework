import { createHash } from 'node:crypto';
export const GAP_NORMALIZATION_SCHEMA_ID = 'atm.gapNormalization.v1';
export const LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID = 'atm.lexicographicProposalPlan.v1';
export function normalizeGaps(observations) {
    const diagnostics = [];
    const groups = new Map();
    for (const observation of observations) {
        const normalized = normalizeObservation(observation);
        const key = semanticKey(normalized);
        const entries = groups.get(key) ?? [];
        entries.push(normalized);
        groups.set(key, entries);
    }
    const gaps = [];
    for (const [key, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const observed = new Set(entries.map((entry) => entry.observed));
        if (observed.size > 1)
            diagnostics.push(`ambiguous-gap:${key}`);
        const representative = [...entries].sort((a, b) => a.observed.localeCompare(b.observed))[0];
        gaps.push({
            ...representative,
            gapId: `gap:${sha256(key)}`,
            provenance: mergeProvenance(entries)
        });
    }
    const status = diagnostics.some((entry) => entry.startsWith('ambiguous-gap:')) ? 'blocked' : 'proven';
    const frontierDigest = digest(gaps.map(({ gapId, kind, target, dimension, expected, observed }) => ({ gapId, kind, target, dimension, expected, observed })));
    return {
        schemaId: GAP_NORMALIZATION_SCHEMA_ID,
        specVersion: '0.1.0',
        status,
        gaps,
        diagnostics,
        repairCommand: status === 'proven' ? null : 'disambiguate conflicting observations, reseal the gap frontier, then recompile',
        frontierDigest
    };
}
export const compileGapNormalization = normalizeGaps;
export function planLexicographicProposals(input) {
    const diagnostics = [];
    const normalizedFrontier = Array.isArray(input.frontier) ? null : input.frontier;
    const baseFrontier = [...(normalizedFrontier === null ? input.frontier : normalizedFrontier.gaps.map((gap) => gap.gapId))].sort();
    if (normalizedFrontier !== null && normalizedFrontier.status !== 'proven')
        diagnostics.push('frontier-not-proven');
    const frontier = new Set(baseFrontier);
    const proposals = input.proposals.map(normalizeProposal);
    const seen = new Set();
    for (const proposal of proposals) {
        if (seen.has(proposal.proposalId))
            diagnostics.push(`duplicate-proposal:${proposal.proposalId}`);
        seen.add(proposal.proposalId);
        if (!frontier.has(proposal.gapId))
            diagnostics.push(`proposal-outside-frontier:${proposal.proposalId}`);
    }
    const orderedProposals = proposals.sort(compareProposal).map((proposal) => ({
        ...proposal,
        proposalDigest: digest({ proposalId: proposal.proposalId, gapId: proposal.gapId, action: proposal.action, target: proposal.target, preconditionDigest: proposal.preconditionDigest, postconditionDigest: proposal.postconditionDigest })
    }));
    const accepted = [...(input.acceptedProposalIds ?? orderedProposals.map((proposal) => proposal.proposalId))];
    const acceptedSet = new Set(accepted);
    for (const id of accepted)
        if (!seen.has(id))
            diagnostics.push(`accepted-proposal-missing:${id}`);
    const resultingFrontier = baseFrontier.filter((gapId) => !orderedProposals.some((proposal) => acceptedSet.has(proposal.proposalId) && proposal.gapId === gapId));
    if (resultingFrontier.length >= baseFrontier.length && accepted.length > 0)
        diagnostics.push('frontier-not-reduced');
    const status = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('accepted-proposal-missing:') || entry === 'frontier-not-reduced') ? 'contradictory' : diagnostics.length ? 'blocked' : 'proven';
    const repairCommand = status === 'proven' ? null : 'repair the sealed frontier/proposal set, then re-run deterministic planning';
    return {
        schemaId: LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID,
        specVersion: '0.1.0',
        status,
        baseFrontier,
        orderedProposals,
        acceptedProposalIds: accepted,
        resultingFrontier,
        diagnostics,
        repairCommand,
        planDigest: digest({ baseFrontier, orderedProposals, acceptedProposalIds: accepted, resultingFrontier, status, diagnostics })
    };
}
export const compileLexicographicProposalPlan = planLexicographicProposals;
export function replayLexicographicProposalPlan(plan) {
    return planLexicographicProposals({ frontier: plan.baseFrontier, proposals: plan.orderedProposals, acceptedProposalIds: plan.acceptedProposalIds });
}
export function validateLexicographicProposalPlan(plan) {
    const replay = replayLexicographicProposalPlan(plan);
    const diagnostics = [...plan.diagnostics];
    if (replay.planDigest !== plan.planDigest)
        diagnostics.push('plan-digest-mismatch');
    return { ok: diagnostics.length === 0 && plan.status === 'proven', diagnostics: [...new Set(diagnostics)] };
}
function normalizeObservation(input) {
    return { kind: text(input.kind), target: text(input.target), dimension: text(input.dimension), expected: text(input.expected), observed: text(input.observed), provenance: input.provenance ?? {} };
}
function normalizeProposal(input) { return { proposalId: text(input.proposalId), gapId: text(input.gapId), action: text(input.action), target: text(input.target), preconditionDigest: text(input.preconditionDigest), postconditionDigest: text(input.postconditionDigest), provenance: input.provenance ?? {} }; }
function semanticKey(input) { return [input.kind, input.target, input.dimension, input.expected].join('\u001f'); }
function mergeProvenance(entries) { return Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.provenance ?? {})).sort(([a], [b]) => a.localeCompare(b))); }
function compareProposal(a, b) { return [a.gapId, a.action, a.target, a.preconditionDigest, a.postconditionDigest, a.proposalId].join('\u001f').localeCompare([b.gapId, b.action, b.target, b.preconditionDigest, b.postconditionDigest, b.proposalId].join('\u001f')); }
function text(value) { return String(value ?? '').trim(); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function digest(value) { return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`; }
function stableStringify(value) { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`; const record = value; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`; }
