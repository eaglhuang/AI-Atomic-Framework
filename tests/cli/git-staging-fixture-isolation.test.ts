import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const fixtureUrl = new URL('./git-commit-task-scoped-staging/fixture.ts', import.meta.url).href;
const probe = `
  const {tempDir, root, removeFixtureRepository} = await import(${JSON.stringify(fixtureUrl)});
  const {existsSync} = await import('node:fs');
  const path = await import('node:path');
  const fixed = path.resolve(root, '.atm-temp-test-git-commit-task-scoped-staging');
  const owned = tempDir !== fixed && path.dirname(tempDir) === root
    && path.basename(tempDir).startsWith('.atm-temp-test-git-commit-task-scoped-staging-');
  const allocated = existsSync(tempDir);
  if (owned) removeFixtureRepository();
  console.log(JSON.stringify({pid:process.pid,tempDir,owned,allocated,removed:owned && !existsSync(tempDir)}));
`;
const samples = [1, 2].map(() => {
  const result = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-'], {
    input: probe, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
});
assert.notEqual(samples[0].pid, samples[1].pid);
assert.notEqual(samples[0].tempDir, samples[1].tempDir, 'independent processes must never share a cleanup target');
for (const sample of samples) {
  assert.equal(sample.owned, true);
  assert.equal(sample.allocated, true);
  assert.equal(sample.removed, true, 'cleanup removes only the allocated fixture');
}
console.log('[git-staging-fixture-isolation] ok');
