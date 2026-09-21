# Design It Twice Reference

Use this reference only when alternative interfaces are requested or the first
candidate interface is visibly shallow.

Process:

1. Frame the constraints: required behavior, dependency class, caller needs,
   rollback, and causal validators.
2. Produce at least two materially different interfaces.
3. Compare each option by depth, leverage, locality, and seam placement.
4. Prefer the interface that hides the most policy while preserving the public
   ATM contract.

Each option should name:

- the interface and its invariants;
- the adapters needed to make the seam real;
- hidden implementation complexity;
- replace-don't-layer tests through the interface;
- rollback and confidence.
