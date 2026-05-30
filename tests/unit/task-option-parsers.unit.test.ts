/**
 * Unit tests for option parsers in `packages/cli/src/commands/tasks/task-option-parsers.ts`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import {
  parseAuditOptions,
  parseResetOptions,
  parseHistoricalDeliveryRefs,
  parseScopeAddOptions,
  parseCreateOptions
} from '../../packages/cli/src/commands/tasks/task-option-parsers.ts';

// ── parseAuditOptions ─────────────────────────────────────────────────────────────
{
  const res = parseAuditOptions(['--staged']);
  assert.equal(res.staged, true);
  assert.equal(res.cwd, path.resolve(process.cwd()));
}

{
  const res = parseAuditOptions(['--staged', '--json']);
  assert.equal(res.staged, true);
}

{
  assert.throws(() => {
    parseAuditOptions(['--invalid-flag']);
  }, (err) => {
    return err instanceof CliError && err.code === 'ATM_CLI_USAGE';
  });
}

// ── parseResetOptions ──────────────────────────────────────────────────────────────
{
  const res = parseResetOptions(['--task', 'TASK-AAO-0095', '--to', 'review', '--reason', 'some-reason']);
  assert.equal(res.taskId, 'TASK-AAO-0095');
  assert.equal(res.to, 'review');
  assert.equal(res.reason, 'some-reason');
}

{
  assert.throws(() => {
    parseResetOptions(['--to', 'review']);
  }, (err) => {
    return err instanceof CliError && err.code === 'ATM_CLI_USAGE' && err.message.includes('requires --task');
  });
}

// ── parseHistoricalDeliveryRefs ───────────────────────────────────────────────────
{
  const refs = parseHistoricalDeliveryRefs('  a, b , c  ');
  assert.deepEqual(refs, ['a', 'b', 'c']);
}

{
  const refs = parseHistoricalDeliveryRefs('');
  assert.deepEqual(refs, []);
}

// ── parseScopeAddOptions ──────────────────────────────────────────────────────────
{
  const res = parseScopeAddOptions(['--task', 'TASK-AAO-0095', '--add', 'src/a.ts,src/b.ts']);
  assert.equal(res.taskId, 'TASK-AAO-0095');
  assert.deepEqual(res.addPaths, ['src/a.ts', 'src/b.ts']);
}

{
  assert.throws(() => {
    parseScopeAddOptions(['--task', 'TASK-AAO-0095']);
  }, (err) => {
    return err instanceof CliError && err.code === 'ATM_CLI_USAGE' && err.message.includes('requires --add');
  });
}

// ── parseCreateOptions ───────────────────────────────────────────────────────────
{
  const res = parseCreateOptions(['--task', 'TASK-AAO-0095', '--title', 'My Custom Title', '--force']);
  assert.equal(res.taskId, 'TASK-AAO-0095');
  assert.equal(res.title, 'My Custom Title');
  assert.equal(res.force, true);
}

console.log('[unit:task-option-parsers] ok (5 groups, 15+ assertions)');
