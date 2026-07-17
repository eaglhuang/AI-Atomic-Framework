# ATM Atom/Map Refactor Patterns

Use these patterns to preserve atom/map semantics while reducing large ATM core files.

## Policy Object

Use when code answers whether an operation is allowed, blocked, waived, trusted, or recoverable.

Good fits:

- dependency admission
- lifecycle transition gates
- emergency backend permission checks
- waiver decisions
- closeout trust checks

Shape:

```ts
export function evaluatePolicy(input): PolicyResult
```

The result should include stable codes, a reason, and a required command when recovery is safe.

Avoid:

- returning only booleans for safety-critical decisions
- duplicating the same policy in `next`, `tasks`, and `taskflow`

## Strategy Map

Use when behavior dispatches by mode, bucket, action, or route.

Good fits:

- residue buckets
- taskflow close modes
- historical-delivery file buckets
- backend closeback route selection

Shape:

```ts
const strategies = {
  'normal-close': normalCloseStrategy,
  'residue-repair': residueRepairStrategy
} satisfies Record<string, Strategy>;
```

Each strategy should return the same result contract shape.

Avoid:

- long `if/else` chains spread across callers
- anonymous inline pipelines where stages cannot be named or tested

## Result Contract Object

Use when code emits evidence, diagnostics, closeout packets, bundles, or provenance.

Good fits:

- `atm.taskResidueDiagnosis.v1`
- `atm.taskflowGovernedCommitBundle.v1`
- closure packet delivery proof
- dirty-file classification

Shape:

```ts
interface SomeResultContract {
  readonly schemaId: 'atm.example.v1';
  readonly ok: boolean;
  readonly reason: string;
}
```

Avoid:

- parsing human prose downstream
- losing file buckets or provenance details before closure packet generation

## Facade

Use for operator-facing commands that should orchestrate atoms without owning their rules.

Good fits:

- `taskflow open`
- `taskflow close`
- thin `tasks.ts` command wrapper after invariant extraction

Facade responsibilities:

- parse flags
- choose strategy
- call owner atoms
- format output

Facade non-responsibilities:

- reimplementing trust checks
- owning closeout, dependency, residue, historical-delivery, or emergency policy semantics

## Adapter/Port

Use at host or adopter boundaries.

Good fits:

- Planning repo / governance workbench opener/closeback
- taskflow profile host opener
- future adopter repo integration
- broker-owned write actor boundary

Adapter responsibilities:

- translate host-specific paths and conventions into ATM contracts
- preserve ATM's public invariant contracts

Avoid:

- hard-coding one adopter's behavior into framework core
- letting host adapters become lifecycle authorities

## Commit Guidance

For framework refactors:

- delivery commit: source/test changes for the atom
- runner-sync commit: generated `release/**` or frozen runner artifacts, when needed
- closeout commit: `.atm/history/**` governance bundle

Avoid mixing runner sync into the delivery commit unless the task explicitly owns runner artifacts.
