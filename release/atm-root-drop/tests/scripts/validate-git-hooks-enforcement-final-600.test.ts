import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkedFiles = [
  'scripts/validate-git-hooks-enforcement.ts',
  'scripts/validate-git-hooks-enforcement/context.ts',
  'scripts/validate-git-hooks-enforcement/initial-lanes.ts',
  'scripts/validate-git-hooks-enforcement/pre-push-regressions.ts',
  'scripts/validate-git-hooks-enforcement/closure-cross-checks.ts',
  'scripts/validate-git-hooks-enforcement/root-emergency-audit.ts',
  'scripts/validate-git-hooks-enforcement/main.ts'
];

for (const file of checkedFiles) {
  const lineCount = readFileSync(path.join(root, file), 'utf8').trimEnd().split(/\r?\n/).length;
  if (lineCount > 600) {
    throw new Error(`${file} must stay below 600 lines, got ${lineCount}`);
  }
}

const facade = readFileSync(path.join(root, 'scripts/validate-git-hooks-enforcement.ts'), 'utf8');
if (!facade.includes("import './validate-git-hooks-enforcement/main.ts';")) {
  throw new Error('validate-git-hooks-enforcement facade must delegate to the extracted main module');
}

const ownerShard = readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json'),
  'utf8'
);
for (const requiredPattern of [
  '"path_pattern": "scripts/validate-git-hooks-enforcement.ts"',
  '"path_pattern": "scripts/validate-git-hooks-enforcement/**/*.ts"'
]) {
  if (!ownerShard.includes(requiredPattern)) {
    throw new Error(`owner shard must register ${requiredPattern}`);
  }
}

console.log('[validate-git-hooks-enforcement-final-600] ok');
