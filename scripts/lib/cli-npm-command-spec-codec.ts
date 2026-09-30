import { gzipSync } from 'node:zlib';

type Value = string | number | boolean | null | { ref: number } | { undefined: true };
interface NodeRecord {
  kind: 'object' | 'null' | 'array';
  length?: number;
  extensible: boolean;
  properties: Array<[string, Value, number]>;
}

/** Build-time encoding only: preserve data descriptors, aliases and cycles. */
export function encodeCommandSpecModule(specs: Readonly<Record<string, unknown>>): string {
  const nodes: NodeRecord[] = [];
  const seen = new Map<object, number>();
  function encode(value: unknown): Value {
    if (value === undefined) return { undefined: true };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== 'object' || value === null) throw new TypeError('Command specs must contain losslessly encodable data');
    const previous = seen.get(value);
    if (previous !== undefined) return { ref: previous };
    const prototype = Object.getPrototypeOf(value);
    const kind = Array.isArray(value) ? 'array' : prototype === null ? 'null' : prototype === Object.prototype ? 'object' : null;
    if (!kind || Object.getOwnPropertySymbols(value).length) throw new TypeError('Unsupported command spec object');
    const id = nodes.length;
    seen.set(value, id);
    const node: NodeRecord = { kind, extensible: Object.isExtensible(value), properties: [] };
    if (Array.isArray(value)) node.length = value.length;
    nodes.push(node);
    // Define array length last, after indices, even when length is read-only.
    const names = Object.getOwnPropertyNames(value).sort((a, b) => a === 'length' && kind === 'array' ? 1 : b === 'length' && kind === 'array' ? -1 : 0);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
      if (!('value' in descriptor)) throw new TypeError('Command spec accessors cannot be serialized');
      const flags = Number(descriptor.writable) | (Number(descriptor.enumerable) << 1) | (Number(descriptor.configurable) << 2);
      node.properties.push([name, encode(descriptor.value), flags]);
    }
    return { ref: id };
  }
  const root = encode(specs);
  const data = gzipSync(JSON.stringify({ root, nodes }), { level: 9 }).toString('base64');
  return `import { gunzipSync } from 'node:zlib';
const payload = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(data)}, 'base64')).toString('utf8'));
const objects = payload.nodes.map(node => node.kind === 'array' ? new Array(node.length) : node.kind === 'null' ? Object.create(null) : {});
const decode = value => value && typeof value === 'object' ? 'ref' in value ? objects[value.ref] : undefined : value;
payload.nodes.forEach((node, index) => {
  for (const [key, value, flags] of node.properties) Object.defineProperty(objects[index], key, { value: decode(value), writable: !!(flags & 1), enumerable: !!(flags & 2), configurable: !!(flags & 4) });
  if (!node.extensible) Object.preventExtensions(objects[index]);
});
export const commandSpecs = decode(payload.root);
export function getCommandSpec(name) { return name in commandSpecs ? commandSpecs[name] : null; }
export function listCommandSpecs(options = {}) { return Object.values(commandSpecs).filter(spec => options.includeInternal || spec.visibility !== 'internal'); }
`;
}
