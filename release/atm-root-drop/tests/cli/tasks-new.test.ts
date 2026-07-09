import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-new-cli');

try {
  mkdirSync(tempDir, { recursive: true });

  const outPath = 'TASK-AAO-9999-test.task.md';
  const targetAbsolute = path.join(tempDir, outPath);

  const result = await runTasks([
    'new',
    '--cwd', tempDir,
    '--template', 'aao-l2-split',
    '--task-id', 'TASK-AAO-9999',
    '--title', 'Test CLI Generation',
    '--output', outPath,
    '--scope-path', 'src/commands/tasks.ts',
    '--test-path', 'tests/cli/tasks-new.test.ts',
    '--atom-id', 'atm.test-tasks-cli',
    '--capability', 'CLI test capability',
    '--goal', 'CLI goal description'
  ]);

  assert.ok(result.ok);
  assert.equal(result.command, 'tasks');
  assert.equal(result.evidence.sourcePath, outPath);
  assert.equal(result.evidence.taskId, 'TASK-AAO-9999');
  assert.equal(result.evidence.templateUsed, 'aao-l2-split');

  assert.ok(existsSync(targetAbsolute));
  const generatedText = readFileSync(targetAbsolute, 'utf8');

  // 驗證內容填入正確
  assert.ok(generatedText.includes('task_id: TASK-AAO-9999'));
  assert.ok(generatedText.includes('title: "Test CLI Generation"'));
  assert.ok(generatedText.includes('path: "src/commands/tasks.ts"'));
  assert.ok(generatedText.includes('atom_id: "atm.test-tasks-cli"'));

  const sourceTemplatePath = path.join(root, 'packages/atm-markdown-task-source/templates/aao-l2-split-template.md');
  const packageManifestPath = path.join(root, 'packages/atm-markdown-task-source/package.json');
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
  assert.ok(existsSync(sourceTemplatePath), 'source package must ship the default aao-l2-split task template');
  assert.ok(packageManifest.files.includes('templates'), 'npm package manifest must include task template assets');

  const frozenOutPath = 'nested/TASK-AAO-9998-frozen.task.md';
  const frozenResult = spawnSync(process.execPath, [
    path.join(root, 'atm.mjs'),
    'tasks',
    'new',
    '--cwd', tempDir,
    '--template', 'aao-l2-split',
    '--task-id', 'TASK-AAO-9998',
    '--title', 'Frozen Template Generation',
    '--output', frozenOutPath,
    '--json'
  ], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(frozenResult.status, 0, frozenResult.stderr || frozenResult.stdout);
  const frozenGeneratedText = readFileSync(path.join(tempDir, frozenOutPath), 'utf8');
  assert.ok(frozenGeneratedText.includes('task_id: TASK-AAO-9998'));

} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[tasks-new:cli-test] ok (tasks new CLI command verified)');
