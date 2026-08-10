import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCommitAcceptedByLegacyBaseline,
  readFrameworkCommitRangeBaseline
} from '../commit-range-guard.ts';
import { createCommitRangeGuardReport } from '../commit-range-guard.ts';
import {
  runRequiredFrameworkValidators,
  triageForeignValidatorRuns
} from '../pre-push.ts';

const cwd = process.cwd();

const baseline = readFrameworkCommitRangeBaseline(cwd, 'HEAD');
if (baseline) {
  assert.equal(baseline.schemaId, 'atm.frameworkCommitRangeBaseline.v1');
  assert.equal(isCommitAcceptedByLegacyBaseline(cwd, baseline.commitSha, baseline.acceptedHistoryThroughCommitSha), true);
}

const headSha = runGitScalar(cwd, ['rev-parse', 'HEAD']);
const parentSha = runGitScalar(cwd, ['rev-parse', 'HEAD~1']);
if (headSha && parentSha) {
  const rejected = isCommitAcceptedByLegacyBaseline(cwd, headSha, parentSha);
  assert.equal(typeof rejected, 'boolean');
}

const validators = runRequiredFrameworkValidators(cwd, []);
assert.equal(validators.length, 0);

const triage = triageForeignValidatorRuns({
  cwd,
  stagedFiles: ['README.md'],
  activeDirectionLocks: [],
  failedRuns: []
});
assert.equal(triage.blockingRuns.length, 0);
assert.equal(triage.advisoryFindings.length, 0);

const foreignBrokerTriage = triageForeignValidatorRuns({
  cwd,
  stagedFiles: ['docs/reports/audit.json'],
  committingTaskId: 'ATM-GOV-0327',
  activeDirectionLocks: [{
    taskId: 'ATM-GOV-0345',
    allowedFiles: ['packages/cli/src/commands/broker/steward-queues.ts']
  }] as any,
  failedRuns: [{
    command: 'npm run validate:cli',
    cwd,
    exitCode: 1,
    stdoutSha256: 'fixture',
    stderrSha256: 'fixture',
    stdoutPreview: 'broker --help usage snapshot must match fixture',
    stderrPreview: ''
  }]
});
assert.equal(foreignBrokerTriage.blockingRuns.length, 0);
assert.equal(foreignBrokerTriage.advisoryFindings[0]?.code, 'ATM_HOOK_FOREIGN_COMMAND_SURFACE_WIP_ADVISORY');

{
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-pre-push-attest-suggestion-'));
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
  mkdirSync(path.join(repo, 'packages/cli/src'), { recursive: true });
  writeFileSync(path.join(repo, 'packages/core/src/index.ts'), 'export const baseline = true;\n');
  writeFileSync(path.join(repo, 'packages/cli/src/atm.ts'), 'export const cli = true;\n');
  git(['add', '.']);
  git(['commit', '-m', 'baseline fixture']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(path.join(repo, 'packages/core/src/broker/historical-work-admission-attestation.ts'), 'export const changed = true;\n');
  git(['add', '.']);
  git(['commit', '-m', 'emergency fixture', '-m', 'ATM-Emergency-Reason: fixture']);
  const head = git(['rev-parse', 'HEAD']);
  const report = createCommitRangeGuardReport(repo, base, head);
  const finding = report.findings.find((entry: any) => entry.code === 'ATM_WRITE_TICKET_HISTORICAL_ATTESTATION_REQUIRED') as any;
  assert.ok(finding, 'missing work-admission finding should be present');
  assert.match(finding.suggestedFix, /node atm\.mjs git attest --commit [a-f0-9]{40}/);
  assert.match(finding.suggestedFix, /--provenance-ref git:[a-f0-9]{40}/);
  assert.match(finding.suggestedFix, /--reason "<reason>"/);
  assert.match(finding.suggestedFix, /--dry-run --json/);
}

console.log('[pre-push.spec] ok');

function runGitScalar(repoCwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: repoCwd, encoding: 'utf8' });
  return result.status === 0 && result.stdout?.trim() ? result.stdout.trim() : null;
}
