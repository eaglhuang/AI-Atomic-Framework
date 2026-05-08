export const atomMetadata = Object.freeze({
  atomId: 'ATM-CORE-0005',
  logicalName: 'atom.html-to-ucuf.normalize-css-color',
  title: 'Normalize CSS Color Atom',
  lineage: Object.freeze({
    bornBy: 'atomize',
    parentRefs: [
      'legacy://3KLife/tools_node/lib/dom-to-ui/draft-builder.js#L2867-L2890'
    ]
  })
});

export function normalizeCssColor(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const value = input.trim();
  if (!value) {
    return null;
  }

  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1].toUpperCase();
    if (hex.length === 3) {
      return `#${expandHex(hex)}FF`;
    }
    if (hex.length === 4) {
      return `#${expandHex(hex)}`;
    }
    if (hex.length === 6) {
      return `#${hex}FF`;
    }
    return `#${hex}`;
  }

  const rgbaMatch = value.match(/^rgba?\(\s*([^)]+)\s*\)$/i);
  if (!rgbaMatch) {
    return null;
  }

  const parts = rgbaMatch[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const r = clampCssByte(parts[0]);
  const g = clampCssByte(parts[1]);
  const b = clampCssByte(parts[2]);
  let a = 255;
  if (parts.length >= 4) {
    const alpha = parts[3];
    const alphaValue = /%$/.test(alpha) ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
    if (Number.isFinite(alphaValue)) {
      a = Math.max(0, Math.min(255, Math.round(alphaValue * 255)));
    }
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}

export function run(input = {}) {
  const color = typeof input === 'string'
    ? input
    : input && typeof input.color === 'string'
      ? input.color
      : '';

  return {
    atomId: atomMetadata.atomId,
    normalizedColor: normalizeCssColor(color),
    lineage: atomMetadata.lineage
  };
}

export function selfCheck() {
  return normalizeCssColor('#abc') === '#AABBCCFF'
    && normalizeCssColor('#abcd') === '#AABBCCDD'
    && normalizeCssColor('rgba(0, 0, 0, 0.5)') === '#00000080'
    && atomMetadata.lineage.bornBy === 'atomize';
}

function expandHex(hex) {
  return hex.split('').map((character) => character + character).join('');
}

function clampCssByte(value) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(number)));
}

function toHex(value) {
  return clampCssByte(value).toString(16).padStart(2, '0').toUpperCase();
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(`${atomMetadata.atomId} source self-check failed`);
    process.exit(1);
  }
  console.log(`${atomMetadata.atomId} source self-check ok`);
}