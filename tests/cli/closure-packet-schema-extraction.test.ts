import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'packages/cli/src/commands/framework-development/closure-packet-schema.ts',
  'packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts',
  'packages/cli/src/commands/framework-development/closure-packet/schema-fragments.ts',
  'packages/cli/src/commands/framework-development/closure-packet/diagnostics.ts',
  'packages/cli/src/commands/framework-development/closure-packet/validator-contract.ts'
];

for (const file of files) {
  const absolute = path.join(root, file);
  assert.equal(existsSync(absolute), true, `${file} should exist`);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/).filter((line) => line.length > 0).length;
  assert.ok(lines <= 600, `${file} should stay at or below 600 non-empty lines; got ${lines}`);
}

const facade = readFileSync(path.join(root, 'packages/cli/src/commands/framework-development/closure-packet-schema.ts'), 'utf8');
assert.match(facade, /from '\.\/closure-packet-schema\/implementation\.ts'/);

const implementation = await import('../../packages/cli/src/commands/framework-development/closure-packet-schema.ts') as Record<string, unknown>;
for (const exportName of [
  'validateClosurePacket',
  'createClosurePacket',
  'writeClosurePacket',
  'repairClosurePacketForTask',
  'requiredValidationPassesForClosure',
  'normalizeSha256DigestValue'
]) {
  assert.equal(typeof implementation[exportName], 'function', `${exportName} should remain exported from the facade`);
}

const validateClosurePacket = implementation.validateClosurePacket as (value: unknown) => { ok: boolean; missing: readonly string[]; invalidFormat: readonly { path: string }[] };
const digest = `sha256:${'a'.repeat(64)}`;
const packet = {
  schemaId: 'atm.closurePacket.v1',
  specVersion: '0.1.0',
  taskId: 'TASK-RFT-0034',
  targetRepoIdentity: { isFrameworkRepo: true, score: 5, root: '/repo', name: 'ai-atomic-framework', signals: ['package-name:ai-atomic-framework'] },
  targetCommit: 'abc123',
  governedTreeSha: 'tree123',
  targetCommitDelta: { currentCommitSha: 'abc123', parentCommitShas: ['parent123'], governedTreeSha: 'tree123', changedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts'] },
  closedByCommand: 'atm tasks close',
  commandRuns: [{ command: 'npm run typecheck', cwd: '.', exitCode: 0, stdoutSha256: digest, stderrSha256: digest, runnerVersion: 'test' }],
  validationPasses: ['typecheck', 'validate:cli'],
  evidenceFreshness: 'fresh',
  requiredGates: ['typecheck', 'validate:cli'],
  requiredGatesSnapshot: {
    schemaId: 'atm.requiredGatesSnapshot.v1',
    generatedAt: '2026-07-15T00:00:00.000Z',
    source: 'frameworkStatus.requiredGates',
    ruleVersion: '0.1.0',
    frameworkMode: 'required',
    repoRole: 'framework',
    changedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts'],
    criticalChangedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts'],
    requiredGates: ['typecheck', 'validate:cli']
  },
  evidencePath: '.atm/history/evidence/TASK-RFT-0034.json',
  closedAt: '2026-07-15T00:00:00.000Z',
  closedByActor: 'codex-task-rft-0034',
  sessionId: null
};

assert.equal(validateClosurePacket(packet).ok, true);
const invalid = validateClosurePacket({ ...packet, commandRuns: [{ ...packet.commandRuns[0], stdoutSha256: 'sha256:not-valid' }] });
assert.equal(invalid.ok, false);
assert.equal(invalid.invalidFormat[0]?.path, 'commandRuns/0/stdoutSha256');

const atomMap = JSON.parse(readFileSync(path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'), 'utf8'));
const mappings = Array.isArray(atomMap.mappings) ? atomMap.mappings : [];
const mappedPaths = new Set(mappings.map((entry: { path_pattern?: unknown }) => String(entry.path_pattern ?? '')));
assert.ok(mappedPaths.has('packages/cli/src/commands/framework-development/closure-packet-schema.ts'), 'closure-packet schema facade should be mapped in owner-shard-cli');
assert.ok(mappedPaths.has('packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts'), 'closure-packet schema implementation should be mapped in owner-shard-cli');
