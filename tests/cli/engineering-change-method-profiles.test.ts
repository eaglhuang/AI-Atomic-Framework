import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateEngineeringChangeMethodFidelity,
  selectEngineeringChangeMethodProfiles,
  type EngineeringChangeMethodProfile
} from '../../packages/core/src/skills/index.ts';

const catalog = JSON.parse(readFileSync('scripts/engineering-change-method-profiles.json', 'utf8'));
const profiles = catalog.profiles as EngineeringChangeMethodProfile[];

assert.equal(catalog.schemaId, 'atm.engineeringChangeMethodProfiles.v1');
assert.equal(new Set(profiles.map((profile) => profile.id)).size, profiles.length);

const forbidden = /(TASK-[A-Z]+-\d+|claude|cursor|codex|C:\\|\/Users\/|AI-Atomic-Framework)/i;
for (const profile of profiles) {
  assert.equal(profile.schemaId, 'atm.engineeringChangeMethodProfile.v1');
  assert(!forbidden.test(JSON.stringify(profile)), `${profile.id} must stay provider/task/repo neutral`);
}

const selection = selectEngineeringChangeMethodProfiles(profiles, {
  changeSummary: 'Broad schema migration must keep old form until zero caller contract gate.',
  changedPublicSeams: ['public contract migration']
});
assert(selection.selectedProfileIds.includes('expand-contract'));

const expand = profiles.find((profile) => profile.id === 'expand-contract')!;
const blockedExpand = evaluateEngineeringChangeMethodFidelity({
  taskId: 'TASK-SKL-0034',
  profile: expand,
  observations: ['expand step', 'independently green migration batch'],
  evidenceRefs: ['old-form usage query'],
  counterexamplesCleared: ['single private callsite', 'pure documentation change'],
  rollbackRefs: ['contract-compatible revert path']
});
assert.equal(blockedExpand.valid, false);
assert(blockedExpand.missing.includes('expand-contract:zero-caller-contract-gate'));

const validExpand = evaluateEngineeringChangeMethodFidelity({
  taskId: 'TASK-SKL-0034',
  profile: expand,
  observations: ['expand step', 'independently green migration batch', 'old-form usage query', 'zero-caller contract gate'],
  evidenceRefs: ['old-form usage query', 'zero-caller contract gate'],
  counterexamplesCleared: ['single private callsite', 'pure documentation change'],
  rollbackRefs: ['contract-compatible revert path'],
  oldFormUsageQueryRef: 'rg old_contract_form',
  zeroCallerGateRef: 'node --strip-types tests/contract/zero-caller.test.ts'
});
assert.equal(validExpand.valid, true);

const tdd = profiles.find((profile) => profile.id === 'tdd-oracle-fidelity')!;
const tautology = evaluateEngineeringChangeMethodFidelity({
  taskId: 'TASK-SKL-0034',
  profile: tdd,
  observations: ['independent oracle source', 'red case proves behavior gap', 'green case reuses same case id', 'tautological expected value'],
  evidenceRefs: ['red evidence', 'green evidence', 'candidate digest'],
  counterexamplesCleared: ['private method', 'internal mock', 'tautological'],
  rollbackRefs: ['revert candidate while retaining red fixture'],
  independentOracleRefs: ['external spec table']
});
assert.equal(tautology.valid, false);
assert(tautology.antiPatterns.includes('tdd-oracle:tautological-test'));

const merge = profiles.find((profile) => profile.id === 'merge-conflict-intent')!;
const unsafeMerge = evaluateEngineeringChangeMethodFidelity({
  taskId: 'TASK-SKL-0034',
  profile: merge,
  observations: ['ours/theirs'],
  evidenceRefs: ['both-side intent receipt', 'post-merge validator'],
  counterexamplesCleared: ['ours/theirs'],
  rollbackRefs: ['abort merge or revert conflict-resolution commit'],
  bothSideIntentRefs: ['left']
});
assert.equal(unsafeMerge.valid, false);
assert(unsafeMerge.antiPatterns.includes('merge-conflict:mandates-ours-theirs'));
