import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function runTeamPlanProposalParityValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-plan-proposal-parity') return false;

  // TASK-TEAM-0083 (ATM-BUG-2026-07-12-133): a proposal-first block must
  // surface the proposal schema and copyable plan/start commands, and the
  // --broker-proposal-file contract must cover team plan as well as start.
  const { buildProposalFirstParityFindings } = await import('../../../packages/cli/src/commands/team.ts');
  const blockedLane = {
    ok: false,
    evidence: {
      decision: {
        admission: {
          state: 'proposal-submitted',
          hotFiles: ['packages/cli/src/commands/team.ts'],
          reason: 'Hot shared surface requires proposal-first admission.'
        }
      },
      blockedReasons: ['Hot shared surface requires proposal-first admission.']
    }
  } as never;
  const findings = buildProposalFirstParityFindings({ taskId: 'TASK-X', brokerLaneResult: blockedLane });
  assert.equal(findings.length, 1, 'proposal-first block must emit exactly one parity finding');
  assert.equal(findings[0].level, 'error');
  assert.equal(findings[0].code, 'proposal-first-required');
  for (const needle of ['atm.patchProposal.v1', '--broker-proposal-file', 'team plan --task TASK-X', 'team start --task TASK-X', 'broker runtime activate']) {
    assert.ok(findings[0].detail.includes(needle), `parity finding must mention ${needle}`);
  }
  assert.deepEqual(findings[0].paths, ['packages/cli/src/commands/team.ts']);
  const okLane = { ok: true, evidence: { decision: { admission: { state: 'not-required' } }, blockedReasons: [] } } as never;
  assert.equal(buildProposalFirstParityFindings({ taskId: 'TASK-X', brokerLaneResult: okLane }).length, 0, 'admitted lane must add no parity finding');
  const specText = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'command-specs', 'team.spec.ts'), 'utf8');
  assert.ok(specText.includes('consumed by team plan (readiness preview)'), 'team spec must document --broker-proposal-file for plan and start');
  console.log('[validate-team-agents] ok (team-plan-proposal-parity)');
  return true;
}
