export const atomMetadata = Object.freeze({
  atomId: 'ATM-CORE-0006',
  logicalName: 'atom.html-to-ucuf.parse-css-length',
  title: 'Parse CSS Length Atom',
  lineage: Object.freeze({
    bornBy: 'atomize',
    parentRefs: [
      'legacy://3KLife/tools_node/lib/dom-to-ui/snapshot-to-slots.js#L6-L10'
    ]
  })
});

export function parseCssLength(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return 0;
  }
  const text = String(input).trim();
  if (!text) {
    return 0;
  }
  const match = text.match(/(-?\d+(?:\.\d+)?)px/);
  if (!match) {
    return 0;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : 0;
}

export function run(input = {}) {
  const length = typeof input === 'string'
    ? input
    : input && (typeof input.length === 'string' || typeof input.length === 'number')
      ? String(input.length)
      : '';

  return {
    atomId: atomMetadata.atomId,
    parsedLength: parseCssLength(length),
    lineage: atomMetadata.lineage
  };
}

export function selfCheck() {
  return parseCssLength('16px') === 16
    && parseCssLength(' -24.5px ') === -24.5
    && parseCssLength('auto') === 0
    && atomMetadata.lineage.bornBy === 'atomize';
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(`${atomMetadata.atomId} source self-check failed`);
    process.exit(1);
  }
  console.log(`${atomMetadata.atomId} source self-check ok`);
}
