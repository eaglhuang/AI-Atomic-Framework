# ATM Quick Start

This guide runs the first ATM smoke path on the official npm route.

## 1. Install

```bash
npm install
```

## 2. Build And Check Signals

```bash
npm run packages:list
npm run build
npm run typecheck
npm run lint
```

`npm run build` now refreshes both `packages/*/dist` and the portable release bundle under `release/atm-root-drop/`.

## 2a. Try The Root-Drop Release Bundle

```bash
node release/atm-root-drop/atm.mjs next --json
```

## 2b. Try The One-File Release

```bash
node release/atm-onefile/atm.mjs next --json
```

This is the single-file embedded runtime path (no sibling bundle directory required).

## 3. Run The Example Smokes

```bash
npm --workspace @ai-atomic-framework/example-hello-world test
npm --workspace @ai-atomic-framework/example-legacy-strangler-minimal test
node atm.mjs validate --spec examples/hello-world/atoms/hello-world.atom.json
```

## 4. Run The First Validation Set

```bash
npm test
npm run validate:examples
node atm.mjs self-host-alpha --verify --json
```

## 5. Ask ATM What Is Next

```bash
node atm.mjs doctor --json
node atm.mjs next --json
```

Use `npm run validate:quick`, `npm run validate:standard`, or `npm run validate:full` when you need broader governance coverage than the smoke test.
