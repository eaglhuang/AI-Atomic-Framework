import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isReparsePointOrSymlink,
  removeTreeWithoutFollowingLinks
} from '../../scripts/run-sealed-runner-build.ts';

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-junction-'));
const hostRoot = path.join(fixtureRoot, 'host-repo');
const worktreeRoot = path.join(fixtureRoot, 'sealed-worktree');
const hostNodeModules = path.join(hostRoot, 'node_modules');
const worktreeNodeModules = path.join(worktreeRoot, 'node_modules');
const markerRel = path.join('pkg', 'MARKER.txt');
const markerPath = path.join(hostNodeModules, markerRel);

mkdirSync(path.join(hostNodeModules, 'pkg'), { recursive: true });
mkdirSync(worktreeRoot, { recursive: true });
writeFileSync(markerPath, 'host-node-modules-must-survive\n', 'utf8');
writeFileSync(path.join(worktreeRoot, 'scratch.txt'), 'worktree-local\n', 'utf8');

symlinkSync(
  hostNodeModules,
  worktreeNodeModules,
  process.platform === 'win32' ? 'junction' : 'dir'
);

assert.equal(isReparsePointOrSymlink(worktreeNodeModules), true, 'worktree node_modules must be a reparse/symlink');
assert.equal(
  readFileSync(path.join(worktreeNodeModules, markerRel), 'utf8').trim(),
  'host-node-modules-must-survive',
  'junction must resolve into host node_modules before cleanup'
);

removeTreeWithoutFollowingLinks(worktreeRoot);

assert.equal(existsSync(worktreeRoot), false, 'worktree root must be removed');
assert.equal(existsSync(markerPath), true, 'host node_modules marker must survive junction-aware cleanup');
assert.equal(
  readFileSync(markerPath, 'utf8').trim(),
  'host-node-modules-must-survive',
  'host node_modules contents must remain intact'
);
assert.equal(existsSync(hostNodeModules), true, 'host node_modules directory must remain');

// Regular (non-link) trees must still be fully removable.
const plainTree = path.join(fixtureRoot, 'plain-tree');
mkdirSync(path.join(plainTree, 'nested'), { recursive: true });
writeFileSync(path.join(plainTree, 'nested', 'file.txt'), 'gone\n', 'utf8');
removeTreeWithoutFollowingLinks(plainTree);
assert.equal(existsSync(plainTree), false, 'plain directory trees must still be removed');

console.log(JSON.stringify({
  ok: true,
  case: 'sealed-runner-build-junction-cleanup',
  platform: process.platform,
  hostMarkerSurvived: true,
  plainTreeRemoved: true
}, null, 2));
