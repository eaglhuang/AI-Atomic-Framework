import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withTakeoverAggregateRollback } from '../../packages/cli/src/commands/tasks/takeover-aggregate-transaction.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-takeover-rollback-'));
const taskPath = path.join(root, 'task.json');
const lockPath = path.join(root, 'lock.json');
writeFileSync(taskPath, '{"status":"running","claim":{"actorId":"old-actor"}}\n', 'utf8');
writeFileSync(lockPath, '{"status":"active","actorId":"old-actor"}\n', 'utf8');

let caught: unknown;
try {
  await withTakeoverAggregateRollback({
    paths: [taskPath, lockPath],
    run: () => {
      writeFileSync(taskPath, '{"status":"running","claim":{"actorId":"new-actor"}}\n', 'utf8');
      writeFileSync(lockPath, '{"status":"active","actorId":"new-actor"}\n', 'utf8');
      throw new Error('injected takeover persistence failure');
    }
  });
} catch (error) {
  caught = error;
}

assert.match(String(caught), /injected takeover persistence failure/);
assert.equal(readFileSync(taskPath, 'utf8'), '{"status":"running","claim":{"actorId":"old-actor"}}\n');
assert.equal(readFileSync(lockPath, 'utf8'), '{"status":"active","actorId":"old-actor"}\n');

console.log('[takeover-aggregate-rollback] ok');
