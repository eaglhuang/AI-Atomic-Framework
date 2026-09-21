import assert from 'node:assert/strict';
import {
  buildProposalFirstParityFindings,
  validateTeamPermissionModel
} from '../../packages/cli/src/commands/team/legacy/permission-lease-policy.ts';

// 1. Proposal-first block must return machine-actionable recovery contract
const mockBrokerLaneResult = {
  ok: false,
  evidence: {
    decision: {
      taskId: 'ATM-TEST-001',
      verdict: 'blocked-shared-surface',
      lane: 'steward',
      reason: 'Hot shared surface collision requires proposal-first broker admission',
      admission: {
        state: 'proposal-submitted',
        hotFiles: ['packages/cli/src/commands/foo.ts', 'packages/core/src/bar.ts']
      }
    }
  }
} as any;

const findings = buildProposalFirstParityFindings({
  taskId: 'ATM-TEST-001',
  brokerLaneResult: mockBrokerLaneResult,
  advisoryOnly: false
});

assert.equal(findings.length, 1);
const finding = findings[0]!;
assert.equal(finding.code, 'proposal-first-required');
assert.equal(finding.level, 'error');
assert.deepEqual(finding.paths, ['packages/cli/src/commands/foo.ts', 'packages/core/src/bar.ts']);

// Check required recovery fields on finding
assert.ok(finding.recovery, 'finding.recovery must be present');
assert.equal(finding.recovery?.schemaId, 'atm.patchProposal.v1');
assert.deepEqual(finding.recovery?.hotFiles, ['packages/cli/src/commands/foo.ts', 'packages/core/src/bar.ts']);
assert.equal(finding.recovery?.runtimeWritten, false);
assert.equal(finding.recovery?.teamRunMinted, false);
assert.equal(finding.recovery?.writeLeaseGranted, false);
assert.deepEqual(finding.recovery?.brokerSubject, {
  taskId: 'ATM-TEST-001',
  verdict: 'blocked-shared-surface',
  lane: 'steward',
  reason: 'Hot shared surface collision requires proposal-first broker admission'
});
assert.ok(finding.recovery?.requiredCommands?.planPreview?.includes('--broker-proposal-file <proposal.json>'));
assert.ok(finding.recovery?.requiredCommands?.teamStart?.includes('--broker-proposal-file <proposal.json>'));
assert.ok(finding.recovery?.requiredCommands?.brokerActivate?.includes('--proposal-file <proposal.json>'));

// 2. Read-only preview must also expose the recovery contract as warning
const readOnlyFindings = buildProposalFirstParityFindings({
  taskId: 'ATM-TEST-001',
  brokerLaneResult: mockBrokerLaneResult,
  advisoryOnly: true
});
assert.equal(readOnlyFindings.length, 1);
const readOnlyFinding = readOnlyFindings[0]!;
assert.equal(readOnlyFinding.level, 'warning');
assert.ok(readOnlyFinding.recovery, 'readOnlyFinding.recovery must be present');
assert.equal(readOnlyFinding.recovery?.schemaId, 'atm.patchProposal.v1');
assert.equal(readOnlyFinding.recovery?.runtimeWritten, false);
assert.equal(readOnlyFinding.recovery?.teamRunMinted, false);
assert.equal(readOnlyFinding.recovery?.writeLeaseGranted, false);

// 3. Clean lane (ok: true) or non proposal-submitted must produce no findings
const okBrokerLaneResult = {
  ok: true,
  evidence: {
    decision: {
      admission: {
        state: 'ready'
      }
    }
  }
} as any;
const okFindings = buildProposalFirstParityFindings({
  taskId: 'ATM-TEST-001',
  brokerLaneResult: okBrokerLaneResult,
  advisoryOnly: false
});
assert.equal(okFindings.length, 0);

console.log('team-proposal-first-recovery.test: ok');
