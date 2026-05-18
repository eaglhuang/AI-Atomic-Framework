# Security Policy

AI-Atomic-Framework treats vulnerability handling as a private, coordinated disclosure flow. Do not file public issues, public pull requests, or public discussions for suspected vulnerabilities until maintainers publish an advisory or explicitly clear disclosure.

## Supported Scope

Security reports are in scope when they affect the ATM CLI, release artifacts, generated governance files, installer/bootstrap paths, adapter packages, or CI/release automation in this repository.

Reports about downstream host projects are out of scope unless the vulnerability is caused by code or generated artifacts shipped by AI-Atomic-Framework.

## Reporting a Vulnerability

Preferred channel: use GitHub Private Vulnerability Reporting for `eaglhuang/AI-Atomic-Framework`.

Backup private channel: email `security@ai-atomic-framework.invalid` with the subject prefix `[SECURITY][ATM]`. This address is the pre-release security mailbox placeholder and must be replaced with the project-owned mailbox before a public stable release.

Include as much of the following as possible:

- affected version, package, command, workflow, or release artifact;
- reproduction steps or proof-of-concept details;
- expected impact and whether credentials, tokens, local files, CI secrets, or release artifacts are involved;
- whether the report is already shared with anyone else;
- a safe contact method for follow-up.

## Encryption

For sensitive reports, prefer GitHub Private Vulnerability Reporting because GitHub keeps the discussion private to repository security managers.

PGP fingerprint: `A1B2 C3D4 E5F6 0718 1920 2122 2324 2526 2728 2930`

The fingerprint above is the pre-release placeholder key fingerprint for policy validation. Before the first public stable release, maintainers must replace it with a project-controlled PGP key and publish the armored public key from the same advisory channel.

## Response SLA

Maintainers will acknowledge a valid private report within 72 hours.

Fix targets are severity-based:

| Severity | Fix target | Disclosure target |
| --- | --- | --- |
| Critical | mitigation or patch target within 7 days | coordinated disclosure after patched release or agreed embargo |
| High | mitigation or patch target within 14 days | coordinated disclosure after patched release or agreed embargo |
| Medium | patch target within 30 days | release notes or advisory when fixed |
| Low | next planned minor or maintenance release | release notes when fixed |

If a report is not exploitable, out of scope, or already fixed, maintainers will still close the loop privately with rationale.

## Advisory Branch SOP

Security fixes must use a private advisory branch named `security/<advisory-id>`, for example `security/GHSA-xxxx-yyyy-zzzz` or `security/ATM-YYYY-NNNN`.

The branch must remain private until coordinated disclosure. Keep the branch limited to the minimum fix, regression tests, dependency lockfile changes, and advisory notes. Do not mix unrelated refactors or public feature work into an advisory branch.

Coordinated disclosure timeline:

1. T+0: report received through a private channel.
2. T+72h or sooner: maintainer acknowledgement and triage status.
3. Triage: assign severity, impacted versions, affected artifacts, and owner.
4. Fix: land mitigation on `security/<advisory-id>` with tests and dependency-scan evidence.
5. Release: publish patched package or release artifact, update known-bad release data when needed, and prepare advisory text.
6. Disclosure: publish GitHub Security Advisory or release notes after the fix is available, unless a coordinated embargo requires a different date.

## Dependency Scanning

Dependency updates are managed by weekly Dependabot pull requests. Pull requests and main branch pushes run the dependency scan workflow, which blocks high and critical production dependency findings through `npm audit --omit=dev --audit-level=high` and OSV Scanner checks.
