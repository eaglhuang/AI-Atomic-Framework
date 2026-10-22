import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCloseClaimAuthority, pauseCloseClaimRenewal, withCloseClaimRenewal } from '../close-claim-renewal.ts';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-claim-renew-'));
const file = path.join(cwd, '.atm/history/tasks/TASK.json');
mkdirSync(path.dirname(file), { recursive: true });
const initial = { status: 'running', claim: { actorId: 'owner', leaseId: 'generation-one', state: 'active', heartbeatAt: new Date().toISOString(), ttlSeconds: 1 } };
let renewals = 0;
function reset() { writeFileSync(file, JSON.stringify(initial)); }
async function renew() {
  renewals++;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.claim.heartbeatAt = new Date().toISOString(); doc.claim.ttlSeconds = 14400;
  writeFileSync(file, JSON.stringify(doc));
}
try {
  reset();
  await withCloseClaimRenewal({ cwd, taskId: 'TASK', actorId: 'owner', renew }, async () => {
    assert.equal(renewals, 1, 'automatically renew short authority before preparation');
    await pauseCloseClaimRenewal();
    assert.equal(renewals, 1, 'sufficient remaining authority is not needlessly rewritten');
    const doc = JSON.parse(readFileSync(file, 'utf8')); doc.status = 'done'; doc.claim.state = 'released'; writeFileSync(file, JSON.stringify(doc));
    assertCloseClaimAuthority();
    await pauseCloseClaimRenewal();
    assert.equal(renewals, 1, 'never change a completed close back to running');
  });
  reset();
  await assert.rejects(withCloseClaimRenewal({ cwd, taskId: 'TASK', actorId: 'owner', renew }, async () => {
    const doc = JSON.parse(readFileSync(file, 'utf8')); doc.claim.leaseId = 'generation-two'; writeFileSync(file, JSON.stringify(doc));
    assert.throws(assertCloseClaimAuthority, /ATM_CLOSE_CLAIM_LOST/);
  }), /ATM_CLOSE_CLAIM_LOST/);
  reset();
  await assert.rejects(withCloseClaimRenewal({ cwd, taskId: 'TASK', actorId: 'owner', renew: async () => { throw new Error('renewal denied'); } }, async () => assert.fail('must stop before writing')), /renewal denied/);
  console.log('close-claim-renewal: automatic headroom, close-state preservation and claim generation fencing passed');
} finally { rmSync(cwd, { recursive: true, force: true }); }
