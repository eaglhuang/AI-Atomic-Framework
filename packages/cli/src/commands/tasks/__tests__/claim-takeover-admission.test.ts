import assert from 'node:assert/strict';
import { isLiveActiveClaim, isTakeoverEligibleClaim } from '../task-ledger-readers.ts';

const now = '2026-08-14T03:20:00.000Z';
const base = {
  leaseId: 'lease-test',
  taskId: 'TASK-TEST-0001',
  actorId: 'previous-captain',
  claimedAt: '2026-08-14T03:00:00.000Z',
  heartbeatAt: '2026-08-14T03:19:59.000Z',
  ttlSeconds: 1800,
  files: ['packages/example.ts']
} as const;

assert.equal(
  isTakeoverEligibleClaim({ ...base, state: 'released' }, now),
  true,
  'released provenance must not block takeover merely because its retained heartbeat is fresh'
);
assert.equal(
  isTakeoverEligibleClaim({ ...base, state: 'active' }, now),
  false,
  'a fresh active claim remains non-takeoverable'
);
assert.equal(
  isTakeoverEligibleClaim({ ...base, state: 'active', heartbeatAt: '2026-08-14T02:49:59.000Z' }, now),
  true,
  'an expired active claim remains takeoverable'
);
assert.equal(
  isLiveActiveClaim({ ...base, state: 'released' }, now),
  false,
  'a retained provenance heartbeat must not be elevated to live authority'
);

console.log('[claim-takeover-admission] ok');
