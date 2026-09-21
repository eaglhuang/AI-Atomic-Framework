import assert from 'node:assert/strict';
import { normalizeGaps, planLexicographicProposals, replayLexicographicProposalPlan, validateLexicographicProposalPlan } from '../../packages/core/src/evidence/gap-planning.ts';

const frontier = normalizeGaps([{ kind: 'k', target: 'b', dimension: 'd', expected: 'e', observed: 'o' }, { kind: 'k', target: 'a', dimension: 'd', expected: 'e', observed: 'o' }]);
const proposals = [
  { proposalId: 'p2', gapId: frontier.gaps[1].gapId, action: 'repair', target: 'b', preconditionDigest: 'sha256:2', postconditionDigest: 'sha256:3', provenance: { actor: 'z', date: 'later' } },
  { proposalId: 'p1', gapId: frontier.gaps[0].gapId, action: 'repair', target: 'a', preconditionDigest: 'sha256:1', postconditionDigest: 'sha256:2', provenance: { actor: 'a', path: 'different' } }
];
const plan = planLexicographicProposals({ frontier, proposals });
assert.equal(plan.status, 'proven');
assert.deepEqual(plan.orderedProposals.map((p) => p.proposalId), ['p1', 'p2']);
assert.equal(plan.resultingFrontier.length, 0);
assert.deepEqual(replayLexicographicProposalPlan(plan), plan);
assert.deepEqual(validateLexicographicProposalPlan(plan), { ok: true, diagnostics: [] });
console.log('plan4 proposal ordering: ok');
