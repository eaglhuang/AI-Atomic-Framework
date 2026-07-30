import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  createIncidentLearningCandidate
} from '../../packages/core/src/skills/index.ts';
import {
  ATM_BACKLOG_GENERATED_MARKER,
  assertGovernanceBacklogItemReadable,
  parseBacklogItemsFromProjection,
  renderBacklogProjection,
  type GovernanceBacklogItem
} from '../../scripts/validate-governance-projections.ts';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync('schemas/skills/incident-learning-candidate.schema.json', 'utf8'));
const validateCandidate = ajv.compile(schema);

const candidate = createIncidentLearningCandidate({
  reportedAt: '2026-07-30T10:18:39.997Z',
  repo: 'AI-Atomic-Framework',
  backlogItemId: 'ATM-BUG-2026-07-30-282',
  taskId: 'ATM-GOV-0269',
  symptom: 'Planning-source seal treats null planningCommitSha to committed same digest as drift.',
  invariantRefs: ['INV-ATM-008'],
  acceptanceRefs: ['ACC-1', 'ACC-4'],
  reproductionRefs: ['node atm.mjs next --claim --task ATM-GOV-0269 --json'],
  receiptRefs: ['ATM_PLANNING_SOURCE_IDENTITY_DRIFT receipt'],
  publicSeam: 'tasks claim planning-source seal',
  stateTransition: {
    from: 'planned',
    to: 'running'
  },
  observedFactors: [
    'planningCommitSha null',
    'contentDigest unchanged',
    'claim adapter mutates reserve/promote before seal failure'
  ],
  rootCauseHint: 'claim adapter seal ordering and benign seal upgrade classification',
  familyHint: 'planning-source identity and adapter fidelity'
});

assert.equal(validateCandidate(candidate), true, JSON.stringify(validateCandidate.errors));
assert.equal(candidate.evidence.availability, 'available');
assert(candidate.breadthHypotheses.upstreamDownstream.some((value) => value.includes('tasks claim planning-source seal')));
assert(candidate.breadthHypotheses.samePolicyCallers.length > 0);
assert(candidate.breadthHypotheses.siblingAdapters.length > 0);
assert(candidate.breadthHypotheses.adjacentTransitions.some((value) => value.includes('planned -> running')));
assert(candidate.breadthHypotheses.sharedInvariants.some((value) => value.includes('INV-ATM-008')));
assert(candidate.depthHypotheses.boundary.length > 0);
assert(candidate.depthHypotheses.negative.length > 0);
assert(candidate.depthHypotheses.rollback.length > 0);
assert(candidate.depthHypotheses.retry.length > 0);
assert(candidate.depthHypotheses.concurrency.length > 0);
assert(candidate.depthHypotheses.mutation.length > 0);
assert(candidate.depthHypotheses.propertyMetamorphic.length > 0);
assert(candidate.depthHypotheses.independentOracle.length > 0);
assert.equal(candidate.authorityLimits.cannotAuthorizeMerge, true);
assert.equal(candidate.authorityLimits.cannotDeclareFixSuccess, true);
assert.equal(candidate.authorityLimits.cannotExcludeTests, true);
assert.equal(candidate.authorityLimits.cannotCloseTask, true);
assert.equal(candidate.authorityLimits.doesNotCreateSecondBacklog, true);

const unknownSafeCandidate = createIncidentLearningCandidate({
  reportedAt: '2026-07-30T10:18:39.997Z',
  repo: 'AI-Atomic-Framework',
  symptom: 'Backlog report says an adapter is leaking, but no command receipt is attached.'
});

assert.equal(validateCandidate(unknownSafeCandidate), true, JSON.stringify(validateCandidate.errors));
assert.equal(unknownSafeCandidate.evidence.availability, 'unavailable');
assert.equal(unknownSafeCandidate.disposition.recommendedAction, 'needs-more-evidence');
assert(unknownSafeCandidate.disposition.unknowns.includes('reproduction refs unavailable'));
assert(unknownSafeCandidate.disposition.unknowns.includes('receipt refs unavailable'));
assert.equal(unknownSafeCandidate.disposition.rootCauseHint, null);
assert.equal(unknownSafeCandidate.disposition.familyHint, null);

const item: GovernanceBacklogItem = {
  schemaId: 'atm.governanceBacklogItem.v1',
  id: 'ATM-BUG-2026-07-30-999',
  date: '2026-07-30',
  repo: 'AI-Atomic-Framework',
  type: 'Bug',
  severity: 'Medium',
  status: 'Open',
  area: 'Governance',
  finding: 'Incident learning candidate is separate from backlog record authority.',
  expectedBehavior: 'Backlog item remains readable and projection remains generated.',
  evidenceOrRepro: 'unit fixture',
  followUp: 'open scoped test cards from candidate hypotheses'
};

assert.deepEqual(assertGovernanceBacklogItemReadable(item), []);
const rendered = renderBacklogProjection('# ATM backlog\n', [item]);
assert(rendered.includes(ATM_BACKLOG_GENERATED_MARKER));
const parsed = parseBacklogItemsFromProjection(rendered);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.id, item.id);
assert.equal(parsed[0]?.schemaId, 'atm.governanceBacklogItem.v1');

const template = readFileSync('templates/skills/atm-bug-backlog.skill.md', 'utf8');
for (const requiredTerm of [
  'atm.incidentLearningCandidate.v1',
  'upstream/downstream',
  'same-policy callers',
  'sibling adapters',
  'adjacent transitions',
  'shared invariants',
  'property/metamorphic',
  'independent-oracle',
  'cannot authorize merge',
  'cannot declare fix success',
  'cannot exclude',
  'cannot close'
]) {
  assert(template.includes(requiredTerm), `atm-bug-backlog template missing ${requiredTerm}`);
}
