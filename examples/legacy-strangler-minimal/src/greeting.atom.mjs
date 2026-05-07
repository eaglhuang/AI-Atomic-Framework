import { buildGreetingRecord } from './legacy-system.mjs';

export function run(input = {}) {
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