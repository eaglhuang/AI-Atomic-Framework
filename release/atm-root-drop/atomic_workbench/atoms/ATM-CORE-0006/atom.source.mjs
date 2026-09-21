export const atomMetadata = Object.freeze({
  "atomId": "ATM-CORE-0006",
  "logicalName": "atom.npm-package.runtime-allowlist",
  "title": "CLI package runtime allowlist resource",
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
  return atomMetadata.atomId === "ATM-CORE-0006" && atomMetadata.logicalName === "atom.npm-package.runtime-allowlist";
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(atomMetadata.atomId + ' source self-check failed');
    process.exit(1);
  }
  console.log(atomMetadata.atomId + ' source self-check ok');
}
