# Public npm package proof

`TASK-PRF-0004` separates the publishable runtime payload from repository-only
source and test assets. The canonical public closure is the 27-package list in
`tests/package-skeleton.fixture.json`; example workspaces are deliberately not
part of it. Every package publishes `dist` only unless that fixture explicitly
allows a runtime-loaded `templates` or `schemas` directory. `create-atm` also
publishes its package README.

Before a release tag, run:

```text
node --strip-types scripts/validate-package-skeleton.ts
node --strip-types tests/cli/npm-clean-install.test.ts
node --strip-types scripts/validate-npm-clean-install.ts
```

The final command packs exactly that public closure into an operating-system
temporary directory, rejects undeclared paths such as `src` and tests, installs
the complete tarball set into a fresh npm project, and verifies the declared
executables respond to `--help`. It removes that temporary directory afterward.
The release workflow uses the same explicit closure rather than `--workspaces`,
so it cannot publish example packages. Stable publication remains a separate
human-approved release action; this proof never publishes or promotes an npm
version.
