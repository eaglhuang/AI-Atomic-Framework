import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED,
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE
} from '../../packages/generated/src/error-codes.ts';
import {
  materializePatchCandidate
} from '../../packages/core/src/broker/patch-candidate-materializer.ts';
import {
  buildPostComposeSemanticCandidateFromMaterialization
} from '../../packages/core/src/broker/post-compose-semantic-validation-policy.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function mutation(
  overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'target' | 'value'>
): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: overrides.actorId ?? 'worker-a',
    taskId: overrides.taskId ?? 'TASK-DEMO',
    filePath: 'registry.json',
    op: 'upsert',
    ...overrides
  };
}

function commandBacked(validatorId: string, outcome: 'pass' | 'fail', exitCode: number) {
  return {
    validatorId,
    outcome,
    commandBacked: true as const,
    executable: 'node',
    argv: ['--strip-types', `tests/${validatorId}.ts`],
    cwd: '.',
    exitCode,
    stdoutDigest: `sha256:${'c'.repeat(64)}`,
    stderrDigest: `sha256:${'d'.repeat(64)}`
  };
}

function runBroker(candidatePath: string, entry: 'source' | 'frozen') {
  const argv =
    entry === 'frozen'
      ? [path.join(root, 'atm.mjs'), 'broker', 'post-compose-semantic-validation', '--candidate-file', candidatePath, '--json']
      : ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), 'broker', 'post-compose-semantic-validation', '--candidate-file', candidatePath, '--json'];
  return spawnSync(process.execPath, argv, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 4 * 1024 * 1024
  });
}

function frozenRunnerSupportsAction(): boolean {
  const help = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'broker', '--help', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  const text = `${help.stdout || ''}\n${help.stderr || ''}`;
  return text.includes('post-compose-semantic-validation');
}

function extractCodes(payload: any): string[] {
  return [
    ...(payload.diagnostics?.errorCodes ?? []),
    payload.messages?.[0]?.code,
    payload.code,
    payload.messages?.[0]?.data?.details?.decision?.code
  ].filter(Boolean);
}

function extractCanonicalWriteCount(payload: any): number {
  return (
    payload.evidence?.canonicalWriteCount ??
    payload.messages?.[0]?.data?.details?.canonicalWriteCount ??
    payload.messages?.[0]?.data?.canonicalWriteCount ??
    0
  );
}

const materialization = materializePatchCandidate({
  baseHeadSha: 'cli-head',
  baseFiles: [{ filePath: 'registry.json', content: '{\n  "records": {}\n}\n' }],
  requests: [
    mutation({ requestId: 'req-a', target: '/records/a', value: { ok: true } }),
    mutation({ requestId: 'req-b', target: '/records/b', value: { ok: true } })
  ],
  cardValidators: ['semantic.cli'],
  adapterStaticChecks: [],
  catalogTargetedTests: []
});

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-post-compose-cli-'));
try {
  const safePath = path.join(tmp, 'safe.json');
  const breakPath = path.join(tmp, 'break.json');
  const unavailablePath = path.join(tmp, 'unavailable.json');

  writeFileSync(
    safePath,
    JSON.stringify(
      buildPostComposeSemanticCandidateFromMaterialization(materialization, [
        commandBacked('semantic.cli', 'pass', 0)
      ]),
      null,
      2
    )
  );
  writeFileSync(
    breakPath,
    JSON.stringify(
      buildPostComposeSemanticCandidateFromMaterialization(materialization, [
        commandBacked('semantic.cli', 'fail', 2)
      ]),
      null,
      2
    )
  );
  writeFileSync(
    unavailablePath,
    JSON.stringify(
      buildPostComposeSemanticCandidateFromMaterialization(materialization, [
        { validatorId: 'semantic.cli', outcome: 'unexecuted', commandBacked: false }
      ]),
      null,
      2
    )
  );

  const entries: Array<'source' | 'frozen'> = ['source'];
  if (frozenRunnerSupportsAction()) entries.push('frozen');

  for (const entry of entries) {
    const safe = runBroker(safePath, entry);
    assert.equal(
      safe.status,
      0,
      `${entry} safe candidate must pass; status=${safe.status}; error=${safe.error}; stderr=${(safe.stderr || '').slice(0, 400)}; stdout=${(safe.stdout || '').slice(0, 400)}`
    );
    const safePayload = JSON.parse(safe.stdout || '{}');
    assert.equal(safePayload.ok, true);
    assert.equal(safePayload.evidence?.decision?.canonicalWriteAuthorized, true);
    assert.equal(extractCanonicalWriteCount(safePayload), 0);

    const broken = runBroker(breakPath, entry);
    assert.notEqual(broken.status, 0, `${entry} semantic-break candidate must refuse`);
    const brokenPayload = JSON.parse(broken.stdout || broken.stderr || '{}');
    const brokenCodes = extractCodes(brokenPayload);
    assert.ok(
      brokenCodes.includes(ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED),
      `${entry} expected FAILED in ${JSON.stringify(brokenCodes)}`
    );
    assert.equal(extractCanonicalWriteCount(brokenPayload), 0);

    const unavailable = runBroker(unavailablePath, entry);
    assert.notEqual(unavailable.status, 0, `${entry} unavailable candidate must refuse`);
    const unavailablePayload = JSON.parse(unavailable.stdout || unavailable.stderr || '{}');
    const unavailableCodes = extractCodes(unavailablePayload);
    assert.ok(
      unavailableCodes.includes(ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE),
      `${entry} expected UNAVAILABLE in ${JSON.stringify(unavailableCodes)}`
    );
    assert.equal(extractCanonicalWriteCount(unavailablePayload), 0);
  }

  if (!frozenRunnerSupportsAction()) {
    console.log('post-compose-semantic-validation.test: frozen runner lacks action; source projection verified (runner-sync required for frozen parity)');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('post-compose-semantic-validation.test passed');
