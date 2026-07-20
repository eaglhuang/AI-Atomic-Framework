import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isCommitAcceptedByLegacyBaseline, readFrameworkCommitRangeBaseline } from '../commit-range-guard.js';
import { runRequiredFrameworkValidators, triageForeignTaskflowValidatorRuns } from '../pre-push.js';
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
const triage = triageForeignTaskflowValidatorRuns({
    cwd,
    stagedFiles: ['README.md'],
    activeDirectionLocks: [],
    failedRuns: []
});
assert.equal(triage.blockingRuns.length, 0);
assert.equal(triage.advisoryFindings.length, 0);
console.log('[pre-push.spec] ok');
function runGitScalar(repoCwd, args) {
    const result = spawnSync('git', args, { cwd: repoCwd, encoding: 'utf8' });
    return result.status === 0 && result.stdout?.trim() ? result.stdout.trim() : null;
}
