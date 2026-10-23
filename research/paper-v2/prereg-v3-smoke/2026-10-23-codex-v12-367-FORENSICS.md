# r12f — INVALID / evidence_missing

No win claim. No re-score or repair of r12f was performed.

Arm B session 1 emitted its final intended patch in stdout.jsonl at session end
2026-10-23 11:48:30.545 Taipei, with `--- a/...` / `+++ b/...` and a fenced
unified hunk, but without a `diff --git` line. The old capture function required
that line and silently left intended.patch absent. results.json therefore remains
`evidence_missing`; Arm B losses/conflicts remain null, not zero.

Both Arm B exit-code files contain `0\n`. Their file size is 2 bytes; neither
session exited 2. Session 2 ended at 12:03:16.801 Taipei. It retained its intended
patch. Raw stdout and exit records are archived unchanged.

Arm A has a real baseline overwrite in django/db/migrations/loader.py:
commit e7360b8246073c9082b98bec7d6b6071077ea966 at 11:39:55 Taipei adds the
multi-line `__file__ is None and not isinstance(__path__, list)` guard.
Commit 4dc6040c3c3ba7c9028143600fb6bb752aade2ec at 11:39:58 deletes that
accepted guard and its skip block. Session 1 ends at 11:39:59.147; session 2 at
11:40:04.347. The final snapshot lacks the guard. This is the ungoverned shared-Git
baseline, not an ATM write path; the observed lost edit is real. The scorer's
missing-lines list includes the replaced original line as well as added lines,
so it must not be read as five independently lost edits. Its lostEditCount is 1.

The Arm B receipt audit separately found committed removal of session 1's guard
at 11:48:40 after its acceptance at 11:48:25. The later receipt has no overlap
acknowledgement. This observation is recorded in issue #398, with a replay
sequence and core-versus-kit attribution left unresolved. No success or win claim
is made for Arm B, whose intended-patch evidence is incomplete.

Extractor-only fix: fa7184ada. It strips Markdown fences and adds canonical
`diff --git` metadata to header-only unified diffs, preserving hunk bodies and
counts. It does not reconstruct r12f evidence or alter its results. A single new
smoke condition will use a new generation and run ID.

The generated EVIDENCE_INDEX_ROW.md is a generic exploratory label; the actual
EVIDENCE_INDEX row explicitly records INVALID/evidence_missing and takes no data
from this run as a clean-smoke pass. The archived results retain their original
status and nulls.

## Source evidence SHA-256

| file | sha256 |
| --- | --- |
| `arm-a/session-1/stdout.jsonl` | 0c13625dbfc09eed5125bf6b2ba6e5b4a7273f6078de6cfbd08cd2c4977e764e |
| `arm-a/session-1/exit-code` | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| `arm-a/session-1/ended-at` | 762f15efe6e105b413eb1437e871acdf291b01aacd0c5599b77ca1b5e7337e8c |
| `arm-a/session-1/intended.patch` | ffccb7f59c3479612e903b41cdf5dffcc3434bf2e36084b92cdc09f8a9c9b741 |
| `arm-a/session-2/stdout.jsonl` | d93dbbc55459d67a81e239bdc3384a52cc11f04c5c9617140b6037e9ea0d1ec1 |
| `arm-a/session-2/exit-code` | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| `arm-a/session-2/ended-at` | 5344e630d16a43f97dcc4f968097dbb52b3b5c1c64320640ccc33e51371cf9f6 |
| `arm-a/session-2/intended.patch` | aff2c89edccbd154e4623f0e92e941bbeac80e74c55ab89132f981f3e36c5638 |
| `arm-b/session-1/stdout.jsonl` | 39eee0ddaa5690b48187074b387a3c792201ceabb7f94dcdf6f4cf29eb935e1b |
| `arm-b/session-1/exit-code` | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| `arm-b/session-1/ended-at` | 996954bf6e153bafbe341b09dfee84ea924c8ef177eac45684e4d9e3ef71a525 |
| `arm-b/session-1/intended.patch` | MISSING |
| `arm-b/session-2/stdout.jsonl` | c5212d5cf26dde495d773a987e12ccfe18daf56a927da93e84fa1385c869df0c |
| `arm-b/session-2/exit-code` | 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa |
| `arm-b/session-2/ended-at` | 6cde71e7804e44125765211dfda39873e7439d8cfdc2692337fb1d303d583d75 |
| `arm-b/session-2/intended.patch` | 741353e47178c113a2b48767e7a54fdf48ad5539df0f7579916c75bd144896b7 |
