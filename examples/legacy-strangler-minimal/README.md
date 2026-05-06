# ATM Legacy Strangler Minimal Example

This example shows how ATM can wrap a small legacy function without rewriting it first.

Run it from the repository root:

```bash
npm run validate:examples
```

Run only the example test:

```bash
npm --workspace @ai-atomic-framework/example-legacy-strangler-minimal test
```

`src/legacy-system.mjs` stands in for existing code. `src/greeting.atom.mjs` is the atom wrapper that gives ATM a clean entrypoint.