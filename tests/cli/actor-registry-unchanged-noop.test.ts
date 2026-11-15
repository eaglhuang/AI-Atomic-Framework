import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { actorRegistryRelativePath, upsertActorRecord } from '../../packages/cli/src/commands/actor-registry.ts';

// Re-asserting an unchanged identity (identity set on every lock/renew) must
// not rewrite the tracked actor registry with fresh timestamps.
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-actor-noop-'));
try {
  const input = { actorId: 'noop-actor', actorKind: 'ai-agent' as const, displayName: 'Noop Actor', gitName: 'Noop', gitEmail: 'noop@example.invalid' };
  const registryFile = path.join(cwd, actorRegistryRelativePath);
  upsertActorRecord(cwd, input);
  const first = readFileSync(registryFile, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 15));
  upsertActorRecord(cwd, input);
  assert.equal(readFileSync(registryFile, 'utf8'), first, 'unchanged identity must leave the registry byte-identical');
  upsertActorRecord(cwd, { ...input, gitEmail: 'changed@example.invalid' });
  const changed = JSON.parse(readFileSync(registryFile, 'utf8'));
  assert.equal(changed.actors[0].gitEmail, 'changed@example.invalid', 'a real change must still be written');
  assert.notEqual(changed.generatedAt, JSON.parse(first).generatedAt, 'a real change refreshes generatedAt');
  console.log('[actor-registry-unchanged-noop.test] ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
