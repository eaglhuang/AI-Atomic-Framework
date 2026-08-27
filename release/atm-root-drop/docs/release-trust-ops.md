# Public npm package proof

`TASK-PRF-0004` separates the publishable runtime payload from repository-only
source and test assets. The public `@ai-atomic-framework/cli` package publishes
only `dist`; `create-atm` publishes `dist` plus its package README.

Before a release tag, run:

```text
node --strip-types scripts/validate-package-skeleton.ts
node --strip-types tests/cli/npm-clean-install.test.ts
node --strip-types scripts/validate-npm-clean-install.ts
```

The final command creates package tarballs in an operating-system temporary
directory, installs each in a fresh temporary npm project, and verifies the
declared executable responds to `--help`. It removes that temporary directory
afterward. Stable publication remains a separate human-approved release action;
this proof never publishes or promotes an npm version.
