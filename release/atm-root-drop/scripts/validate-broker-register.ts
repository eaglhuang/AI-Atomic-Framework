import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createValidator } from './lib/validator-harness.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';

const validator = createValidator('broker-register');
const { assert, readJson, ok } = validator;

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-register-'));

try {
  mkdirSync(path.join(tempRoot, '.atm', 'runtime'), { recursive: true });

  const packageJson = readJson<any>('package.json');
  assert(
    packageJson.scripts?.['validate:broker-register'] === 'node --strip-types scripts/validate-broker-register.ts --mode validate',
    'package.json must expose validate:broker-register'
  );

  const validatorsConfig = readJson<any>('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: any) => entry.name === 'validate-broker-register');
  assert(Boolean(validatorDef), 'validators.config.json must register validate-broker-register');
  assert(validatorDef?.entry === 'scripts/validate-broker-register.ts', 'validate-broker-register entry path mismatch');
  assert(validatorDef?.slow === false, 'validate-broker-register should be a fast validator');
  assert(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-register') === true,
    'standard profile must include validate-broker-register'
  );

  const mismatchedIntentPath = path.join(tempRoot, 'mismatched.intent.json');
  writeFileSync(mismatchedIntentPath, `${JSON.stringify({
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'validator fixture' },
    taskId: 'TASK-PAYLOAD-A',
    actorId: 'payload-actor-a',
    baseCommit: 'abc123',
    targetFiles: ['src/example.ts'],
    atomRefs: [{ atomId: 'ATM-BROKER-A', atomCid: 'CID-BROKER-A', operation: 'modify' }],
    sharedSurfaces: {
      files: ['src/example.ts'],
      atomIds: ['ATM-BROKER-A'],
      atomCids: ['CID-BROKER-A'],
      atomRanges: [],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'direct-brokered'
  }, null, 2)}\n`, 'utf8');

  const mismatched = await runBrokerJson([
    'register',
    '--cwd',
    tempRoot,
    '--task',
    'TASK-CLI-B',
    '--actor',
    'cli-actor-b',
    '--intent-file',
    mismatchedIntentPath
  ]);
  assert(mismatched.exitCode === 1, 'broker register must fail closed when CLI task/actor mismatch payload');
  assert(mismatched.parsed.ok === false, 'mismatched broker register must report ok=false');
  assert(
    mismatched.parsed.messages?.some((entry: any) => entry.code === 'ATM_BROKER_REGISTER_PAYLOAD_FLAG_MISMATCH') === true,
    'mismatched broker register must report ATM_BROKER_REGISTER_PAYLOAD_FLAG_MISMATCH'
  );
  const mismatchDetails = mismatched.parsed.messages?.find((entry: any) => entry.code === 'ATM_BROKER_REGISTER_PAYLOAD_FLAG_MISMATCH')?.data?.mismatches
    ?? mismatched.parsed.evidence?.mismatches
    ?? [];
  assert(Array.isArray(mismatchDetails) && mismatchDetails.length === 2, 'mismatched broker register must surface both taskId and actorId mismatches');

  const registryPath = path.join(tempRoot, '.atm', 'runtime', 'write-broker.registry.json');
  if (readableFileExists(registryPath)) {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert((registry.activeIntents ?? []).length === 0, 'mismatched broker register must not mutate the registry');
  }

  const matchingIntentPath = path.join(tempRoot, 'matching.intent.json');
  writeFileSync(matchingIntentPath, `${JSON.stringify({
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'validator fixture' },
    taskId: 'TASK-CLI-C',
    actorId: 'cli-actor-c',
    baseCommit: 'def456',
    targetFiles: ['src/example.ts'],
    atomRefs: [{ atomId: 'ATM-BROKER-C', atomCid: 'CID-BROKER-C', operation: 'modify' }],
    sharedSurfaces: {
      files: ['src/example.ts'],
      atomIds: ['ATM-BROKER-C'],
      atomCids: ['CID-BROKER-C'],
      atomRanges: [],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'direct-brokered'
  }, null, 2)}\n`, 'utf8');

  const matching = await runBrokerJson([
    'register',
    '--cwd',
    tempRoot,
    '--task',
    'TASK-CLI-C',
    '--actor',
    'cli-actor-c',
    '--intent-file',
    matchingIntentPath
  ]);
  assert(matching.exitCode === 0, 'matching broker register must succeed');
  assert(matching.parsed.ok === true, 'matching broker register must report ok=true');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert((registry.activeIntents ?? []).length === 1, 'matching broker register must persist one active intent');
  assert(registry.activeIntents[0]?.taskId === 'TASK-CLI-C', 'matching broker register must preserve payload taskId');
  assert(registry.activeIntents[0]?.actorId === 'cli-actor-c', 'matching broker register must preserve payload actorId');

  ok('broker register payload/flag parity fails closed before registry mutation');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function readableFileExists(filePath: string): boolean {
  try {
    readFileSync(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function runBrokerJson(args: string[]) {
  try {
    const parsed = await runBroker(args);
    return {
      exitCode: 0,
      parsed
    };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      parsed: {
        ok: false,
        messages: [
          {
            code: error?.code ?? 'ATM_UNKNOWN_ERROR',
            data: error?.details ?? {}
          }
        ],
        evidence: error?.details ?? {}
      }
    };
  }
}
