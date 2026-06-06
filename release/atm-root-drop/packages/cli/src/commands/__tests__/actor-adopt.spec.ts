import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runActor } from '../actor.ts';
import {
  composeAdoptSlug,
  readActorRegistry,
  readGitLocalConfigValue,
  readRuntimeIdentityDefault,
  snapshotGitLocalIdentity
} from '../actor-registry.ts';

function initGitRepo(cwd: string) {
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', '--local', 'user.name', 'pre-existing-actor'], { cwd });
  execFileSync('git', ['config', '--local', 'user.email', 'pre-existing-actor@example.local'], { cwd });
}

async function main() {

// 1. composeAdoptSlug normalises and concatenates editor + model.
assert.equal(composeAdoptSlug('Claude-Code', 'Opus-4-7'), 'claude-code-opus-4-7');
assert.throws(() => composeAdoptSlug('', 'opus'), /requires non-empty/);
assert.throws(() => composeAdoptSlug('claude-code', ''), /requires non-empty/);

// 2. Happy path: actor adopt writes all three caches atomically.
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-actor-adopt-'));
try {
  initGitRepo(tempRoot);
  const before = snapshotGitLocalIdentity(tempRoot);
  assert.equal(before.name, 'pre-existing-actor');
  assert.equal(before.email, 'pre-existing-actor@example.local');

  const result = await runActor([
    'adopt',
    '--cwd', tempRoot,
    '--editor', 'claude-code',
    '--model', 'opus-4-7',
    '--kind', 'ai-agent',
    '--session', 'session-test-001',
    '--json'
  ]) as any;

  assert.equal(result.ok, true, `adopt should succeed, got: ${JSON.stringify(result?.messages)}`);
  assert.equal(result.evidence.actorId, 'claude-code-opus-4-7');
  assert.equal(result.evidence.previousActorId, null);
  assert.equal(result.evidence.gitConfigChanged, true);
  assert.equal(result.evidence.editor, 'claude-code');
  assert.equal(result.evidence.activeSessionId, 'session-test-001');

  // git config mutated
  const after = snapshotGitLocalIdentity(tempRoot);
  assert.equal(after.name, 'claude-code-opus-4-7');
  assert.equal(after.email, 'claude-code-opus-4-7@atm.local');

  // actor registry written
  const registry = readActorRegistry(tempRoot);
  const actor = registry.actors.find((a) => a.actorId === 'claude-code-opus-4-7');
  assert.ok(actor, 'actor record should be written');
  assert.equal(actor!.actorKind, 'ai-agent');
  assert.equal(actor!.gitName, 'claude-code-opus-4-7');
  assert.equal(actor!.editor, 'claude-code');

  // runtime default written
  const runtime = readRuntimeIdentityDefault(tempRoot);
  assert.ok(runtime, 'runtime default should be written');
  assert.equal(runtime!.actorId, 'claude-code-opus-4-7');
  assert.equal(runtime!.activeSessionId, 'session-test-001');
  assert.equal(runtime!.editor, 'claude-code');

  // 3. Second adopt records previousActorId.
  const result2 = await runActor([
    'adopt',
    '--cwd', tempRoot,
    '--editor', 'vs-code',
    '--model', 'gpt-5-mini',
    '--json'
  ]) as any;
  assert.equal(result2.ok, true);
  assert.equal(result2.evidence.actorId, 'vs-code-gpt-5-mini');
  assert.equal(result2.evidence.previousActorId, 'claude-code-opus-4-7');
  assert.equal(readGitLocalConfigValue(tempRoot, 'user.name'), 'vs-code-gpt-5-mini');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

// 4. Missing --model is rejected before any state change.
const tempRoot2 = mkdtempSync(path.join(os.tmpdir(), 'atm-actor-adopt-err-'));
try {
  initGitRepo(tempRoot2);
  const before = snapshotGitLocalIdentity(tempRoot2);
  let threw: any = null;
  try {
    await runActor(['adopt', '--cwd', tempRoot2, '--editor', 'codex', '--json']);
  } catch (error) {
    threw = error;
  }
  assert.ok(threw, 'missing --model should throw');
  assert.match(String(threw?.message ?? ''), /--model/);
  // git config untouched
  const after = snapshotGitLocalIdentity(tempRoot2);
  assert.equal(after.name, before.name);
  assert.equal(after.email, before.email);
  // No runtime default file written
  assert.equal(existsSync(path.join(tempRoot2, '.atm/runtime/identity/default.json')), false);
} finally {
  rmSync(tempRoot2, { recursive: true, force: true });
}

console.log('[actor-adopt] all assertions passed.');

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
