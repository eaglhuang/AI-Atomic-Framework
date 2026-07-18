import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { strict as assert } from 'node:assert';

const lineCount = (filePath: string) => readFileSync(filePath, 'utf8').split(/\r?\n/).length;

function listTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

const validatorFiles = [
  'scripts/validate-prompt-scoped-next.ts',
  ...listTypeScriptFiles('scripts/validate-prompt-scoped-next')
];

for (const filePath of validatorFiles) {
  assert(lineCount(filePath) <= 600, `${filePath} must stay at or below 600 physical lines`);
}

const facade = readFileSync('scripts/validate-prompt-scoped-next.ts', 'utf8');
assert.match(facade, /validate-prompt-scoped-next\/main\.ts/, 'validator facade must delegate to the bounded module tree');

const ownerShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json', 'utf8')) as {
  mappings: Array<{ path_pattern: string; atom_id: string; source_task?: string }>;
};

for (const pathPattern of [
  'scripts/validate-prompt-scoped-next.ts',
  'scripts/validate-prompt-scoped-next/**/*.ts'
]) {
  assert(
    ownerShard.mappings.some((entry) =>
      entry.path_pattern === pathPattern
      && entry.atom_id === 'atm.next-router-map'
      && entry.source_task === 'TASK-RFT-0062'
    ),
    `${pathPattern} must be mapped to atm.next-router-map for TASK-RFT-0062`
  );
}

console.log('validate-prompt-scoped-next final-600 guard passed');
