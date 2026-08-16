import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { runWaveExitObserver } from '../../packages/cli/src/commands/evidence/verbs/wave-exit-observer.ts';
import {
  WaveExitObserverWriteError,
  writeWaveExitObserverReceipt
} from '../../packages/core/src/evidence/wave-exit-observer-receipt-writer.ts';
import {
  canonicalWaveExitReceiptPath,
  digestWaveExitObserverPolicy,
  loadWaveExitObserverPolicy,
  WAVE_EXIT_OBSERVER_POLICY_PATH,
  type WaveExitObserverPolicy
} from '../../packages/core/src/evidence/wave-exit-observer-receipt.ts';

const hex = (seed: string): string => seed.repeat(40).slice(0, 40);
const observedHead = hex('1');
const policy = loadWaveExitObserverPolicy();
const policySource = readFileSync(WAVE_EXIT_OBSERVER_POLICY_PATH, 'utf8');
const files = new Map<string, string>();

function clonePolicy(overrides: Partial<WaveExitObserverPolicy> = {}): WaveExitObserverPolicy {
  return {
    ...policy,
    ...overrides,
    roles: { ...policy.roles, ...(overrides.roles ?? {}) },
    exits: { ...policy.exits, ...(overrides.exits ?? {}) }
  };
}

function writeOnce(input: Parameters<typeof writeWaveExitObserverReceipt>[0]) {
  return writeWaveExitObserverReceipt(input);
}

function baseInput(overrides: Record<string, unknown> = {}) {
  const exitItemId = String(overrides.exitItemId ?? 'EXIT-02');
  const exitPolicy = policy.exits[exitItemId] ?? policy.exits['EXIT-02'];
  const inputBodies: Record<string, string> = {};
  for (const path of exitPolicy.inputs) inputBodies[path] = `observed:${path}`;
  return {
    repoRoot: '/repo',
    exitItemId,
    observerActor: String(overrides.observerActor ?? 'gemini-wave-exit-observer'),
    observerRole: String(overrides.observerRole ?? exitPolicy.observerRole),
    policy,
    observedHead,
    observedAt: '2026-08-16T00:00:00.000Z',
    derivedBasis: {
      actorIds: ['wave-1-basis-producer'],
      producerRole: policy.basisProducerRole
    },
    isAncestor: (ancestor: string, descendant: string) => ancestor === descendant && ancestor === observedHead,
    readObservedInput: (relativePath: string) => (
      relativePath === WAVE_EXIT_OBSERVER_POLICY_PATH ? policySource : inputBodies[relativePath] ?? null
    ),
    executeApprovedCommand: () => ({ exitCode: 0, stdout: 'ok\n', stderr: '' }),
    receiptExists: (absolutePath: string) => files.has(absolutePath.replace(/\\/g, '/')),
    createExclusiveFile: (absolutePath: string, contents: string) => {
      const key = absolutePath.replace(/\\/g, '/');
      if (files.has(key)) {
        throw new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS', 'exists', { details: { dest: key } });
      }
      files.set(key, contents);
    },
    ...overrides
  };
}

files.clear();
const gemini = writeOnce(baseInput());
assert.equal(gemini.ok, true);
assert.equal(gemini.artifactPath, 'docs/reports/wave-exit-observer-receipts/EXIT-02.json');
assert.equal(gemini.receipt.observerRole, 'wave-exit-observer.gemini');
assert.equal(gemini.receipt.command, policy.exits['EXIT-02'].command);
assert.equal(gemini.receipt.declaredBasisActor, 'wave-1-basis-producer');
assert.equal(gemini.receipt.policyDigest, digestWaveExitObserverPolicy(policy));
assert.match(gemini.receipt.stdoutDigest, /^sha256:[a-f0-9]{64}$/);

files.clear();
const claude = writeOnce(baseInput({
  exitItemId: 'EXIT-04',
  observerActor: 'claude-wave-exit-observer',
  observerRole: 'wave-exit-observer.claude'
}));
assert.equal(claude.ok, true);
assert.equal(claude.artifactPath, canonicalWaveExitReceiptPath(policy, 'EXIT-04'));
assert.equal(claude.receipt.observerRole, 'wave-exit-observer.claude');
assert.equal(claude.receipt.command, policy.exits['EXIT-04'].command);

const fail = (input: ReturnType<typeof baseInput>, code: string) => {
  files.clear();
  assert.throws(
    () => writeOnce(input),
    (error: unknown) => error instanceof WaveExitObserverWriteError && error.code === code
  );
};

