# TASK-TMP-0011: First bounded residue disposition

Date: 2026-09-01

This receipt records the first deliberately small cleanup slice. It excludes
all `.atm/history/**` paths, MBX work, and unverified source changes.

| Path | Pre-delete SHA-256 | Disposition | Evidence |
| --- | --- | --- | --- |
| `1` | `021f81b22f6f4029c8cf9ff3d4e968d1033b28027eb8eca29a3eaefdc37e9b96` | Delete | The file was only a pointer to `C:\\Users\\User\\AppData\\Local\\Temp\\atm-0341-validate-full-20260821.exit`; that target no longer exists and is outside this repository. |
| `tmp/proposal.TASK-PRF-0006.v3.atmArtifactBudget.json` | `30e535b9d2a5a76415c06e58139c61e40a5fd8d8c25898a8f7a21bf9fb2a8344` | Delete | Canonical broker store `.atm/runtime/broker-proposals.json` retains `proposal.TASK-PRF-0006.v3.atmArtifactBudget` with its `/atmArtifactBudget` anchor. |
| `tmp/proposal.TASK-PRF-0006.v4.atmArtifactBudget.json` | `e0f99602c542d461ea33e2a648c6ac160e0a9b2095d519a694caec6ceea01f07` | Delete | Canonical broker store `.atm/runtime/broker-proposals.json` retains `proposal.TASK-PRF-0006.v4.atmArtifactBudget` with its `/atmArtifactBudget` anchor. |

The temporary ingest files were never source of truth: the broker store is the
canonical proposal registry. Their removal does not apply either proposal or
alter `packages/cli/package.json`.
