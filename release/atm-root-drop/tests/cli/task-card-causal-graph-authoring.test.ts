import assert from 'node:assert/strict';
import { normalizeTaskCausalGraphContract } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

const contract = normalizeTaskCausalGraphContract({
  causal_dependencies: ['TASK-A', 'TASK-A'], start_conditions: ['broker clean'],
  soft_relations: ['related-plan'], changed_public_seams: ['task-card schema'],
  causal_impact_edges: ['authoring -> import'], parallel_frontier_inputs: ['validator evidence'],
  validator_references: ['npm run typecheck'], phase_owner: 'atm-agent-skills'
});
assert.deepEqual(contract.causalDependencies, ['TASK-A']);
assert.equal(contract.startConditions[0], 'broker clean');
assert.equal(contract.changedPublicSeams[0], 'task-card schema');
assert.equal(contract.phaseOwner, 'atm-agent-skills');
assert.deepEqual(normalizeTaskCausalGraphContract(null).softRelations, []);
