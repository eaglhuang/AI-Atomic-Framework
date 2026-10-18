# Complete bounded Git index snapshots

The governed commit wrapper captures the entire index before preparing a
candidate and at rollback boundaries. These snapshots must describe every
entry or fail; a truncated prefix is never a usable recovery snapshot.

## Read contract

`index-snapshot-read.ts` runs `git ls-files --stage -z` without a shell and
inherits the existing Git environment, including an explicitly selected
`GIT_INDEX_FILE`. It reads bytes with finite limits:

| Resource | Limit | Purpose |
| --- | --- | --- |
| Captured process output | 64 MiB per output stream | Match the existing large Git inventory budget rather than Node's default 1 MiB buffer |
| Snapshot records | 500,000 | Bound the in-memory entry map independently of byte length |
| Git process duration | 30 seconds | Stop an unresponsive capture rather than wait indefinitely |

The child is killed on timeout. A process error, nonzero exit, output overflow,
timeout, missing final NUL, malformed record, invalid UTF-8, invalid relative
path, duplicate path, or unsupported index state rejects the entire snapshot.
No partial stdout from a failed child is parsed. Failures use the existing
`ATM_GIT_COMMIT_FAILED` preparation contract with
`details.nestedFailure.boundary = "index-snapshot"` and a bounded reason.
Raw index output is not copied into diagnostics.

Only regular files, executable files, symbolic links, and gitlinks in stage zero
are representable by this snapshot's one-entry-per-path model. SHA-1 and
SHA-256 object IDs are accepted without mixing formats. Unmerged stages and
sparse-directory records are rejected, not collapsed or silently skipped.
An empty index is a valid empty snapshot. Invalid UTF-8 filenames are
unsupported and fail closed rather than being converted to replacement text.

NUL framing preserves tabs, newlines, carriage returns, quotes, leading or
trailing spaces, Unicode (including U+FEFF), and literal POSIX backslashes in
snapshot path identities. The parser does not trim, unquote, normalize, or
rewrite those names. Empty, absolute, dot, and dot-dot path components are
rejected. This contract covers whole-index capture and its ownership-bounded
restoration; it does not promise that every path-scoped CLI feature accepts
all such names.

## Restoration and failure boundaries

The existing ownership and compare-and-swap rules remain unchanged. Rollback
may restore an operation-owned path only while its current mode, object, and
stage still match the operation's expected post-write entry. Foreign staging,
concurrent changes, foreign index locks, and worktree bytes remain intact.
Failure to reread the index while holding an owned lock returns an unverified
restoration and releases that owned lock. It never becomes success merely
because cleanup succeeded.

Capture itself is read-only. A failed snapshot is not evidence that every
earlier step of the enclosing commit attempt was mutation-free. Inspect the
existing attempt receipt and HEAD before retrying a failed wrapper operation.

## Regression evidence

- `index-snapshot-read.test.ts` captures 28,000 actual Git index entries with
  5,572,000 bytes of stage output, verifies every mode/object/stage/path, and
  covers framing, UTF-8, metadata, byte/record caps, subprocess failures,
  unusual names, SHA-256, and unmerged-stage refusal
- `live-index-reconciliation.test.ts` verifies exact unusual-name rollback,
  foreign partial staging, concurrent changes, and failed-capture lock cleanup
- `git-commit-attribution-isolation.test.ts` uses a real 28,000-file repository
  through the governed wrapper, including a bound attribution hook, malformed
  capture refusal, successful commit, failure rollback, retry, empty candidate,
  manual staging, and taskless framework paths

The snapshot test is registered in the existing focused CLI regression suite.
Installed candidate checks and CI must still run against the exact published
source candidate. Source, generated runners, and npm releases are distinct
artifacts; this change does not itself publish a new npm version.
