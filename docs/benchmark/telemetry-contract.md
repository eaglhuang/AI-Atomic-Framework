# Attributable telemetry contract

Provider usage is keyed by a unique request ID and run ID. Raw provider export
references are digest checked; a self-signed JSON object is not payment proof.
Unknown token, billing and subscription values remain `null`. Token-times-price
is an estimate and is never stored as billed cost.

Human work is represented by actor/run intervals. Invalid ordering, duplicate
events and overlapping intervals for one actor/run fail closed to prevent double
counting. API billing, human time, compute allocation and subscription fees are
separate categories.

Every pilot or formal run must carry explicit amount, token and time limits
(or an explicit unavailable readiness result). `enforceBudget` stops before the
next expensive call when a measured limit is exceeded and preserves the failure
reason. Raw exports and credentials stay outside Git; a clean reader verifies a
digest-addressed export using `verifyRawExport`.
