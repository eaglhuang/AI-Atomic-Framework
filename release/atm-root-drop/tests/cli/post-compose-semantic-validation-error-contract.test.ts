import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED,
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE,
  ATM_ERROR_CODE_REGISTRY,
  ATM_ERROR_CODE_REGISTRY_DIGEST
} from '../../packages/generated/src/error-codes.ts';
import {
  evaluatePostComposeSemanticValidation,
  type PostComposeSemanticCandidate
} from '../../packages/core/src/broker/post-compose-semantic-validation-policy.ts';

type RegistryEntry = {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly sourceOwner: string;
  readonly registryOwner?: string;
  readonly trigger?: string;
  readonly requiredEvidence?: readonly string[];
  readonly statusCommand?: string;
  readonly relatedCommands: readonly string[];
  readonly remediation: readonly string[];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredContracts = {
  [ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED]: {
    category: 'team-broker',
    sourceOwner: 'packages/core/src/broker/post-compose-semantic-validation-policy.ts',
    triggerNeedle: /failing command-backed exit result/i,
    remediationNeedle: /same sealed validator set|Repair or recompute/i
  },
  [ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE]: {
    category: 'team-broker',
    sourceOwner: 'packages/core/src/broker/post-compose-semantic-validation-policy.ts',
    triggerNeedle: /missing, unresolved, unexecuted, malformed, or lacks a command-backed result/i,
    remediationNeedle: /Restore or resolve the declared|Do not skip the unavailable validator/i
  }
} as const;

const registryText = readFileSync('docs/governance/error-code-registry.json', 'utf8');
const registry = JSON.parse(registryText) as {
  readonly schemaId: string;
  readonly specVersion: string;
  readonly entries: readonly RegistryEntry[];
};
const docs = readFileSync('docs/ERROR_CODES.md', 'utf8');
const entriesByCode = new Map(registry.entries.map((entry) => [entry.code, entry]));

for (const [code, expected] of Object.entries(requiredContracts)) {
  const entry = entriesByCode.get(code);
  assert(entry, `${code} must have one exact canonical registry entry`);
  assert.equal(entry.category, expected.category, `${code} category`);
  assert.equal(entry.sourceOwner, expected.sourceOwner, `${code} source owner`);
  assert.equal(entry.registryOwner, 'TASK-ERR-0006', `${code} registry owner`);
  assert.equal(entry.retryable, true, `${code} retryability`);
  assert.equal(entry.requiresHumanApproval, false, `${code} approval policy`);
  assert(entry.trigger && expected.triggerNeedle.test(entry.trigger), `${code} exact trigger`);
  assert(entry.requiredEvidence && entry.requiredEvidence.length > 0, `${code} required evidence`);
  assert(entry.statusCommand && entry.statusCommand.trim().length > 0, `${code} status command`);
  assert(entry.relatedCommands.some((command) => command.includes('post-compose-semantic-validation')), `${code} recovery routes through semantic validation`);
  assert(entry.remediation.some((line) => expected.remediationNeedle.test(line)), `${code} remediation`);
  assert(entry.remediation.every((line) => !/healthy boolean|skip the validator/i.test(line) || /Do not/.test(line)), `${code} must prohibit skip/healthy-boolean shortcuts`);
  assert(docs.includes('| `' + code + '`'), `${code} generated documentation row`);
}

const failed = entriesByCode.get(ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED);
const unavailable = entriesByCode.get(ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE);
assert(failed && unavailable, 'both semantic-validation contracts must be registered');
assert.notEqual(failed.trigger, unavailable.trigger, 'the two codes must have distinct triggers');

const expectedDigest = `sha256:${createHash('sha256').update(JSON.stringify(registry)).digest('hex')}`;
assert.equal(ATM_ERROR_CODE_REGISTRY_DIGEST, expectedDigest, 'generated TypeScript registry digest');
assert.deepEqual(ATM_ERROR_CODE_REGISTRY, registry, 'generated TypeScript registry content');
assert.match(docs, new RegExp(expectedDigest), 'generated documentation must expose the canonical registry digest');

const digest = `sha256:${'a'.repeat(64)}`;
const baseCandidate = {
  candidateDigest: digest,
  baseHeadSha: 'abc123',
  sealedSelectionSourceDigest: `sha256:${'b'.repeat(64)}`,
  requiredValidatorIds: ['typecheck', 'focused-test'],
  serializabilityProofPresent: true
} satisfies Omit<PostComposeSemanticCandidate, 'validatorReceipts'>;

const pass = evaluatePostComposeSemanticValidation({
  ...baseCandidate,
  validatorReceipts: [
    commandBacked('typecheck', 'pass', 0),
    commandBacked('focused-test', 'pass', 0)
  ]
});
assert.equal(pass.verdict, 'pass');
assert.equal(pass.code, null);
assert.equal(pass.canonicalWriteAuthorized, true);

const fail = evaluatePostComposeSemanticValidation({
  ...baseCandidate,
  canonicalWriteAttempted: true,
  validatorReceipts: [
    commandBacked('typecheck', 'pass', 0),
    commandBacked('focused-test', 'fail', 1)
  ]
});
assert.equal(fail.verdict, 'failed');
assert.equal(fail.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED);
assert.equal(fail.canonicalWriteAuthorized, false);
assert.ok(fail.reasons.includes('canonical-write-prohibited-after-semantic-gate'));

const unavailableDecision = evaluatePostComposeSemanticValidation({
  ...baseCandidate,
  validatorReceipts: [
    commandBacked('typecheck', 'pass', 0),
    {
      validatorId: 'focused-test',
      outcome: 'unavailable',
      commandBacked: false
    }
  ]
});
assert.equal(unavailableDecision.verdict, 'unavailable');
assert.equal(unavailableDecision.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE);
assert.equal(unavailableDecision.canonicalWriteAuthorized, false);

const malformed = evaluatePostComposeSemanticValidation({
  ...baseCandidate,
  validatorReceipts: [
    {
      validatorId: 'typecheck',
      outcome: 'pass',
      commandBacked: true
      // missing executable/argv/cwd => malformed
    } as any,
    commandBacked('focused-test', 'pass', 0)
  ]
});
assert.equal(malformed.verdict, 'malformed');
assert.equal(malformed.code, ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE);
assert.equal(malformed.canonicalWriteAuthorized, false);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-post-compose-semantic-'));
try {
  const candidatePath = path.join(tmp, 'candidate.json');
  writeFileSync(candidatePath, JSON.stringify({
    ...baseCandidate,
    validatorReceipts: [
      commandBacked('typecheck', 'pass', 0),
      commandBacked('focused-test', 'fail', 2)
    ]
  }, null, 2));
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), 'broker', 'post-compose-semantic-validation', '--candidate-file', candidatePath, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  assert.notEqual(result.status, 0, 'failing candidate must refuse the broker command');
  const payload = JSON.parse(result.stdout || result.stderr || '{}');
  const codes = [
    ...(payload.diagnostics?.errorCodes ?? []),
    payload.messages?.[0]?.code,
    payload.code
  ].filter(Boolean);
  assert.ok(codes.includes(ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED), `expected FAILED code in ${JSON.stringify(codes)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('post-compose-semantic-validation-error-contract.test passed');

function commandBacked(validatorId: string, outcome: 'pass' | 'fail', exitCode: number) {
  return {
    validatorId,
    outcome,
    commandBacked: true,
    executable: 'node',
    argv: ['--strip-types', `tests/${validatorId}.ts`],
    cwd: '.',
    exitCode,
    stdoutDigest: `sha256:${'c'.repeat(64)}`,
    stderrDigest: `sha256:${'d'.repeat(64)}`
  };
}
