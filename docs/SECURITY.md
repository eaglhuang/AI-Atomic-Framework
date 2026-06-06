# Security Operations

This document is the maintainer-facing companion to the root `SECURITY.md`. It records the internal checklist required by TASK-APO-0018 without exposing incident details.

## Internal Review Checklist

- Root `SECURITY.md` exists and names private reporting channels.
- Root `SECURITY.md` states acknowledgement within 72 hours.
- Root `SECURITY.md` defines severity-based fix targets.
- Root `SECURITY.md` contains a PGP fingerprint field.
- Root `SECURITY.md` documents the `security/<advisory-id>` branch pattern.
- Root `SECURITY.md` describes coordinated disclosure timing.
- `.github/dependabot.yml` opens weekly npm dependency update pull requests.
- `.github/workflows/dependency-scan.yml` blocks high and critical production dependency findings.
- `scripts/validate-security-policy.ts` is listed in the standard validator profile.

## Advisory Branch Runbook

1. Open or attach a private vulnerability report.
2. Create `security/<advisory-id>` from the affected release line.
3. Keep commits limited to the fix, tests, lockfile changes, and advisory notes.
4. Run `node --experimental-strip-types scripts/validate-security-policy.ts --mode validate`.
5. Run `npm audit --omit=dev --audit-level=high` and the dependency scan workflow.
6. Prepare release notes or a GitHub Security Advisory after the patch is available.
7. Merge or tag from the private branch only after the coordinated disclosure plan is approved.

## Disclosure Record Template

Use this template inside the private advisory thread or private security tracker. Do not commit filled incident details to the public repository.

```text
advisory_id:
reported_at:
acknowledged_at:
reporter_contact:
affected_versions:
severity:
security_branch: security/<advisory-id>
fix_commit:
patched_release:
disclosure_at:
notes:
```
