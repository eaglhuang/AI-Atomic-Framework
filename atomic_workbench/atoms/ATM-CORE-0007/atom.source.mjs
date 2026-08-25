export const atomMetadata = Object.freeze({
  "atomId": "ATM-CORE-0007",
  "logicalName": "atom.npm-package.artifact-budget",
  "title": "CLI package artifact budget resource",
  "generatedBy": "atom.core-atom-generator"
});

export function runAtom(input = {}) {
  return {
    ok: true,
    atomId: atomMetadata.atomId,
    logicalName: atomMetadata.logicalName,
    input
  };
}

export function selfCheck() {
  return atomMetadata.atomId === "ATM-CORE-0007" && atomMetadata.logicalName === "atom.npm-package.artifact-budget";
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(atomMetadata.atomId + ' source self-check failed');
    process.exit(1);
  }
  console.log(atomMetadata.atomId + ' source self-check ok');
}
