import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  registerIntent,
  saveRegistry,
  type WriteBrokerRegistryDocument,
  type WriteIntent
} from '../../packages/core/src/broker/index.ts';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
export const retainArtifactsDir = process.argv.includes('--retain-artifacts-dir')
  ? process.argv[process.argv.indexOf('--retain-artifacts-dir') + 1]
  : null;

export function check(condition: unknown, message: string) {
  assert.ok(condition, `[team-brokered-write:${mode}] ${message}`);
}

export function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

export const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const writeTransactionSchema = readJson('schemas/team-agents/team-broker-write-transaction.schema.json');
const brokerLaneSchema = readJson('schemas/team-agents/team-broker-lane.schema.json');
const brokerOperationRunRecordSchema = readJson('schemas/broker/operation-run-record.schema.json');
ajv.addSchema(writeTransactionSchema);
ajv.addSchema(brokerLaneSchema);
export const validateWriteTransaction = ajv.compile(writeTransactionSchema);
export const validateBrokerOperationRunRecord = ajv.compile(brokerOperationRunRecordSchema);
export const validateRuntimeActivation = ajv.compile(readJson('schemas/team-agents/team-broker-runtime-activation.schema.json'));
const maybeValidateBrokerLane = ajv.getSchema('https://schemas.ai-atomic-framework.dev/team-agents/team-broker-lane.schema.json');
check(maybeValidateBrokerLane, 'team broker lane schema must be registered for validator');
export const validateBrokerLane = maybeValidateBrokerLane!;

export function formatAjvErrors(errors: typeof validateWriteTransaction.errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

export function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function resolveRetainArtifactsDir(): string | null {
  if (!retainArtifactsDir || retainArtifactsDir.startsWith('--')) {
    return null;
  }
  return path.resolve(root, retainArtifactsDir);
}

export async function runAtm(args: string[], cwd = root) {
  const normalizedArgs = args.filter((arg) => arg !== 'broker' && arg !== '--json');
  try {
    const parsed = await runBroker([...normalizedArgs, '--cwd', cwd]);
    return { exitCode: 0, parsed };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      parsed: { ok: false, evidence: error?.details ?? {} }
    };
  }
}

export function commitText(cwd: string, message: string) {
  const add = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8' });
  check(add.status === 0, `git add failed: ${add.stderr || add.stdout}`);
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=ATM', '-c', 'user.email=atm@example.com', 'commit', '-m', message], {
    encoding: 'utf8'
  });
  check(result.status === 0, `git commit failed: ${result.stderr || result.stdout}`);
  const sha = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(sha.status === 0, `git rev-parse HEAD failed: ${sha.stderr || sha.stdout}`);
  return String(sha.stdout ?? '').trim();
}

export function readCurrentBranch(cwd: string) {
  const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
  check(result.status === 0, `git symbolic-ref failed: ${result.stderr || result.stdout}`);
  return String(result.stdout ?? '').trim();
}

export function ensureRequiredFiles() {
  for (const relativePath of [
    'package.json',
    'scripts/validators.config.json',
    'packages/core/src/broker/team-lane.ts',
    'packages/core/src/broker/index.ts',
    'packages/cli/src/commands/team.ts',
    'packages/cli/src/commands/command-specs/team.spec.ts'
  ]) {
    check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
  }
}

export function ensureConfigWiring() {
  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['validate:team-brokered-write'] === 'node --strip-types scripts/validate-team-brokered-write.ts --mode validate',
    'package.json must expose validate:team-brokered-write'
  );

  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: { name?: string }) => entry.name === 'validate-team-brokered-write');
  check(Boolean(validatorDef), 'validators.config.json must register validate-team-brokered-write');
  check(validatorDef?.entry === 'scripts/validate-team-brokered-write.ts', 'validate-team-brokered-write entry path mismatch');
  check(validatorDef?.slow === false, 'validate-team-brokered-write should be a fast validator');
  check(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-team-brokered-write') === true,
    'standard profile must include validate-team-brokered-write'
  );
}

export function writeTaskCard(cwd: string, taskId: string, scopePaths: string[], atomId: string, extras: Record<string, unknown> = {}) {
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeJson(path.join(taskDir, `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: `Team broker fixture ${taskId}`,
    status: 'planned',
    scopePaths,
    deliverables: scopePaths,
    atomizationImpact: {
      ownerAtomOrMap: atomId
    },
    ...extras
  });
}

export function seedRegistry(cwd: string, intent: WriteIntent) {
  const registryPath = path.join(cwd, '.atm', 'runtime', 'write-broker.registry.json');
  const emptyRegistry: WriteBrokerRegistryDocument = {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'team-broker-fixture',
    workspaceId: 'main',
    activeIntents: []
  };
  const registry = registerIntent(emptyRegistry, intent, 'direct-brokered');
  saveRegistry(registryPath, registry);
  return registryPath;
}

export function writeIntentFile(cwd: string, filename: string, intent: WriteIntent) {
  const filePath = path.join(cwd, filename);
  writeJson(filePath, intent);
  return filePath;
}

export function writeProposalFile(cwd: string, filename: string, proposal: Record<string, unknown>) {
  const filePath = path.join(cwd, filename);
  writeJson(filePath, proposal);
  return filePath;
}

