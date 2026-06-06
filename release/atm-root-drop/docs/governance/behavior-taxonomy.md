# Behavior Taxonomy

ATM keeps the public action ids stable, but the implementation surface is intentionally consolidated into `@ai-atomic-framework/plugin-behavior-pack`.

## Split Family

- `behavior.split`: split an existing governed atom into clearer bounded work without introducing legacy extraction semantics.
- `behavior.atomize`: extract a new atomic unit from broader or legacy material when decomposition creates a distinct managed atom.

## Merge Family

- `behavior.merge`: merge two governed atoms into one outcome.
- `behavior.dedup-merge`: merge while explicitly collapsing duplicates or overlap.
- `behavior.compose`: compose multiple governed units into a higher-level assembled result without claiming semantic deduplication.

## Evolution Family

- `behavior.evolve`: in-place governed evolution of one atom version to the next.
- `behavior.polymorphize`: keep the governed identity but shift to a variant or alternate presentation mode.

## Lifecycle Family

- `behavior.expire`: formally retire an atom from active use.
- `behavior.sweep`: clean up obsolete governed residue, references, or temporary byproducts.

## Propagation Family

- `behavior.infect`: propagate a governed change into downstream dependents under explicit review and neutrality controls.

## Taxonomy Rules

- Keep the existing action ids for compatibility.
- Add new implementation detail inside the consolidated behavior pack before creating any new publishable behavior package.
- Choose `atomize` only when a new independently governed unit is born; otherwise prefer `split`.
- Choose `dedup-merge` only when de-duplication is the reason for the merge; otherwise prefer `merge` or `compose`.
- Choose `polymorphize` only when the semantic identity stays intact while the variant changes; otherwise prefer `evolve`.
- Choose `sweep` for cleanup and residue management; choose `expire` for lifecycle closure.
