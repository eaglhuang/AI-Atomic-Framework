export const atomMetadata = Object.freeze({
  atomId: 'ATM-CORE-0007',
  logicalName: 'atom.html-to-ucuf.parse-fragment-list',
  title: 'Parse Fragment List Atom',
  lineage: Object.freeze({
    bornBy: 'atomize',
    parentRefs: [
      'legacy://3KLife/tools_node/lib/dom-to-ui/draft-builder.js#L869-L874'
    ]
  })
});

export function parseFragmentList(raw) {
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function run(input = {}) {
  const fragments = typeof input === 'string'
    ? input
    : input && typeof input.fragments === 'string'
      ? input.fragments
      : '';

  return {
    atomId: atomMetadata.atomId,
    fragmentList: parseFragmentList(fragments),
    lineage: atomMetadata.lineage
  };
}

export function selfCheck() {
  const sample = parseFragmentList('a, b,,c');
  return sample.length === 3
    && sample[0] === 'a'
    && sample[1] === 'b'
    && sample[2] === 'c'
    && atomMetadata.lineage.bornBy === 'atomize';
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(`${atomMetadata.atomId} source self-check failed`);
    process.exit(1);
  }
  console.log(`${atomMetadata.atomId} source self-check ok`);
}
