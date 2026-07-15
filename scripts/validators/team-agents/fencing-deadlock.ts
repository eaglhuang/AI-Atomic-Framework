import assert from 'node:assert/strict';

import {
  validateScopeLeaseEpoch,
  validateScopeLeaseFencing,
  type ScopeLeaseRunMode
} from '../../../packages/core/src/governance/scope-lock.ts';
import { scopeLease } from './scenario-matrix.ts';

export async function runFencingDeadlockValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'fencing-deadlock') return false;

  const runModes: ScopeLeaseRunMode[] = ['real-agent', 'editor-subagent', 'broker-only'];
  for (const runMode of runModes) {
    const duplicateOwner = validateScopeLeaseFencing([
      scopeLease({ leaseId: `${runMode}-a`, runMode, owner: { instanceId: 'agent-a', worktreeId: 'wt-a' } }),
      scopeLease({ leaseId: `${runMode}-b`, runMode, owner: { instanceId: 'agent-b', worktreeId: 'wt-b' } })
    ]);
    assert.equal(duplicateOwner.ok, false);
    assert.ok(duplicateOwner.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_DUPLICATE_EXCLUSIVE_OWNER'));

    const staleEpoch = validateScopeLeaseEpoch({
      leaseId: `${runMode}-epoch`,
      runMode,
      expectedEpoch: 20,
      actualEpoch: 19
    });
    assert.equal(staleEpoch.ok, false);
    const staleFinding = staleEpoch.findings.find((finding) => finding.code === 'ATM_SCOPE_LEASE_STALE_EPOCH');
    assert.equal(staleFinding?.expectedEpoch, 20);
    assert.equal(staleFinding?.actualEpoch, 19);

    const cycle = validateScopeLeaseFencing([
      scopeLease({ leaseId: `${runMode}-cycle-a`, runMode, resourceKey: 'src/a.ts', waitsFor: [`${runMode}-cycle-b`] }),
      scopeLease({ leaseId: `${runMode}-cycle-b`, runMode, resourceKey: 'src/b.ts', waitsFor: [`${runMode}-cycle-a`] })
    ]);
    assert.equal(cycle.ok, false);
    assert.ok(cycle.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_WAIT_FOR_CYCLE'));

    const tombstone = validateScopeLeaseFencing([
      scopeLease({ leaseId: `${runMode}-released`, runMode, status: 'released', leaseEpoch: 10 }),
      scopeLease({ leaseId: `${runMode}-reacquire`, runMode, leaseEpoch: 10 })
    ]);
    assert.equal(tombstone.ok, false);
    assert.ok(tombstone.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_TOMBSTONE_REACQUIRE'));
  }

  const acyclic = validateScopeLeaseFencing([
    scopeLease({ leaseId: 'acyclic-a', resourceKey: 'src/a.ts', waitsFor: ['acyclic-b'] }),
    scopeLease({ leaseId: 'acyclic-b', resourceKey: 'src/b.ts' })
  ]);
  assert.equal(acyclic.ok, true);

  const outsideAllowedFiles = validateScopeLeaseFencing([
    scopeLease({
      leaseId: 'outside-scope',
      allowedFiles: ['packages/cli/src/commands/team.ts'],
      writeSet: ['packages/cli/src/commands/next.ts']
    })
  ]);
  assert.equal(outsideAllowedFiles.ok, false);
  assert.ok(outsideAllowedFiles.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_ALLOWED_FILES_VIOLATION'));

  console.log('[validate-team-agents] ok (fencing-deadlock)');
  return true;
}
