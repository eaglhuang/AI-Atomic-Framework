# AdmissionFailureReason

- Safe claim: blocked and composer-routed broker decisions now preserve a structured failureReason payload for repair/context handoff.
- Non-claim: failureReason is an additive explanation envelope, not a proof of full validator transcript capture.

- blocked-shared-surface: `blocked-shared-surface` -> `shared-surface` / `serialize`
- blocked-cid-conflict: `blocked-cid-conflict` -> `cid` / `serialize`
- composer-routed-disjoint-file-range: `needs-physical-split` -> `file-range` / `compose`
