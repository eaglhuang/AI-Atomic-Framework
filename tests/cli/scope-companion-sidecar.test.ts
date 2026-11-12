import assert from 'node:assert/strict';
import { pathMatchesTaskScope } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';

const cases: readonly [string, string, boolean][] = [
  ['assets/sprites/hero/a.png.meta', 'assets/sprites/hero/**', true],
  ['assets/sprites/hero.meta', 'assets/sprites/hero/**', true],
  ['assets/sprites/hero.meta', 'assets/sprites/hero', true],
  ['assets/sprites/hero.meta', 'assets/sprites/hero/', true],
  ['assets/sprites/a.png.meta', 'assets/sprites/a.png', true],
  ['assets/sprites/a.png', 'assets/sprites/a.png', true],
  ['assets/sprites/other.meta', 'assets/sprites/hero/**', false],
  ['assets/sprites.meta', 'assets/sprites/hero/**', false],
  ['assets/sprites/b.png.meta', 'assets/sprites/a.png', false],
  ['.meta', 'assets/**', false],
  ['assets/sprites/hero.metadata', 'assets/sprites/hero/**', false]
];
for (const [file, scope, expected] of cases) {
  assert.equal(pathMatchesTaskScope(file, scope), expected, `${file} vs ${scope}`);
}
console.log('scope-companion-sidecar: ok');
