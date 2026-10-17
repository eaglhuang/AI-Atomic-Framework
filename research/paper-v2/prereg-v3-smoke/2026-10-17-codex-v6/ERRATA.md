# ERRATA — 2026-10-17-codex-v6

Status: **INVALID**. Not citable. This file is not part of `SHA256SUMS`. The sealed archive files are unchanged.

Independent review found a kit-error in the evaluator that produced this archive (`evaluate.py` at `f6eb862f`, the Django test path around the `git clone` / `checkout HEAD` steps).

- Arm A did not commit. Its HEAD stayed at the common base `98ad327864aed8df245fd19ea9d2743279e11643`.
- Tests cloned that HEAD and checked it out, so Arm A's tests ran on the unmodified base. Arm B's tests ran on the steward commits.
- The archived diff is `base..HEAD`, so Arm A's diff is empty even though the working tree had edits.
- Lost-edit scoring read the working tree, so it did not see the same tree as the tests or the archived diff.

The A/B comparison in this directory is an evaluator snapshot mismatch, not a result. Do not cite it as a smoke outcome or as evidence that one arm beat the other.

`EVIDENCE_INDEX.md` records this directory as INVALID for that reason. The checksum list in this directory still covers only the original sealed files.
