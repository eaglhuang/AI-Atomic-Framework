import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../next.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-files-claim-'));

function writeFixtureJson(relativePath: string, value: unknown) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd, stdio: 'ignore' });
  writeFixtureJson('.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
  writeFixtureJson('.atm/runtime/identity/default.json', { actorId: 'files-agent', gitName: 'ATM Fixture', gitEmail: 'fixture@example.invalid', updatedAt: '2026-07-12T00:00:00.000Z' });
  writeFixtureJson('.atm/history/tasks/TASK-FILES.json', {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-FILES',
    title: 'TASK-FILES',
    status: 'ready',
    scopePaths: ['src/a.ts', 'src/b.ts'],
    deliverables: ['src/a.ts', 'src/b.ts'],
    targetAllowedFiles: ['src/a.ts', 'src/b.ts'],
    // A prior claim can leave a direction-lock snapshot behind. The next
    // explicit --files claim must mint its ticket from the new claim scope,
    // not this stale lifecycle-only snapshot.
    taskDirectionLock: {
      allowedFiles: ['.atm/history/tasks/TASK-FILES.json']
    },
    targetRepo: 'fixture',
    closureAuthority: 'target_repo',
    source: { planPath: null }
  });
  mkdirSync(path.join(cwd, 'src'), { recursive: true });
  writeFileSync(path.join(cwd, 'src/a.ts'), 'export const a = true;\n');
  writeFileSync(path.join(cwd, 'src/b.ts'), 'export const b = true;\n');
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture base'], { cwd, stdio: 'ignore' });

  const result = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-FILES', '--actor', 'files-agent', '--claim-intent', 'write', '--files', 'src/a.ts']) as any;
  assert.equal(result.ok, true, 'next --claim should accept explicit --files scope');
  const directionLockFiles = result.evidence.nextAction.taskDirectionLock.allowedFiles as string[];
  assert.equal(directionLockFiles.includes('src/a.ts'), true);
  assert.equal(directionLockFiles.includes('src/b.ts'), false);
  assert.equal(directionLockFiles.includes('.atm/history/tasks/TASK-FILES.json'), true);
  const claimedTask = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-FILES.json'), 'utf8')) as {
    workAdmissionTicket: { grants: Array<{ kind?: string; values?: string[] }> };
  };
  const fileWriteGrant = claimedTask.workAdmissionTicket.grants
    .find((grant: { kind?: string }) => grant.kind === 'file-write');
  assert.ok(fileWriteGrant, 'claim must persist a file-write admission grant');
  const ticketFiles = fileWriteGrant.values ?? [];
  assert.equal(ticketFiles.includes('src/a.ts'), true, 'explicit claim scope must be present in the admission ticket');
  assert.equal(ticketFiles.includes('src/b.ts'), false, 'unclaimed task scope must not be widened into the admission ticket');
  console.log('claim-files-option: ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
