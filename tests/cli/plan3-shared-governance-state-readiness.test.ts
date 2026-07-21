import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const protectedPolicy = path.join(root, 'packages/cli/src/commands/git-governance/protected-governance-state.ts');
const closeReconcile = path.join(root, 'packages/cli/src/commands/taskflow/close-side-effect-reconcile.ts');
const gitGovernance = readFileSync(path.join(root, 'packages/cli/src/commands/git-governance/implementation.ts'), 'utf8');
const closeContract = readFileSync(closeReconcile, 'utf8');

assert.equal(existsSync(protectedPolicy), true, 'protected governance state policy atom must exist');
assert.equal(existsSync(closeReconcile), true, 'close side-effect reconcile contract must exist');
assert.match(gitGovernance, /inspectProtectedGovernanceStateDestructiveChanges/, 'git governance must call the protected-state policy');
assert.match(gitGovernance, /ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE/, 'git governance must expose canonical protected-state error code');
assert.match(closeContract, /ATM_PLANNING_SOURCE_IDENTITY_DRIFT/, 'close reconcile contract must classify planning source identity drift');
assert.match(closeContract, /replayAllowed:\s*false/, 'post-side-effect reconciliation must be no-replay by contract');
assert.match(closeContract, /tasks status --task/, 'recovery must route to status/reconcile, not replay commit or close');

console.log('[plan3-shared-governance-state-readiness] ok');
