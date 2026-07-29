import { createHash } from 'node:crypto';

const options = parseArgs(process.argv.slice(2));
const payload = {
  schemaId: 'atm.pairedAbV4CellWorkload.v1',
  scale: Number(required(options, '--scale')),
  contention: required(options, '--contention'),
  repeat: Number(required(options, '--repeat')),
  cellIndex: Number(required(options, '--cell-index'))
};

const operationCount = payload.scale * (payload.contention.length + payload.repeat + 1);
let accumulator = 0;
for (let index = 0; index < operationCount; index += 1) accumulator = (accumulator + index + payload.scale) % 9973;
const digest = createHash('sha256').update(JSON.stringify({ payload, operationCount, accumulator })).digest('hex');
console.log(JSON.stringify({ ...payload, operationCount, accumulator, digest: `sha256:${digest}` }));

function parseArgs(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index] ?? '';
    const value = argv[index + 1] ?? '';
    if (key.startsWith('--')) parsed.set(key, value);
  }
  return parsed;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
