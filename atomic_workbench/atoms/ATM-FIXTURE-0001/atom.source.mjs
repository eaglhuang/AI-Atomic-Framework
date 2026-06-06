export const atomMetadata = Object.freeze({
  "atomId": "ATM-FIXTURE-0001",
  "logicalName": "atom.fixture-generator-dogfood",
  "title": "GeneratorDogfood",
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
  return atomMetadata.atomId === "ATM-FIXTURE-0001" && atomMetadata.logicalName === "atom.fixture-generator-dogfood";
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(atomMetadata.atomId + ' source self-check failed');
    process.exit(1);
  }
  console.log(atomMetadata.atomId + ' source self-check ok');
}
