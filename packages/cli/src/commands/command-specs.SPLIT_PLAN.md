# `command-specs.ts` Split Plan (metadata vs accessors)

Status: **planned (not yet implemented)**.
Tracked by TASK-ATD-0020.

## Current state

`packages/cli/src/commands/command-specs.ts` is 713 lines. It contains:

- 4 shared option constants (`commonJsonOption`, `commonPrettyOption`,
  `commonHelpOption`, `commonCwdOption`) — ~5 lines.
- 28 `defineCommandSpec(...)` entries inside a frozen registry object — ~700
  lines.
- 2 accessor functions at the end: `getCommandSpec(name)` and
  `listCommandSpecs()` — ~10 lines.

The file is **all data, no logic**. Every spec is a structural literal
describing a CLI subcommand's positional args, options, and examples. This
matches the M3 split goal of "separate command metadata from the renderer
machinery".

## Target submodule layout

```
packages/cli/src/commands/command-specs.ts          (registry + accessors, ~80 lines)
packages/cli/src/commands/command-specs/
├── _common.ts                # shared option constants
├── bootstrap.spec.ts
├── budget.spec.ts
├── doctor.spec.ts
├── init.spec.ts
├── next.spec.ts
├── welcome.spec.ts
├── verify.spec.ts
├── ...                       # one file per subcommand (28 total)
├── agent-pack.spec.ts
└── review-advisory.spec.ts
```

Each `<command>.spec.ts` exports a single `defineCommandSpec(...)` call.
The new top-level `command-specs.ts` re-assembles the frozen registry and
keeps `getCommandSpec` / `listCommandSpecs` as the only public API.

## Acceptance gates

1. `npm run validate:cli` — help snapshot fixtures under
   `tests/cli-fixtures/help-snapshots/` MUST be byte-identical before and
   after the split. (These are the public-help frozen output.)
2. `npm run validate:standard` — full suite green.
3. `npm run typecheck` — no new errors.
4. The frozen registry produced by `command-specs.ts` after the split must
   be deep-equal to the registry before the split.

## Invariant exposure

- **I1** (public CLI surface stable): help output is part of the public CLI
  contract. The help-snapshot fixtures are the gate that catches any
  accidental drift.
- The split is purely organizational — no semantic change, no field rename.

## Why this is deferred

Same as TASK-ATD-0016 / TASK-ATD-0018: the working tree in this session had
pre-existing merge conflicts in `packages/plugin-sdk/` that broke 5 skew
smoke validators. Splitting a 700-line file into 28 new files and
re-importing them, on top of a broken baseline, would make verification
that "nothing user-visible changed" much harder.

## Rough effort estimate

- Add 28 spec files (one `defineCommandSpec(...)` call each, 5-25 lines each)
- Update `command-specs.ts` to import + assemble — ~60 lines
- Validate against help-snapshot fixtures — runs `validate:cli`
- Update any code that imports a non-existent symbol from `command-specs.ts`
  (none expected — the public API is only `getCommandSpec` /
  `listCommandSpecs` / `commandSpecs`)

Expected diff: +28 files, ~+800 lines, ~-650 lines from the original file,
net neutral on line count. Risk: low (data-only refactor) once the baseline
is clean.
