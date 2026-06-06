/**
 * Unit tests for file-I/O helpers in `packages/cli/src/commands/tasks/task-file-io-helpers.ts`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import {
  normalizeRelativePath,
  collectTaskFileValues,
  taskPathFor,
  safeTaskFileReadDir,
  safeTaskFileStat,
  readJsonRecord,
  legacyTaskRequiresBaseline,
  type LegacyLedgerTaskFile
} from '../../packages/cli/src/commands/tasks/task-file-io-helpers.ts';

// ── normalizeRelativePath ────────────────────────────────────────────────────────
{
  assert.equal(normalizeRelativePath('  .\\src\\commands\\tasks.ts  '), './src/commands/tasks.ts');
  assert.equal(normalizeRelativePath('./foo/bar'), 'foo/bar');
  assert.equal(normalizeRelativePath('foo\\bar\\baz'), 'foo/bar/baz');
  assert.equal(normalizeRelativePath(''), '');
}

// ── collectTaskFileValues ─────────────────────────────────────────────────────────
{
  const files = new Set<string>();
  collectTaskFileValues('foo\\bar', files);
  collectTaskFileValues(['baz/qux', './demo.ts'], files);
  collectTaskFileValues(12345, files); // 應該安全跳過非字串與陣列的值
  assert.deepEqual(Array.from(files), ['foo/bar', 'baz/qux', 'demo.ts']);
}

// ── safeTaskFileReadDir ──────────────────────────────────────────────────────────
{
  const dir = safeTaskFileReadDir(process.cwd());
  assert.ok(dir.length > 0);
  assert.ok(dir.some((d) => d.name === 'package.json'));

  const emptyDir = safeTaskFileReadDir('non-existent-directory-xyz');
  assert.deepEqual(emptyDir, []);
}

// ── safeTaskFileStat ─────────────────────────────────────────────────────────────
{
  const stats = safeTaskFileStat(path.join(process.cwd(), 'package.json'));
  assert.ok(stats !== null);
  assert.ok(stats.isFile());

  const noStats = safeTaskFileStat('non-existent-file-xyz');
  assert.equal(noStats, null);
}

// ── readJsonRecord ───────────────────────────────────────────────────────────────
{
  const record = readJsonRecord(path.join(process.cwd(), 'package.json'));
  assert.equal(record.name, 'ai-atomic-framework');

  const emptyRecord = readJsonRecord('non-existent-file-xyz');
  assert.deepEqual(emptyRecord, {});

  // 測試損毀的 JSON
  const tempPath = path.join(process.cwd(), 'temp-broken.json');
  try {
    writeFileSync(tempPath, '{broken: json', 'utf8');
    const brokenRecord = readJsonRecord(tempPath);
    assert.deepEqual(brokenRecord, {});
  } finally {
    if (existsSync(tempPath)) {
      rmSync(tempPath);
    }
  }
}

// ── taskPathFor ──────────────────────────────────────────────────────────────────
{
  const root = process.cwd();
  const taskPath = taskPathFor(root, 'TASK-AAO-0097');
  // 由於讀取政策，預設應回傳 .atm/history/tasks 下的路徑
  assert.ok(taskPath.endsWith('TASK-AAO-0097.json'));
  assert.ok(taskPath.includes('.atm'));
}

// ── legacyTaskRequiresBaseline ───────────────────────────────────────────────────
{
  const root = process.cwd();
  const mockTask: LegacyLedgerTaskFile = {
    absolutePath: 'dummy',
    relativePath: 'dummy',
    taskId: 'TASK-DUMMY',
    status: 'open',
    format: 'json',
    document: {
      originProvider: 'github',
      originTaskId: '123'
    }
  };

  // status 為 open，但帶有 originProvider 與 originTaskId，且沒有 lastTransitionId，應回傳 true (需要 baseline)
  assert.equal(legacyTaskRequiresBaseline(root, mockTask), true);

  const mockTaskDone: LegacyLedgerTaskFile = {
    absolutePath: 'dummy',
    relativePath: 'dummy',
    taskId: 'TASK-DUMMY',
    status: 'done',
    format: 'json',
    document: {}
  };
  // status 為 done，且無 lastTransitionId，應回傳 true
  assert.equal(legacyTaskRequiresBaseline(root, mockTaskDone), true);

  const mockTaskNoTransition: LegacyLedgerTaskFile = {
    absolutePath: 'dummy',
    relativePath: 'dummy',
    taskId: 'TASK-DUMMY',
    status: 'open',
    format: 'json',
    document: {}
  };
  // status 為 open，無 origin 資訊，無 lastTransitionId，應回傳 false
  assert.equal(legacyTaskRequiresBaseline(root, mockTaskNoTransition), false);
}

console.log('[unit:task-file-io-helpers] ok (7 groups, 20+ assertions)');
