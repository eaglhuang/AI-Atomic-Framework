import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-rescue-worktree-audit-'));
const auditRoot = path.join(root, 'override-audit');
const porcelainPath = path.join(root, 'worktrees.porcelain');
const bypassPath = path.join(root, 'bypass.json');
const rescuePath = path.join(root, 'rescue.json');
// The rescue commit must have a parent so its changed files are knowable; a CI
// checkout is shallow, so the framework's own HEAD cannot serve as the fixture.
const fixtureRepo = path.join(root, 'fixture-repo');
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixtureRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

try {
  mkdirSync(auditRoot, { recursive: true });
  mkdirSync(fixtureRepo);
  git('init', '--quiet');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  writeFileSync(path.join(fixtureRepo, 'base.txt'), 'base\n');
  git('add', 'base.txt');
  git('commit', '--quiet', '-m', 'base');
  writeFileSync(path.join(fixtureRepo, 'rescue-write.txt'), 'write\n');
  git('add', 'rescue-write.txt');
  git('commit', '--quiet', '-m', 'rescue write');
  writeFileSync(path.join(auditRoot, 'missing-receipt.json'), JSON.stringify({
    schemaId: 'atm.protectedOverrideAuditEvent.v1', eventId: 'POA-missing', recordedAt: '2026-08-09T00:00:00.000Z',
    actorId: 'fixture', taskId: 'TASK-FIXTURE', surface: 'raw-git', command: 'git commit -m fixture',
    permission: null, leaseId: null, emergencyUsePath: null, outcome: 'succeeded', touchedFiles: []
  }));
  writeFileSync(path.join(auditRoot, 'receipt-linked.json'), JSON.stringify({
    schemaId: 'atm.protectedOverrideAuditEvent.v1', eventId: 'POA-linked', recordedAt: '2026-08-09T00:01:00.000Z',
    actorId: 'fixture', taskId: 'TASK-FIXTURE', surface: 'governed', command: 'node atm.mjs git commit --json',
    permission: 'backend.gitHookBypass', leaseId: 'EMG-fixture', emergencyUsePath: 'uses/fixture.json', outcome: 'succeeded', touchedFiles: []
  }));
  writeFileSync(porcelainPath, [
    'worktree C:/repo/main', 'HEAD 0123456789abcdef', 'branch refs/heads/main', '',
    'worktree C:/repo/ATM-rescue-fixture', `HEAD ${git('rev-parse', 'HEAD')}`, 'detached', ''
  ].join('\n'));
  execFileSync(process.execPath, ['--experimental-strip-types', path.join(frameworkRoot, 'scripts/analyze-captain-parallel-ledger.ts'),
    '--protected-override-root', auditRoot, '--worktree-porcelain', porcelainPath,
    '--bypass-report', bypassPath, '--rescue-report', rescuePath], { cwd: fixtureRepo, stdio: 'pipe' });
  const bypass = JSON.parse(readFileSync(bypassPath, 'utf8')) as { rows: Array<{ eventId: string; disposition: string; approval: string; headBefore: string | null; headAfter: string | null; headEvidenceAvailability: string; receiptAvailability: string; reason: string | null }> };
  const rescue = JSON.parse(readFileSync(rescuePath, 'utf8')) as { rows: Array<{ detached: boolean; classification: string; charter: string[] }>; summary: { count: number; violationCount: number } };
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.approval, 'NONE');
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.disposition, 'blocker-missing-approval-or-receipt');
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.headBefore, null);
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.headAfter, null);
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.headEvidenceAvailability, 'unavailable-no-event-field');
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-missing')?.receiptAvailability, 'not-recorded');
  assert.equal(bypass.rows.find((row) => row.eventId === 'POA-linked')?.disposition, 'review-authorized-exception');
  assert.equal(rescue.summary.count, 1);
  assert.equal(rescue.summary.violationCount, 1);
  assert.equal(rescue.rows[0]?.detached, true);
  assert.equal(rescue.rows[0]?.classification, 'detached-rescue-contribution-write-violation');
  assert.deepEqual(rescue.rows[0]?.charter, ['INV-ATM-008', 'INV-ATM-010']);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('rescue-worktree-normal-write-classification: ok');
