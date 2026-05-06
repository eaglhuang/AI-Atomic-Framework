# ATM Quick Start

This guide runs the first two ATM examples in about 30 minutes.

## 1. Install

```bash
npm install
```

## 2. List Packages

```bash
npm run packages:list
```

## 3. Run Hello World

```bash
npm --workspace @ai-atomic-framework/example-hello-world test
node packages/cli/src/atm.mjs validate --spec examples/hello-world/atoms/hello-world.atom.json
```

## 4. Run Legacy Strangler Minimal

```bash
npm --workspace @ai-atomic-framework/example-legacy-strangler-minimal test
node packages/cli/src/atm.mjs validate --spec examples/legacy-strangler-minimal/atoms/legacy-greeting.atom.json
```

## 5. Run The Example Gate

```bash
npm run validate:examples
```

## 6. Run The Full Validation Set

```bash
npm test
npm run typecheck
npm run lint
```

These commands use the repository's own scripts. ATM provides the entrypoint, adapter records, specs, and validation evidence shape; it does not replace your project-specific validators.