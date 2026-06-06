export const atomId = "ATM-CORE-0003";
export const logicalName = "atom.plugin-rule-guard.neutrality-scanner";
export const sourceSpecPath = "specs/neutrality-scanner.atom.json";
export const generatorProvenance = 'generator-provenance:backfilled';

export function describeBackfill() {
  return { atomId, logicalName, sourceSpecPath, generatorProvenance };
}
