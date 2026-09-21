import { createHash } from 'node:crypto';

export const GAP_NORMALIZATION_SCHEMA_ID = 'atm.gapNormalization.v1' as const;
export const LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID = 'atm.lexicographicProposalPlan.v1' as const;

export type GapPlanningStatus = 'proven' | 'blocked' | 'contradictory';

export interface GapObservationInput {
  readonly kind: string;
  readonly target: string;
  readonly dimension: string;
  readonly expected: string;
  readonly observed: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface NormalizedGap {
  readonly gapId: string;
  readonly kind: string;
  readonly target: string;
  readonly dimension: string;
  readonly expected: string;
  readonly observed: string;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface GapNormalizationResult {
  readonly schemaId: typeof GAP_NORMALIZATION_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly status: GapPlanningStatus;
  readonly gaps: readonly NormalizedGap[];
  readonly diagnostics: readonly string[];
  readonly repairCommand: string | null;
  readonly frontierDigest: string;
}

export interface ProposalInput {
  readonly proposalId: string;
  readonly gapId: string;
  readonly action: string;
  readonly target: string;
  readonly preconditionDigest: string;
  readonly postconditionDigest: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface OrderedProposal extends ProposalInput {
  readonly proposalDigest: string;
}

export interface LexicographicProposalPlan {
  readonly schemaId: typeof LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly status: GapPlanningStatus;
  readonly baseFrontier: readonly string[];
  readonly orderedProposals: readonly OrderedProposal[];
  readonly acceptedProposalIds: readonly string[];
  readonly resultingFrontier: readonly string[];
  readonly diagnostics: readonly string[];
  readonly repairCommand: string | null;
  readonly planDigest: string;
}

export function normalizeGaps(observations: readonly GapObservationInput[]): GapNormalizationResult {
  const diagnostics: string[] = [];
  const groups = new Map<string, GapObservationInput[]>();
  for (const observation of observations) {
    const normalized = normalizeObservation(observation);
    const key = semanticKey(normalized);
    const entries = groups.get(key) ?? [];
    entries.push(normalized);
    groups.set(key, entries);
  }
  const gaps: NormalizedGap[] = [];
  for (const [key, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const observed = new Set(entries.map((entry) => entry.observed));
    if (observed.size > 1) diagnostics.push(`ambiguous-gap:${key}`);
    const representative = [...entries].sort((a, b) => a.observed.localeCompare(b.observed))[0];
    gaps.push({
      ...representative,
      gapId: `gap:${sha256(key)}`,
      provenance: mergeProvenance(entries)
    });
  }
  const status: GapPlanningStatus = diagnostics.some((entry) => entry.startsWith('ambiguous-gap:')) ? 'blocked' : 'proven';
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

export function planLexicographicProposals(input: {
  readonly frontier: GapNormalizationResult | readonly string[];
  readonly proposals: readonly ProposalInput[];
  readonly acceptedProposalIds?: readonly string[];
}): LexicographicProposalPlan {
  const diagnostics: string[] = [];
  const normalizedFrontier: GapNormalizationResult | null = Array.isArray(input.frontier) ? null : input.frontier as GapNormalizationResult;
  const baseFrontier = [...(normalizedFrontier === null ? input.frontier as readonly string[] : normalizedFrontier.gaps.map((gap) => gap.gapId))].sort();
  if (normalizedFrontier !== null && normalizedFrontier.status !== 'proven') diagnostics.push('frontier-not-proven');
  const frontier = new Set(baseFrontier);
  const proposals = input.proposals.map(normalizeProposal);
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (seen.has(proposal.proposalId)) diagnostics.push(`duplicate-proposal:${proposal.proposalId}`);
    seen.add(proposal.proposalId);
    if (!frontier.has(proposal.gapId)) diagnostics.push(`proposal-outside-frontier:${proposal.proposalId}`);
  }
  const orderedProposals = proposals.sort(compareProposal).map((proposal) => ({
    ...proposal,
    proposalDigest: digest({ proposalId: proposal.proposalId, gapId: proposal.gapId, action: proposal.action, target: proposal.target, preconditionDigest: proposal.preconditionDigest, postconditionDigest: proposal.postconditionDigest })
  }));
  const accepted = [...(input.acceptedProposalIds ?? orderedProposals.map((proposal) => proposal.proposalId))];
  const acceptedSet = new Set(accepted);
  for (const id of accepted) if (!seen.has(id)) diagnostics.push(`accepted-proposal-missing:${id}`);
  const resultingFrontier = baseFrontier.filter((gapId) => !orderedProposals.some((proposal) => acceptedSet.has(proposal.proposalId) && proposal.gapId === gapId));
  if (resultingFrontier.length >= baseFrontier.length && accepted.length > 0) diagnostics.push('frontier-not-reduced');
  const status: GapPlanningStatus = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('accepted-proposal-missing:') || entry === 'frontier-not-reduced') ? 'contradictory' : diagnostics.length ? 'blocked' : 'proven';
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

export function replayLexicographicProposalPlan(plan: LexicographicProposalPlan): LexicographicProposalPlan {
  return planLexicographicProposals({ frontier: plan.baseFrontier, proposals: plan.orderedProposals, acceptedProposalIds: plan.acceptedProposalIds });
}

export function validateLexicographicProposalPlan(plan: LexicographicProposalPlan) {
  const replay = replayLexicographicProposalPlan(plan);
  const diagnostics = [...plan.diagnostics];
  if (replay.planDigest !== plan.planDigest) diagnostics.push('plan-digest-mismatch');
  return { ok: diagnostics.length === 0 && plan.status === 'proven', diagnostics: [...new Set(diagnostics)] };
}

function normalizeObservation(input: GapObservationInput) {
  return { kind: text(input.kind), target: text(input.target), dimension: text(input.dimension), expected: text(input.expected), observed: text(input.observed), provenance: input.provenance ?? {} };
}
function normalizeProposal(input: ProposalInput): ProposalInput { return { proposalId: text(input.proposalId), gapId: text(input.gapId), action: text(input.action), target: text(input.target), preconditionDigest: text(input.preconditionDigest), postconditionDigest: text(input.postconditionDigest), provenance: input.provenance ?? {} }; }
function semanticKey(input: GapObservationInput) { return [input.kind, input.target, input.dimension, input.expected].join('\u001f'); }
function mergeProvenance(entries: readonly GapObservationInput[]) { return Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.provenance ?? {})).sort(([a], [b]) => a.localeCompare(b))); }
function compareProposal(a: ProposalInput, b: ProposalInput) { return [a.gapId, a.action, a.target, a.preconditionDigest, a.postconditionDigest, a.proposalId].join('\u001f').localeCompare([b.gapId, b.action, b.target, b.preconditionDigest, b.postconditionDigest, b.proposalId].join('\u001f')); }
function text(value: unknown) { return String(value ?? '').trim(); }
function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }
function digest(value: unknown) { return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`; }
function stableStringify(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`; }
