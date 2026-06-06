# ATM-CORE-0005 Readability Pilot

This atom is a live atomization wrapper for one existing ATM framework function and one real call-site replacement:

- Source of truth: `packages/core/src/registry/semantic-fingerprint.ts#createAtomicSpecSemanticFingerprint`
- Replaced call site: `packages/core/src/spec/parse-spec.ts`
- Runtime facade: `packages/core/src/registry/atom-runtime.ts`
- Atom wrapper: `atomic_workbench/atoms/ATM-CORE-0005/atom.source.mjs`
- Contract: `atomic_workbench/atoms/ATM-CORE-0005/atom.spec.json`
- Local check: `node --experimental-strip-types "atomic_workbench/atoms/ATM-CORE-0005/atom.test.ts"`

## Call-Site Before and After

| Before: direct function call | After: semantic atom call |
| --- | --- |
| `createAtomicSpecSemanticFingerprint(specDocument)` tells the reader the exact helper function. | `runAtm(atomicSpecSemanticFingerprintAtom, specDocument)` keeps `runAtm` as the black-box executor, while the atom ref carries the business meaning. |

```ts
semanticFingerprint: normalizeSemanticFingerprint(
  specDocument.semanticFingerprint ?? createAtomicSpecSemanticFingerprint(specDocument)
)
```

```ts
semanticFingerprint: normalizeSemanticFingerprint(
  specDocument.semanticFingerprint ?? runAtm(atomicSpecSemanticFingerprintAtom, specDocument)
)
```

The atom ref is intentionally named for the domain action, not the numeric atom id:

```ts
export const atomicSpecSemanticFingerprintAtom = Object.freeze({
  atomId: 'ATM-CORE-0005',
  logicalName: 'atom.core-atomic-spec-semantic-fingerprint',
  purpose: 'Create canonical semantic fingerprint for an atomic spec.',
  run: createAtomicSpecSemanticFingerprint
});
```

## Wrapped Logic

```ts
export function createAtomicSpecSemanticFingerprint(input: AtomicSpecSemanticFingerprintInput): string {
  return createSemanticFingerprint({
    inputs: normalizeSpecPorts(input.inputs),
    outputs: normalizeSpecPorts(input.outputs),
    language: {
      primary: normalizeRequiredText(input.language?.primary ?? '')
    },
    validation: {
      evidenceRequired: input.validation?.evidenceRequired === true
    },
    performanceBudget: normalizePerformanceBudget(input.performanceBudget)
  });
}
```

```js
import { createAtomicSpecSemanticFingerprint } from "../../../packages/core/src/registry/semantic-fingerprint.ts";

export function runAtom(input = {}) {
  const semanticFingerprint = createAtomicSpecSemanticFingerprint(input);
  return {
    ok: true,
    atomId: atomMetadata.atomId,
    logicalName: atomMetadata.logicalName,
    sourceSymbol: atomMetadata.atomizedFrom,
    semanticFingerprint
  };
}
```

## Readability Notes

- Good: the production function was not hidden inside generated JSON.
- Good: the call site reads as `runAtm(atomicSpecSemanticFingerprintAtom, specDocument)`, not `runAtm('ATM-CORE-0005', specDocument)`.
- Good: the wrapper points directly back to the original source symbol.
- Friction: the reader must still hop across source, wrapper, spec, registry, and evidence.
- Friction: `runAtm` is acceptable as a black box only if the atom ref name stays domain-specific and discoverable.
- Likely improvement: ATM should provide a direct `where` or `trace` command for `ATM-CORE-0005` so humans do not manually chase these files.
