To cloud agent bc-844bba66-756b-5e46-8fc1-a8ba0bf0b528 — paper-v2 r5 upload (attach the 3 parts + 3 .sha256 sidecars)

Attachments (box: /workspace/upload/):
- paper-v2-r5-upload-part1.tgz  20,810,974 B  sha256 86c46aa241a5d690f68e0abf8690aa748f8e5da129b5734f571a10ff25b206cf
- paper-v2-r5-upload-part2.tgz  21,127,149 B  sha256 f61c9148ada563f42a923c59bcd86d0aa9e79474165debb83644eff423301380
- paper-v2-r5-upload-part3.tgz  12,384,566 B  sha256 0aed6a8b406b91e2b0c0c97b5d7a2dac37e78166ce48c2e2f1a9952e353960e1

Steps:
1. New branch from current main (≥ 37847584). Check the sha256 of each part, then extract all three at the repo root, in any order. They add `research/paper-v2/generations/r5-2026-10-08/` and `research/paper-v2/patches/{EVIDENCE_INDEX.md.r5-proposed, EVIDENCE_INDEX.r5-from-repo-37847584.patch, README.md.r5-proposed, README.r5-from-repo-37847584.patch}`.
2. Verify all generations (read-only) and expect:
   - r1 `bash verify.sh` → 274 OK, SHA256SUMS sha256 30d663c2…
   - r2 `sh verify.sh` → 309 OK (25d4a293…)
   - r3 → 329 OK (7a8c0cb4…)
   - r4 → 363 OK (6aa0d178…)
   - r5 → 431 OK (2a4bfb184debaeb85a7283d990b92ba270732c344052497052761844f42a257a)
   r1–r4 must not change at all (`git diff --stat` must show no r1–r4 paths).
3. Hand-merge `research/paper-v2/EVIDENCE_INDEX.md` and `README.md` using the r5 patches. They are based on the repo versions at 37847584; if main has moved, apply them by hand. Then delete the `patches/*.r5-*` helper files, or keep them under `patches/`, following the r4 convention.
4. Open PR: "research(paper-v2): add r5 generation (PR #216 validation; DRAFT, no-win)".
   Body:
   - DRAFT;
   - author-executed, not independently reproduced;
   - Phase 3 450-run not done;
   - the SQLITE_BUSY availability defect (fail-closed, 8 intents);
   - post-hoc arms are exploratory;
   - qr0/qr1 are non-discriminating.
5. Merge after CI is green. No tag, no npm publish. Report back the PR URL and merge SHA.
