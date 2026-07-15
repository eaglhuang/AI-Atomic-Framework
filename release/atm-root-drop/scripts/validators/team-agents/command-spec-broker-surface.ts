import assert from 'node:assert/strict';
import { TEAM_ATOM_BOUNDARIES } from '../../../packages/cli/src/commands/team.ts';
import {
  teamSpecBrokerLane,
  teamSpecPatrolReport,
  teamSpecRuntimeStatus
} from '../../../packages/cli/src/commands/command-specs/team.spec.ts';

export function runCommandSpecBrokerSurfaceValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'command-spec-broker-surface') return false;
  assert.ok(teamSpecBrokerLane.summary.includes('write transaction identity'));
  assert.ok(teamSpecBrokerLane.summary.includes('lease epoch'));
  assert.ok(teamSpecBrokerLane.summary.includes('read/write sets'));
  assert.ok(teamSpecBrokerLane.summary.includes('file hashes'));
  assert.ok(teamSpecBrokerLane.summary.includes('broker decision linkage'));
  assert.ok(teamSpecRuntimeStatus.summary.includes('broker subagent status fields'));
  assert.ok(teamSpecRuntimeStatus.summary.includes('serialized commit lane'));
  assert.ok(teamSpecRuntimeStatus.examples.some((entry) => entry.includes('team status --compact')));
  assert.ok(teamSpecPatrolReport.summary.includes('broker-governance drift'));
  assert.ok(teamSpecPatrolReport.examples.some((entry) => entry.includes('--team <teamRunId>')));
  assert.ok(TEAM_ATOM_BOUNDARIES['team.patrol-report'].capability.includes('broker-governance evidence gates'));

  console.log('[validate-team-agents] ok (command-spec-broker-surface)');
  return true;
}
