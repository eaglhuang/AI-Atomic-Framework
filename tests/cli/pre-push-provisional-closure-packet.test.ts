import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommitRangeGuardReport } from '../../packages/cli/src/commands/hook/commit-range-guard.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-pre-push-provisional-closure-'));
const git = (args: string[]) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

git(['init']);
git(['config', 'user.email', 'fixture@example.invalid']);
git(['config', 'user.name', 'fixture']);
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'ai-atomic-framework' }));
mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const baseline = true;\n');
writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const cli = true;\n');
git(['add', '.']);
git(['commit', '-m', 'baseline fixture']);
const base = git(['rev-parse', 'HEAD']);

writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const target = true;\n');
git(['add', '.']);
git(['commit', '-m', 'target delivery']);
const targetCommit = git(['rev-parse', 'HEAD']);

mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'TASK-TEST-0001.closure-packet.json'), JSON.stringify({
  schemaId: 'atm.closurePacket.v1',
  specVersion: '0.1.0',
  taskId: 'TASK-TEST-0001',
  targetRepoIdentity: { isFrameworkRepo: true, score: 5, root: repo, name: 'ai-atomic-framework', signals: ['fixture'] },
  targetCommit,
  governedTreeSha: 'future-tree-prediction',
  targetCommitDelta: {
    currentCommitSha: targetCommit,
    parentCommitShas: [targetCommit],
    governedTreeSha: 'future-tree-prediction',
    changedFiles: ['packages/core/src/index.ts']
  },
  closedByCommand: 'atm tasks close',
  commandRuns: [{ command: 'npm run typecheck', cwd: '.', exitCode: 0, stdoutSha256: `sha256:${'a'.repeat(64)}`, stderrSha256: `sha256:${'b'.repeat(64)}`, runnerVersion: 'fixture' }],
  validationPasses: ['typecheck'],
  evidenceFreshness: 'fresh',
  requiredGates: ['typecheck'],
  requiredGatesSnapshot: { schemaId: 'atm.requiredGatesSnapshot.v1', generatedAt: '2026-01-01T00:00:00.000Z', source: 'frameworkStatus.requiredGates', ruleVersion: '0.1.0', frameworkMode: 'required', repoRole: 'framework', changedFiles: ['packages/core/src/index.ts'], criticalChangedFiles: ['packages/core/src/index.ts'], requiredGates: ['typecheck'] },
  evidencePath: '.atm/history/evidence/TASK-TEST-0001.json',
  closedAt: '2026-01-01T00:00:00.000Z',
  closedByActor: 'fixture',
  sessionId: null,
  attestation: null,
  historicalDeliveryProvenance: null,
  repair: null
}, null, 2));
writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const closure = true;\n');
git(['add', '.']);
git(['commit', '-m', 'close task fixture']);
const head = git(['rev-parse', 'HEAD']);

const report = createCommitRangeGuardReport(repo, base, head);
assert.equal(
  report.findings.some((entry) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_CHANGED_FILES_MISMATCH'),
  false,
  'a provisional close packet must not be compared with the later closure commit'
);

console.log('pre-push-provisional-closure-packet: ok');
