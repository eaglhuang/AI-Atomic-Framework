import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createClaimRecord,
  isClaimExpired,
  listRuntimeLockTaskIds,
  parseClaimRecord,
} from '../../../../packages/cli/src/commands/tasks/task-ledger-readers.ts';
import { assert, makeHostRepo } from './implementation.ts';

/**
 * Complete contract family for task-ledger claim and runtime-lock readers.
 * Kept separate from the legacy integration-suite carrier so this atom is
 * readable, independently testable, and safe to evolve.
 */
export function validateTaskLedgerReadersAtomization(tempRoot: string) {
  const timestamp = new Date().toISOString();
  const record = createClaimRecord({
    taskId: 'TASK-ATOM-9999',
    actorId: 'atom-agent',
    files: ['src/atom.ts', 'src/sub/helper.ts'],
    ttlSeconds: 300,
    timestamp,
  });

  assert(record.actorId === 'atom-agent', 'createClaimRecord actorId must match');
  assert(record.leaseId.startsWith('lease-'), 'createClaimRecord leaseId must start with lease-');
  assert(record.claimedAt === timestamp, 'createClaimRecord claimedAt must match');
  assert(record.files.includes('src/atom.ts'), 'createClaimRecord files must preserve normalized relative paths');

  const parsed = parseClaimRecord(record);
  assert(parsed !== null, 'parseClaimRecord must successfully parse valid claim record');
  assert(parsed!.actorId === 'atom-agent', 'parseClaimRecord actorId must match');
  assert(
    isClaimExpired(record, new Date(Date.parse(timestamp) + 100 * 1000).toISOString()) === false,
    'isClaimExpired must be false before TTL expiration',
  );
  assert(
    isClaimExpired(record, new Date(Date.parse(timestamp) + 400 * 1000).toISOString()) === true,
    'isClaimExpired must be true after TTL expiration',
  );

  const dummyRepo = makeHostRepo(tempRoot, 'atom-ledger-readers-locks-test');
  const locksDir = path.join(dummyRepo, '.atm', 'runtime', 'locks');
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(path.join(locksDir, 'TASK-LOCK-0001.lock.json'), JSON.stringify({}), 'utf8');
  writeFileSync(path.join(locksDir, 'TASK-LOCK-0002.lock.json'), JSON.stringify({}), 'utf8');

  const lockTaskIds = listRuntimeLockTaskIds(dummyRepo);
  assert(lockTaskIds.includes('TASK-LOCK-0001'), 'listRuntimeLockTaskIds must list TASK-LOCK-0001');
  assert(lockTaskIds.includes('TASK-LOCK-0002'), 'listRuntimeLockTaskIds must list TASK-LOCK-0002');
}

