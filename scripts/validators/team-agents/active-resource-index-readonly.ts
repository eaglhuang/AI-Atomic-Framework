import assert from 'node:assert/strict';
import { runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runActiveResourceIndexReadonlyValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'active-resource-index-readonly') return false;

  const beforeStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
  const beforeEvidence = beforeStatus.evidence as any;
  const plan = await runTeam(['plan', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
  const validate = await runTeam(['validate', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
  const afterStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
  const afterEvidence = afterStatus.evidence as any;

  assert.equal(plan.ok, false);
  assert.equal(validate.ok, true);
  assert.equal(beforeEvidence?.teamRunCount, afterEvidence?.teamRunCount);
  assert.equal((plan.evidence as any)?.runtimeWritten, false);
  assert.equal((validate.evidence as any)?.runtimeWritten, false);
  assert.equal((plan.evidence as any)?.agentsSpawned, false);
  assert.equal((validate.evidence as any)?.agentsSpawned, false);
  assert.equal((plan.evidence as any)?.teamPlan?.brokerLane?.safeToStart, false);
  assert.equal((plan.evidence as any)?.teamPlan?.brokerLane?.admission?.requiresProposal, true);

  console.log('[validate-team-agents] ok (active-resource-index-readonly)');
  return true;
}
