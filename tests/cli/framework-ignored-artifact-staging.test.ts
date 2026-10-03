import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoStageFrameworkClaimFiles } from '../../packages/cli/src/commands/git-governance/implementation/task-scope-staging.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-ignored-framework-stage-'));
const git = (...args: string[]) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
});
const write = (relative: string, content: string) => {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
};
try {
  git('init', '-q');
  git('config', 'user.name', 'ATM fixture');
  git('config', 'user.email', 'atm@example.invalid');
  write('.gitignore', 'release/\n');
  write('release/atm-root-drop/release-manifest.json', JSON.stringify({
    generatedFiles: ['release/atm-root-drop/packages/integrations-core/dist/manifest/safe-install.js']
  }));
  git('add', '-f', '--', '.gitignore', 'release/atm-root-drop/release-manifest.json');
  git('commit', '-qm', 'fixture baseline');

  const declared = 'release/atm-root-drop/packages/integrations-core/dist/manifest/safe-install.js';
  const sibling = 'release/atm-root-drop/packages/integrations-core/dist/manifest/unlisted.js';
  write(declared, 'export const expected = true;\n');
  write(sibling, 'export const unexpected = true;\n');

  const directoryClaim = autoStageFrameworkClaimFiles(root, 'atm-stage-test', false, ['release/atm-root-drop/']);
  assert.ok(directoryClaim.includes(declared), 'a manifest-declared ignored runtime artifact must be discovered');
  assert.ok(!directoryClaim.includes(sibling), 'an ignored artifact absent from the manifest must remain excluded');

  const exactClaim = autoStageFrameworkClaimFiles(root, 'atm-stage-test', false, [sibling]);
  assert.deepEqual(exactClaim, [sibling], 'an exact ignored path claim remains an explicit authorization');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('[framework-ignored-artifact-staging] ok');
