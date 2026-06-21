import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTeamBrokerLane } from '../team-lane.ts';

function testHotFileRequiresProposalFirstAdmission() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-team-lane-'));
  const registryPath = path.join(tempDir, 'write-broker.registry.json');
  const result = evaluateTeamBrokerLane({
    cwd: tempDir,
    taskId: 'TASK-CID-0116',
    actorId: 'captain',
    task: {
      workItemId: 'TASK-CID-0116',
      title: 'proposal-first hot file lane',
      atomizationImpact: { ownerAtomOrMap: 'atm.proposal-first-team-gate' }
    },
    writePaths: ['packages/cli/src/commands/broker.ts'],
    registryPath
  });

  assert.equal(result.ok, false);
  assert.equal(result.evidence.admission.trigger, 'hot-file');
  assert.equal(result.evidence.admission.state, 'proposal-submitted');
  assert.equal(result.evidence.safeToStart, false);
  rmSync(tempDir, { recursive: true, force: true });
  console.log('ok: hot file requires proposal-first admission before start');
}

testHotFileRequiresProposalFirstAdmission();
console.log('team lane tests: ok');
