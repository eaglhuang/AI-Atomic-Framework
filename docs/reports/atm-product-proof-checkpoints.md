# ATM product-proof checkpoints

This checkpoint is append-only evidence metadata, not a replacement for GitHub run history or npm registry evidence. Raw CI/provider exports remain outside Git.

## Current verified observations

- Public npm clean-consumer install: verified for `@ai-atomic-framework/cli@0.1.0` after the stable release; the registry tarball is not a workspace link. The earlier beta observation remains historical.
- Latest local package build measures 3,357,358 unpacked bytes across 76 runtime files (registry proof reports 3,357,365 bytes across 78 files). This is within the current 3,365,772-byte cap, but leaves less than 0.3% headroom; it should not be presented as “small” without a follow-up size-reduction pass.
- npm dist-tags now point `latest` to `0.1.0` and `next` to `0.1.0-beta.5`. Bare `npm install @ai-atomic-framework/cli` therefore selects the stable installable package; the prior beta-only routing statement is historical.
- Direct public smoke `npm exec --yes --package=@ai-atomic-framework/cli@0.1.0 atm -- --version` succeeds and reports `ATM framework version 0.1.0`.
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

## Stable-release correction (2026-09-13)

The stable release workflow `34748571701` completed successfully, including post-publish validation. A fresh post-boundary burn-in evaluation over the current GitHub export observed one eligible protected-main run (`34747801958`), zero failures, zero calendar days, and returned `insufficient-window`. This updates the npm observations above but does not change the long-term-green conclusion.

## TASK-PRF-0051 post-delivery revalidation (2026-09-14)

The latest retained GitHub export contains 100 newest `ci.yml` runs, spanning
6.752234 calendar days, with 35 successes and 65 failures. The evaluator
returned `unexplained-failure` with reasons
`insufficient-calendar-window` and `unexplained-failure-present`. The current
remote ten-run validator also fails closed because only one of those ten runs
is labelled `release-candidate`, below the required pair.

Raw export: `C:\Users\User\atm-benchmark-sink\TASK-PRF-0051\raw\ci-runs-2026-09-14.json`
(SHA-256 `sha256:485d082e5addd7e9f1c08d6acf2e1a5b04f44ff8d040dfb91b1673c4139e7517`).
The report output is retained beside it with SHA-256
`sha256:d257dab99c9a3a822e33ed206b2058eae2883f1dcccef7343ad8ae542b64c215`.
This checkpoint is negative/inconclusive evidence only; it does not change the
90-run/30-day policy or claim long-term green CI.

## TASK-PRF-0053 live registry correction (2026-09-14)

The older checkpoint sentence claiming a verified public `0.1.0` install is
superseded by the live full-matrix recheck. The package is installable, but its
published runtime cannot complete the ATMChart lifecycle: `bootstrap` passes,
while `atm-chart render` and `atm-chart verify` fail on the missing
`default-guards` schema. This is retained as negative evidence and does not
earn the public core-workflow claim or authorize a release.

## TASK-PRF-0055 CI failure-lifecycle observability (2026-09-14)

The evaluator contract now requires attempt-level lifecycle data before CI
failure costs can be measured: `firstFailureAt`, `retryCount`,
`lastAttemptAt`, `repairAcceptedAt`, `failureClass`, and explicit exclusion
reasons. Missing or inconsistent fields fail closed; they are not treated as
zero and cannot produce a green burn-in claim.

Re-running the current 100-run GitHub export against the stricter evaluator
returned `invalid-input` with
`record-34749756346-missing-lifecycle`. This is negative evidence that the
existing export is insufficient to measure first failure, retries, and repair
time. Raw provider payloads remain outside Git; the 90-run/30-day policy and the
inconclusive status are unchanged.
