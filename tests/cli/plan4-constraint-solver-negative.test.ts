import assert from 'node:assert/strict';
import { solveConstraintModel } from '../../packages/core/src/evidence/constraint-solver.ts';

const contradictory = solveConstraintModel({ solverId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: true, digest: 'sha256:fixture' }, constraints: [
  { constraintId: 'a', variable: 'x', operator: 'eq', value: 1 },
  { constraintId: 'b', variable: 'x', operator: 'eq', value: 2 }
] });
assert.equal(contradictory.status, 'infeasible');
assert.ok(contradictory.diagnostics.some((entry) => entry.code === 'ATM_CONSTRAINT_SOLVER_CONTRADICTORY_INPUT'));
const unsealed = solveConstraintModel({ solverId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: false, digest: '' }, constraints: [{ constraintId: 'a', variable: 'x', operator: 'wat', value: 1 }] });
assert.equal(unsealed.status, 'blocked');
assert.ok(unsealed.diagnostics.some((entry) => entry.code === 'ATM_CONSTRAINT_SOLVER_OPERATOR_UNSUPPORTED'));
console.log('plan4 constraint solver negative: PASS');
