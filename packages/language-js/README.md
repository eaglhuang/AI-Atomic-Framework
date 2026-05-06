# @ai-atomic-framework/language-js

Language JS is the reference JavaScript and TypeScript language adapter for ATM.

It keeps project-specific validators in the project while providing three reusable contracts:

- scan JavaScript and TypeScript imports against a declared import policy;
- validate that a compute atom entrypoint exports a callable entry function;
- describe test, typecheck, and lint commands as delegated project commands.

The adapter does not replace a repository's existing test runner. It records how ATM should call that runner and what evidence should be collected.