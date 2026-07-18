/**
 * ATM-BUG-2026-07-17-002 / ATM-GOV-0166:
 * After a governed record-commit, verify every explicitly staged record file is
 * actually present in the created commit. Success with a dropped payload is the
 * worst outcome for a governance wrapper.
 */
export declare function assertRecordCommitPayloadPresent(input: {
    readonly cwd: string;
    readonly commitSha: string;
    readonly expectedStagedFiles: readonly string[];
}): {
    readonly commitSha: string;
    readonly expectedStagedFiles: readonly string[];
    readonly committedFiles: readonly string[];
};
