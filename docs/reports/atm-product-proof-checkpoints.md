# ATM product-proof checkpoints

This checkpoint is append-only evidence metadata, not a replacement for GitHub run history or npm registry evidence. Raw CI/provider exports remain outside Git.

## Current verified observations

- Public npm clean-consumer install: verified for `@ai-atomic-framework/cli@0.1.0-beta.5`; the registry tarball is not a workspace link.
- Product CI contract: present and validated locally.
- Burn-in policy: at least 90 eligible protected-main runs spanning at least 30 calendar days, with failures and cancellations retained.
- Scheduled protected-main CI runs are eligible observations because the workflow explicitly schedules them to preserve the burn-in window.

## Claims not yet earned

The current GitHub history is not yet a 30-day, 90-run all-success window. Earlier failures remain part of the denominator. Therefore `long-term-green` is not claimed here. Re-run the burn-in evaluator against an externally retained, newest-first GitHub export after each scheduled observation.

## Boundary

The public checkpoint may contain digests, counts, and links only. Raw run payloads, provider billing exports, and runtime evidence stay in the external evidence ledger and must be restorable by digest.
