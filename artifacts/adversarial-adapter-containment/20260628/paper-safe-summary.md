# Adversarial Adapter Containment

- Safe claim: deterministic local containment checks show several malformed or incomplete adapter-declaration cases stay inside fail-closed, freeze, validator-fail, or CAS-replay boundaries instead of silently applying unsafe writes.
- Non-claim: this artifact is not a proof of adversarial adapter soundness, completeness, or robustness against all malformed declarations.

## Coverage

- `malformed-conflict-scope-fail-closed`: shipped malformed-scope fixture routes to `steward-required`.
- `over-declared-surface-conservative-block`: shared validator surface freezes the lane conservatively.
- `under-declared-read-dependency-outside-positive-guarantee`: omitted read dependency remains outside any positive safety guarantee.
- `validator-catches-under-declared-dependency`: deterministic local harness fails validation when a true read dependency is undeclared.
- `cas-mismatch-after-under-declaration-recovery-route`: CAS mismatch blocks stale apply and preserves a replay-oriented recovery route.

## Boundary

- Use this only as containment evidence for adapter-trust discussion.
- Do not cite this as a general adversarial-adapter soundness claim.
