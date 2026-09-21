import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCursorSourceFiles } from '../../packages/integration-cursor/src/index.ts';
import { createCopilotSourceFiles } from '../../packages/integration-copilot/src/index.ts';
import { createGeminiSourceFiles } from '../../packages/integration-gemini/src/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const compilerSource = readFileSync(
  path.join(repoRoot, 'packages/integrations-core/src/compiler/compile.ts'),
  'utf8'
);

// Import-time compiler code must not shell out to Git. Generation remains
// deterministic from the bundled template tree and is exercised below.
assert.doesNotMatch(compilerSource, /spawnSync\s*\(\s*['"]git['"]/);
for (const files of [
  createCursorSourceFiles(repoRoot),
  createCopilotSourceFiles(repoRoot),
  createGeminiSourceFiles(repoRoot)
]) {
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => file.source === 'template'));
  assert.ok(files.every((file) => file.content.length > 0));
}

console.log('agent-pack-startup-side-effects ok');
