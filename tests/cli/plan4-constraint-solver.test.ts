import assert from 'node:assert/strict';
import { solveConstraintModel, validateConstraintSolverResult, replayConstraintSolverResult } from '../../packages/core/src/evidence/constraint-solver.ts';

const input = { solverId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: true, digest: 'sha256:fixture' }, constraints: [
  { constraintId: 'b', variable: 'score', operator: 'max' as const, value: 10 },
  { constraintId: 'a', variable: 'score', operator: 'min' as const, value: 1 },
  { constraintId: 'c', variable: 'mode', operator: 'eq' as const, value: 'safe' }
] };
const result = solveConstraintModel(input);
assert.equal(result.status, 'satisfiable');
assert.equal(result.assignments[0].variable, 'mode');
assert.equal(validateConstraintSolverResult(result).ok, true);
assert.equal(replayConstraintSolverResult(input, result).deterministic, true);
assert.equal(result.semanticQuotient.length, 3);
console.log('plan4 constraint solver: PASS');
