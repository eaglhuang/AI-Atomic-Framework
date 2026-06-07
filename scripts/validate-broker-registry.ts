import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateBrokerDecision,
  loadRegistry,
  saveRegistry,
  registerIntent,
  releaseTask,
  cleanupStale
} from '../packages/core/src/index.ts';
import type {
  WriteIntent,
  WriteBrokerRegistryDocument
} from '../packages/core/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string) {
  console.error(`[broker-registry:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

// 測試 1: calculateBrokerDecision 決策邏輯
console.log(`[broker-registry:${mode}] Running decision logic unit tests...`);

const emptyRegistry: WriteBrokerRegistryDocument = {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'test-repo',
  workspaceId: 'test-ws',
  activeIntents: []
};

const baseIntent: WriteIntent = {
  schemaId: 'atm.writeIntent.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'test' },
  taskId: 'TASK-A',
  actorId: 'actor-1',
  baseCommit: 'commit-1',
  targetFiles: ['src/file-a.ts'],
  atomRefs: [
    { atomId: 'atom-1', atomCid: 'cid-1', operation: 'modify' }
  ],
  sharedSurfaces: {
    generators: [],
    projections: [],
    registries: [],
    validators: [],
    artifacts: []
  },
  requestedLane: 'auto'
};

// 1.1 Parallel safe (無任何衝突)
const dec1 = calculateBrokerDecision(baseIntent, emptyRegistry);
check(dec1.verdict === 'parallel-safe', `Expected verdict 'parallel-safe', got '${dec1.verdict}'`);
check(dec1.lane === 'direct-brokered', `Expected lane 'direct-brokered', got '${dec1.lane}'`);

// 模擬已存在 active intents 的 registry
const populatedRegistry: WriteBrokerRegistryDocument = {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'test-repo',
  workspaceId: 'test-ws',
  activeIntents: [
    {
      intentId: 'intent-existing-1',
      taskId: 'TASK-B',
      teamRunId: null,
      actorId: 'actor-2',
      baseCommit: 'commit-0',
      resourceKeys: {
        files: ['src/file-b.ts'],
        atomIds: ['atom-existing-1'],
        atomCids: ['cid-existing-1'],
        generators: ['gen-1'],
        projections: ['proj-1'],
        registries: ['reg-1'],
        validators: ['val-1'],
        artifacts: ['art-1']
      },
      leaseEpoch: Date.now(),
      lane: 'direct-brokered'
    }
  ]
};

// 1.2 CID 衝突
const intentCidConflict: WriteIntent = {
  ...baseIntent,
  taskId: 'TASK-C',
  atomRefs: [
    { atomId: 'atom-existing-1', atomCid: 'cid-new', operation: 'modify' }
  ]
};
const decCid = calculateBrokerDecision(intentCidConflict, populatedRegistry);
check(decCid.verdict === 'blocked-cid-conflict', `Expected verdict 'blocked-cid-conflict', got '${decCid.verdict}'`);
check(decCid.lane === 'blocked', `Expected lane 'blocked', got '${decCid.lane}'`);

// 1.3 Shared Surface 衝突 (以 generator 為例)
const intentGenConflict: WriteIntent = {
  ...baseIntent,
  taskId: 'TASK-C',
  sharedSurfaces: {
    generators: ['gen-1'],
    projections: [],
    registries: [],
    validators: [],
    artifacts: []
  }
};
const decGen = calculateBrokerDecision(intentGenConflict, populatedRegistry);
check(decGen.verdict === 'blocked-shared-surface', `Expected verdict 'blocked-shared-surface', got '${decGen.verdict}'`);
check(decGen.lane === 'blocked', `Expected lane 'blocked', got '${decGen.lane}'`);

// 1.4 Physical File Overlap (同 targetFile，但 CID disjoint)
const intentFileOverlap: WriteIntent = {
  ...baseIntent,
  taskId: 'TASK-C',
  targetFiles: ['src/file-b.ts'],
  atomRefs: [
    { atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify' }
  ]
};
const decOverlap = calculateBrokerDecision(intentFileOverlap, populatedRegistry);
check(decOverlap.verdict === 'needs-physical-split', `Expected verdict 'needs-physical-split', got '${decOverlap.verdict}'`);
check(decOverlap.lane === 'deterministic-composer', `Expected lane 'deterministic-composer', got '${decOverlap.lane}'`);

// 測試 2: Registry 讀寫、註冊、釋放、清理
console.log(`[broker-registry:${mode}] Running registry functional tests...`);

const testRegistryPath = path.join(root, '.atm', 'runtime', 'test-broker-registry-temp.json');
if (existsSync(testRegistryPath)) {
  unlinkSync(testRegistryPath);
}

// 2.1 Load empty (non-existent file)
let regDoc = loadRegistry(testRegistryPath);
check(regDoc.activeIntents.length === 0, 'Loaded registry should be empty');

// 2.2 Register intent
regDoc = registerIntent(regDoc, baseIntent, 'direct-brokered');
check(regDoc.activeIntents.length === 1, 'Should have 1 active intent after registration');
check(regDoc.activeIntents[0].taskId === 'TASK-A', 'Active intent task ID should match');

// 2.3 Save & reload
saveRegistry(testRegistryPath, regDoc);
check(existsSync(testRegistryPath), 'Registry file should exist on disk after save');
let reloadedDoc = loadRegistry(testRegistryPath);
check(reloadedDoc.activeIntents.length === 1, 'Reloaded registry should match saved state');

// 2.4 Cleanup stale (stale expired, normal active preserved)
const docWithStale: WriteBrokerRegistryDocument = {
  ...reloadedDoc,
  activeIntents: [
    ...reloadedDoc.activeIntents,
    {
      intentId: 'intent-stale-1',
      taskId: 'TASK-STALE',
      teamRunId: null,
      actorId: 'actor-stale',
      baseCommit: 'commit-stale',
      resourceKeys: {
        files: [],
        atomIds: [],
        atomCids: [],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      leaseEpoch: Date.now() - 500000,
      lane: 'direct-brokered',
      expiresAt: new Date(Date.now() - 1000).toISOString() // 已過期
    }
  ]
};
const cleanedDoc = cleanupStale(docWithStale);
check(cleanedDoc.activeIntents.length === 1, 'Stale intent should be cleaned up');
check(cleanedDoc.activeIntents[0].taskId === 'TASK-A', 'Normal active intent should be preserved');

// 2.5 Release task
const releasedDoc = releaseTask(cleanedDoc, 'TASK-A');
check(releasedDoc.activeIntents.length === 0, 'Registry should be empty after releasing TASK-A');

// Cleanup temp test file
if (existsSync(testRegistryPath)) {
  unlinkSync(testRegistryPath);
}

// 自我檢查：package.json 與 validators.config.json 的設定正確性
console.log(`[broker-registry:${mode}] Running configuration self-check...`);

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: string): any {
  return JSON.parse(readText(relativePath));
}

const packageJson = readJson('package.json');
check(
  packageJson.scripts?.['validate:broker-registry'] === 'node --strip-types scripts/validate-broker-registry.ts --mode validate',
  'package.json must expose validate:broker-registry'
);

const validatorsConfig = readJson('scripts/validators.config.json');
const validatorDef = validatorsConfig.validators?.find((v: any) => v.name === 'validate-broker-registry');
check(Boolean(validatorDef), 'validators.config.json must register validate-broker-registry');
check(validatorDef?.entry === 'scripts/validate-broker-registry.ts', 'validate-broker-registry entry path mismatch');
check(validatorDef?.slow === false, 'validate-broker-registry should be a fast validator');

check(
  validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-registry') === true,
  'standard profile must include validate-broker-registry'
);

if (!process.exitCode) {
  console.log(`[broker-registry:${mode}] ok`);
}