fail(baseInput({ exitItemId: 'EXIT-01' }), 'ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED');
fail(baseInput({ claimedCommand: 'node --strip-types scripts/compile-runbook-completion-evidence.ts --mode validate' }), 'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND');
fail(baseInput({ extraFlags: ['--command'], claimedCommand: 'node evil.js' }), 'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND');
fail(baseInput({
  exitItemId: 'EXIT-04',
  observerActor: 'gemini-wave-exit-observer',
  observerRole: 'wave-exit-observer.gemini'
}), 'ATM_WAVE_EXIT_OBSERVER_ROLE_MISMATCH');
fail(baseInput({ observerActor: 'wave-1-basis-producer' }), 'ATM_WAVE_EXIT_OBSERVER_ACTOR_CONFLICT');
fail(baseInput({ claimedBasisActor: 'forged-basis' }), 'ATM_WAVE_EXIT_OBSERVER_CALLER_OVERRIDE');
fail(baseInput({
  claimedInputDigests: { [policy.exits['EXIT-02'].inputs[0]]: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }
}), 'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT');
fail(baseInput({ isAncestor: () => false }), 'ATM_WAVE_EXIT_OBSERVER_HEAD_UNREACHABLE');
fail(baseInput({
  policy: clonePolicy({ canonicalReceiptDir: 'docs/reports/../../packages/core' })
}), 'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL');
fail(baseInput({ claimedArtifactPath: 'docs/reports/plan-3x-4x-independent-certificate.json' }), 'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL');
fail(baseInput({
  derivedBasis: {
    actorIds: ['codex-gpt-5.4-mini', 'codex-captain-recovery', 'cursor-captain'],
    producerRole: policy.basisProducerRole
  }
}), 'ATM_WAVE_EXIT_OBSERVER_BASIS_UNRESOLVED');
fail(baseInput({ extraFlags: ['--write'], exitItemId: 'EXIT-10', observerRole: 'wave-exit-observer.gemini' }), 'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_FLAG');
fail(baseInput({ executeApprovedCommand: () => ({ exitCode: 2, stdout: '', stderr: 'nope' }) }), 'ATM_WAVE_EXIT_OBSERVER_NONZERO_EXIT');

files.clear();
writeOnce(baseInput());
assert.throws(
  () => writeOnce(baseInput()),
  (error: unknown) => error instanceof WaveExitObserverWriteError && error.code === 'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS'
);

const tmp = mkdtempSync(join(tmpdir(), 'atm-wave-exit-writer-'));
mkdirSync(join(tmp, '.atm', 'history', 'evidence'), { recursive: true });
mkdirSync(join(tmp, '.atm', 'history', 'tasks'), { recursive: true });
writeFileSync(join(tmp, '.atm', 'history', 'evidence', 'ATM-GOV-0341.json'), JSON.stringify({
  evidence: [
    { producedBy: 'codex-gpt-5.4-mini' },
    { producedBy: 'codex-captain-recovery' },
    { producedBy: 'cursor-captain' }
  ]
}), 'utf8');
writeFileSync(join(tmp, '.atm', 'history', 'tasks', 'ATM-GOV-0341.json'), JSON.stringify({
  claim: { actorId: 'wave-1-basis-producer' }
}), 'utf8');
const inputBodies: Record<string, string> = {};
for (const path of policy.exits['EXIT-02'].inputs) inputBodies[path] = `live:${path}`;

const cliOk = runWaveExitObserver(
  ['--cwd', tmp, '--exit', 'EXIT-02', '--actor', 'gemini-wave-exit-observer', '--observer-role', 'wave-exit-observer.gemini', '--json'],
  {
    loadPolicy: () => policy,
    resolveHead: () => observedHead,
    isAncestor: (_cwd, ancestor, descendant) => ancestor === descendant,
    readObservedInput: (_cwd, _head, relativePath) => (
      relativePath === WAVE_EXIT_OBSERVER_POLICY_PATH ? policySource : inputBodies[relativePath] ?? null
    ),
    executeApprovedCommand: () => ({ exitCode: 0, stdout: 'cli-ok\n', stderr: '' }),
    now: () => '2026-08-16T00:00:00.000Z'
  }
);
assert.equal(cliOk.ok, true);
const writtenPath = join(tmp, 'docs', 'reports', 'wave-exit-observer-receipts', 'EXIT-02.json');
const disk = JSON.parse(readFileSync(writtenPath, 'utf8'));
assert.equal(disk.schemaId, 'atm.waveExitObserverReceipt.v1');
assert.equal(disk.observerActor, 'gemini-wave-exit-observer');
assert.equal(disk.declaredBasisActor, 'wave-1-basis-producer');

assert.throws(
  () => runWaveExitObserver(
    ['--cwd', tmp, '--exit', 'EXIT-02', '--actor', 'gemini-wave-exit-observer', '--observer-role', 'wave-exit-observer.gemini', '--basis-owners', 'ATM-GOV-0341', '--command', 'node evil.js', '--json'],
    {
      loadPolicy: () => policy,
      resolveHead: () => observedHead,
      isAncestor: () => true,
      readObservedInput: () => 'x',
      executeApprovedCommand: () => ({ exitCode: 0, stdout: '', stderr: '' })
    }
  ),
  (error: unknown) => error instanceof CliError && error.code === 'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND'
);

console.log('wave-exit-observer-receipt-writer fixtures: legal Gemini/Claude write; illegal EXIT/command/actor/digest/head/role/path/duplicate fail-closed');
