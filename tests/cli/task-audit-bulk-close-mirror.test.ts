import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { auditTasks } from '../../packages/cli/src/commands/framework-development.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runGit(cwd: string, args: readonly string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-audit-bulk-close-mirror-'));

try {
  writeJson(path.join(tempRoot, 'package.json'), {
    name: 'bulk-close-mirror-fixture',
    type: 'module'
  });
  runGit(tempRoot, ['init', '-q']);
  runGit(tempRoot, ['config', '--local', 'user.name', 'test-actor']);
  runGit(tempRoot, ['config', '--local', 'user.email', 'test-actor@example.local']);
  runGit(tempRoot, ['add', '.']);
  runGit(tempRoot, ['commit', '-m', 'initial']);

  const taskIds = ['TASK-MIRROR-BULK-0001', 'TASK-MIRROR-BULK-0002'];
  for (const taskId of taskIds) {
    writeJson(path.join(tempRoot, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`), {
      schemaId: 'atm.closurePacket.v1',
      taskId
    });
  }
  runGit(tempRoot, ['add', '.atm/history/evidence']);
  runGit(tempRoot, ['commit', '-m', 'add existing closure packets']);

  mkdirSync(path.join(tempRoot, 'docs', 'tasks'), { recursive: true });
  for (const taskId of taskIds) {
    writeFileSync(path.join(tempRoot, 'docs', 'tasks', `${taskId}.task.md`), [
      '---',
      `task_id: ${taskId}`,
      'status: done',
      `closure_packet: .atm/history/evidence/${taskId}.closure-packet.json`,
      '---',
      '',
      `# ${taskId}`
    ].join('\n'), 'utf8');
  }
  runGit(tempRoot, ['add', 'docs/tasks']);
  runGit(tempRoot, ['commit', '-m', 'sync done planning mirrors']);

  const headFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: tempRoot, encoding: 'utf8' });
  assert(headFiles.includes('docs/tasks/TASK-MIRROR-BULK-0001.task.md'));
  assert(headFiles.includes('docs/tasks/TASK-MIRROR-BULK-0002.task.md'));

  const audit = auditTasks(tempRoot);
  assert.equal(
    audit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_BULK_CLOSE_WITHOUT_MANIFEST'),
    false,
    'mirror-only done task cards with pre-existing closure packets must not require a bulk closure manifest'
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
