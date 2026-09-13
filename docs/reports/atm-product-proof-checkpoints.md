# ATM product-proof checkpoints

This checkpoint is append-only evidence metadata, not a replacement for GitHub run history or npm registry evidence. Raw CI/provider exports remain outside Git.

## Current verified observations

- Public npm clean-consumer install: verified for `@ai-atomic-framework/cli@0.1.0-beta.5`; the registry tarball is not a workspace link.
- Latest local package build measures 3,357,358 unpacked bytes across 76 runtime files (registry proof reports 3,357,365 bytes across 78 files). This is within the current 3,365,772-byte cap, but leaves less than 0.3% headroom; it should not be presented as “small” without a follow-up size-reduction pass.
- Product CI contract: present and validated locally.
- Repository clean-install validation also passes with `isolatedInstall: true` and `adoptionVerified: true`; it checks the published CLI against the generated 27-package skeleton without a workspace link.
- Burn-in policy: at least 90 eligible protected-main runs spanning at least 30 calendar days, with failures and cancellations retained.
- Scheduled protected-main CI runs are eligible observations because the workflow explicitly schedules them to preserve the burn-in window.

## Claims not yet earned

The current GitHub history is not yet a 30-day, 90-run all-success window. Earlier failures remain part of the denominator. Therefore `long-term-green` is not claimed here. Re-run the burn-in evaluator against an externally retained, newest-first GitHub export after each scheduled observation.

## Boundary

The public checkpoint may contain digests, counts, and links only. Raw run payloads, provider billing exports, and runtime evidence stay in the external evidence ledger and must be restorable by digest.

## Latest observed CI snapshot

On 2026-09-13, an externally queried GitHub Actions export (100 newest `ci.yml` runs; source digest `sha256:d303ec54f193828c7721d8a59bae8c62954d255b6e853edc7fbf88ddeaf96a04`) produced 31 successes and 69 failures across 6.526343 calendar days. The evaluator therefore returned `unexplained-failure` with `insufficient-calendar-window`; this is a negative observation, not a long-term-green claim.

Assuming a fresh protected-main baseline begins with the latest eligible observation and every subsequent eligible run succeeds, the earliest possible 30-day window date is 2026-10-13. The 90-run minimum must also be reached; either condition failing keeps the claim non-green.
