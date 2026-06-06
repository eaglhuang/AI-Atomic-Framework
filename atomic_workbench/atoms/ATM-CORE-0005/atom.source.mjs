export const atomMetadata = Object.freeze({
  "atomId": "ATM-CORE-0005",
  "logicalName": "atom.core-atomic-spec-semantic-fingerprint",
  "title": "AtomicSpecSemanticFingerprint",
  "generatedBy": "atom.core-atom-generator",
  "atomizedFrom": "packages/core/src/registry/semantic-fingerprint.ts#createAtomicSpecSemanticFingerprint"
});

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

export function selfCheck() {
  const first = runAtom({
    inputs: [
      { name: "beta", kind: "text", required: true },
      { name: "alpha", kind: "json", required: false }
    ],
    outputs: [{ name: "result", kind: "json", required: true }],
    language: { primary: "typescript" },
    validation: { evidenceRequired: true },
    performanceBudget: {
      hotPath: false,
      inputMutation: "forbidden",
      maxDurationMs: 1000
    }
  });
  const reordered = runAtom({
    inputs: [
      { name: "alpha", kind: "json", required: false },
      { name: "beta", kind: "text", required: true }
    ],
    outputs: [{ name: "result", kind: "json", required: true }],
    language: { primary: "typescript" },
    validation: { evidenceRequired: true },
    performanceBudget: {
      hotPath: false,
      inputMutation: "forbidden",
      maxDurationMs: 1000
    }
  });

  return atomMetadata.atomId === "ATM-CORE-0005"
    && atomMetadata.logicalName === "atom.core-atomic-spec-semantic-fingerprint"
    && first.semanticFingerprint === reordered.semanticFingerprint
    && first.semanticFingerprint.startsWith("sf:sha256:");
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(atomMetadata.atomId + ' source self-check failed');
    process.exit(1);
  }
  console.log(atomMetadata.atomId + ' source self-check ok');
}
