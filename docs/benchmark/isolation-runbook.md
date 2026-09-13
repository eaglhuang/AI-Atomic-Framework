# Isolated benchmark runbook

Each arm runs in a fresh disposable clone or container pinned to a repository
commit, OS image, toolchain and public ATM tarball digest. The baseline arm has
no ATM hook, skill, package or framework checkout. A worktree alone is recorded
as `worktree-only`; it is not external evidence.

Before execution, verify the environment manifest and execute negative controls
against the oracle, every other run, the ATM development workspace and home
credentials. A single allowed read fails the run closed. Do not use an empty
chat or a different directory as a substitute for filesystem isolation.

Every temporary path is owned by an operation. Write a receipt containing the
owner, operation, path list and pre-run digests. On success, failure, timeout or
cancellation, cleanup may touch only receipt-listed paths whose current bytes
still match. Changed, foreign or user-authored paths remain untouched and the
run is reported as failed with a recovery receipt. Raw outputs and private
labels remain in digest-addressed storage outside Git.
