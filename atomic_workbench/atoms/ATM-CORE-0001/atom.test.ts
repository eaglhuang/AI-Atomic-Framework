export const atomId = "ATM-CORE-0001";
export const logicalName = "atom.core-seed";
export const sourceSpecPath = "specs/atom-seed-spec.json";
export const generatorProvenance = 'generator-provenance:backfilled';

export function describeBackfill() {
  return { atomId, logicalName, sourceSpecPath, generatorProvenance };
}
