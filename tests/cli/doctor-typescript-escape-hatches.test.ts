import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../../packages/cli/src/commands/doctor.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
type DoctorCheckRecord = {
  readonly name: string;
  readonly ok: boolean;
  readonly details: Record<string, unknown>;
};

function asDoctorChecks(value: unknown): DoctorCheckRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is DoctorCheckRecord => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    return typeof record.name === 'string'
      && typeof record.ok === 'boolean'
      && !!record.details
      && typeof record.details === 'object'
      && !Array.isArray(record.details);
  });
}

const result = await runDoctor(['--cwd', repoRoot, '--json']);
const evidence = result.evidence as Record<string, unknown> | undefined;
const check = asDoctorChecks(evidence?.checks).find((entry) => entry.name === 'typescript-escape-hatches');

assert.ok(check, 'doctor should report the TypeScript escape-hatch check');
assert.equal(check.ok, true);
assert.equal(check.details.baselineCount, 31);
assert.deepEqual(check.details.unexpectedFiles, []);

const groups = check.details.cleanupOwnerGroups;
assert.equal(Array.isArray(groups), true);
const groupRecords = Array.isArray(groups) ? groups : [];
assert.deepEqual(
  groupRecords.map((group: unknown) => {
    const record = group as Record<string, unknown>;
    return [record.ownerId, record.fileCount];
  }),
  [
    ['broker', 11],
    ['next', 16],
    ['hook-pre-commit', 3],
    ['git-governance', 1]
  ]
);

const cards = check.details.recommendedCleanupCards;
assert.equal(Array.isArray(cards), true);
const cardRecords = Array.isArray(cards) ? cards : [];
assert.equal(cardRecords.length, 4);
assert.ok(cardRecords.every((card: unknown) => {
  const record = card as Record<string, unknown>;
  return typeof record.followUp === 'string' && record.followUp.includes('cleanup card');
}));

console.log('[doctor-typescript-escape-hatches:test] ok');
