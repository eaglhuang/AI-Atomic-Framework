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

## 3. Run The Example Smokes

```bash
npm --workspace @ai-atomic-framework/example-hello-world test
npm --workspace @ai-atomic-framework/example-legacy-strangler-minimal test
node packages/cli/src/atm.mjs validate --spec examples/hello-world/atoms/hello-world.atom.json
```

## 4. Run The First Validation Set

```bash
npm test
npm run validate:examples
node packages/cli/src/atm.mjs self-host-alpha --verify --json
```

## 5. Ask ATM What Is Next

```bash
node packages/cli/src/atm.mjs doctor --json
node packages/cli/src/atm.mjs next --json
```

Use `npm run validate:quick`, `npm run validate:standard`, or `npm run validate:full` when you need broader governance coverage than the smoke test.
