import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from '../../packages/atm-markdown-task-source/src/index.ts';
import { readPluginRegistry } from '../../packages/cli/src/plugin-registry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 1. Verify plugin instance matches ExternalTaskSourcePlugin interface
assert.equal(plugin.kind, 'external-task-source');
assert.equal(plugin.id, 'atm.markdown-task-source');
assert.equal(typeof plugin.parse, 'function');

// 2. Verify parsing on a real task card
const realTaskCardPath = path.resolve(root, '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0083-external-task-source-plugin-interface.task.md');
if (existsSync(realTaskCardPath)) {
  const raw = readFileSync(realTaskCardPath, 'utf8');
  const result = await plugin.parse({
    cwd: root,
    sourcePath: 'tasks/TASK-AAO-0083.md',
    raw
  });

  assert.ok(result);
  assert.equal(result.taskId, 'TASK-AAO-0083');
  assert.equal(result.frontmatter.task_id, 'TASK-AAO-0083');
  assert.ok(result.frontmatter.deliverables);
  assert.ok(result.body && result.body.includes('Goal'));
}

// 3. Verify plugin registry loader using mock .atm/config.json
const tempDir = path.resolve(root, '.atm-temp-test');
mkdirSync(tempDir, { recursive: true });
mkdirSync(path.join(tempDir, '.atm'), { recursive: true });

try {
  // Test disabled state
  const disabledConfig = {
    plugins: {
      externalTaskSources: [
        {
          id: 'atm.markdown-task-source',
          packagePath: '../../packages/atm-markdown-task-source/src/index.ts',
          enabled: false,
          mode: 'disabled'
        }
      ]
    }
  };
  writeFileSync(path.join(tempDir, '.atm/config.json'), JSON.stringify(disabledConfig, null, 2), 'utf8');

  const disabledPlugins = await readPluginRegistry(tempDir);
  assert.equal(disabledPlugins.length, 0);

  // Test enabled state
  const enabledConfig = {
    plugins: {
      externalTaskSources: [
        {
          id: 'atm.markdown-task-source',
          packagePath: '../../packages/atm-markdown-task-source/src/index.ts',
          enabled: true,
          mode: 'advisory'
        }
      ]
    }
  };
  writeFileSync(path.join(tempDir, '.atm/config.json'), JSON.stringify(enabledConfig, null, 2), 'utf8');

  const enabledPlugins = await readPluginRegistry(tempDir);
  assert.equal(enabledPlugins.length, 1);
  assert.equal(enabledPlugins[0].plugin.id, 'atm.markdown-task-source');
  assert.equal(enabledPlugins[0].mode, 'advisory');

} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[atm-markdown-task-source:test] ok (reference plugin & loader verified)');
