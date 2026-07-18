import { execFileSync } from 'node:child_process';
import { CliError } from '../shared.js';
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
/**
 * ATM-BUG-2026-07-17-002 / ATM-GOV-0166:
 * After a governed record-commit, verify every explicitly staged record file is
 * actually present in the created commit. Success with a dropped payload is the
 * worst outcome for a governance wrapper.
 */
export function assertRecordCommitPayloadPresent(input) {
    const output = execFileSync('git', ['show', '--name-only', '--pretty=format:', input.commitSha], {
        cwd: input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const committedFiles = output
        .split(/\r?\n/)
        .map((line) => normalizeRelativePath(line))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    const committed = new Set(committedFiles);
    const missing = input.expectedStagedFiles
        .map((entry) => normalizeRelativePath(entry))
        .filter((entry) => entry.length > 0 && !committed.has(entry));
    if (missing.length > 0) {
        throw new CliError('ATM_GIT_RECORD_COMMIT_PAYLOAD_DROPPED', `git record-commit reported success but dropped staged record file(s): ${missing.join(', ')}.`, {
            exitCode: 1,
            details: {
                commitSha: input.commitSha,
                missing,
                expectedStagedFiles: input.expectedStagedFiles,
                committedFiles,
                recovery: [
                    'Do not treat the commit as successful governance delivery.',
                    'Inspect git show --name-only <sha>.',
                    'Re-stage the missing record files and retry git record-commit, or use a temporary-index commit path.'
                ]
            }
        });
    }
    return {
        commitSha: input.commitSha,
        expectedStagedFiles: input.expectedStagedFiles,
        committedFiles
    };
}
