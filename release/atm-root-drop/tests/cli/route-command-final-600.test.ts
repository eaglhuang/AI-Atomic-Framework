import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const routeDir = path.join(root, 'packages/cli/src/commands/route');
const checkedFiles = [
  'packages/cli/src/commands/route.ts',
  ...readdirSync(routeDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `packages/cli/src/commands/route/${entry}`)
];

for (const file of checkedFiles) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const lineCount = text.trimEnd().split(/\r?\n/).length;
  assert.ok(lineCount < 600, `${file} must stay below 600 lines, got ${lineCount}`);
}

const facade = readFileSync(path.join(root, 'packages/cli/src/commands/route.ts'), 'utf8');
assert.ok(
  facade.includes("export { runRoute } from './route/main.ts';"),
  'route facade must preserve the runRoute export from the extracted main module'
);

const ownerShard = readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
);
for (const pattern of [
  '"path_pattern": "packages/cli/src/commands/route.ts"',
  '"path_pattern": "packages/cli/src/commands/route/**/*.ts"'
]) {
  assert.ok(ownerShard.includes(pattern), `owner shard must register ${pattern}`);
}

console.log('[route-command-final-600:cli-test] ok');
