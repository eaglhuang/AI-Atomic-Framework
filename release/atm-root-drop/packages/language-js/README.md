# @ai-atomic-framework/language-js

Language JS is the reference JavaScript and TypeScript language adapter for ATM.

It keeps project-specific validators in the project while providing three reusable contracts:

- scan JavaScript and TypeScript imports against a declared import policy;
- validate that a compute atom entrypoint exports a callable entry function;
- describe test, typecheck, and lint commands as delegated project commands.
- declare mandatory adapter-native `fast` / `default` / `all` static-check plans.

The adapter does not replace a repository's existing test runner. It records how ATM should call that runner and what evidence should be collected.

## Static Check Tiers

- `fast` prefers the declared typecheck command and falls back to lint when typecheck is absent.
- `default` runs the normal static pair of typecheck plus lint.
- `all` stays static-only and currently matches the full declared JS/TS static set.
