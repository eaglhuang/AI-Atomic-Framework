import { buildGreetingRecord } from './legacy-system.ts';

export function run(input: { name?: string } = {}) {
  const name = typeof input.name === 'string' && input.name.length > 0
    ? input.name
    : 'operator';
  const legacyRecord = buildGreetingRecord(name);
  return {
    ...legacyRecord,
    atomId: 'ATM-EXAMPLE-0002',
    wrapped: true
  };
}
