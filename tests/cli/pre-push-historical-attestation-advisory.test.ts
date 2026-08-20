import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommitRangeGuardReport } from '../../packages/cli/src/commands/hook/commit-range-guard.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-pre-push-historical-advisory-'));
const git = (args: string[]) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

git(['init']);
git(['config', 'user.email', 'fixture@example.invalid']);
git(['config', 'user.name', 'fixture']);
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'ai-atomic-framework' }));
mkdirSync(path.join(repo, 'packages/core/src/broker'), { recursive: true });
writeFileSync(path.join(repo, 'packages/core/src/index.ts'), 'export const baseline = true;\n');
git(['add', '.']);
git(['commit', '-m', 'baseline fixture']);
const base = git(['rev-parse', 'HEAD']);
writeFileSync(path.join(repo, 'packages/core/src/broker/historical-work-admission-attestation.ts'), 'export const changed = true;\n');
git(['add', '.']);
git(['commit', '-m', 'legacy emergency fixture', '-m', 'ATM-Emergency-Reason: fixture']);
const head = git(['rev-parse', 'HEAD']);

const report = createCommitRangeGuardReport(repo, base, head);
assert.equal(report.historicalAttestationEnforcement, 'disabled');
assert.equal(report.findings.some((entry) => entry.code === 'ATM_WRITE_TICKET_HISTORICAL_ATTESTATION_REQUIRED'), false);

console.log('pre-push-historical-attestation-advisory: ok');
