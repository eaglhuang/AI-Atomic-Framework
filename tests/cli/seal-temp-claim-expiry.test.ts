import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCommitAttempt } from '../../packages/cli/src/commands/git-governance/implementation/commit-attempt-boundary.ts';
import { hasLiveFrameworkTempClaimAttribution } from '../../packages/cli/src/commands/hook/pre-commit/framework-temp-claim-attribution.ts';

delete process.env.ATM_LANE_SESSION_ID;
const actorId = 'cursor-agent';
const taskId = `ATM-FRAMEWORK-TEMP-${actorId}`;
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-seal-claim-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const kit = 'research/paper-v2/prereg-v3-kits/example/README.md';
git('init', '-q');
git('config', 'user.name', 'Seal Test');
git('config', 'user.email', 'seal@example.invalid');
mkdirSync(path.dirname(path.join(root, kit)), { recursive: true });
writeFileSync(path.join(root, kit), 'generation\n');
git('add', kit);
git('commit', '-qm', 'base');
writeFileSync(path.join(root, kit), 'sealed generation\n');
git('add', kit);
const lockPath = path.join(root, '.atm/runtime/locks', `${taskId}.lock.json`);
mkdirSync(path.dirname(lockPath), { recursive: true });
const original = { workItemId: taskId, actorId, lockedBy: actorId, leaseId: 'lease-seal', heartbeatAt: new Date().toISOString(), ttlSeconds: 1, files: [kit], laneSessionId: null };
writeFileSync(lockPath, `${JSON.stringify(original)}\n`);
const attribution = fileURLToPath(new URL('../../packages/cli/src/commands/hook/pre-commit/framework-temp-claim-attribution.ts', import.meta.url));
const hook = path.join(root, '.git/hooks/pre-commit');
writeFileSync(hook, `#!/bin/bash\nset -euo pipefail\nsleep 1.2\nnode --strip-types --input-type=module -e 'import { hasLiveFrameworkTempClaimAttribution } from ${JSON.stringify(attribution)}; if (!hasLiveFrameworkTempClaimAttribution({ cwd: process.cwd(), actorId: process.env.ATM_COMMIT_ACTOR_ID, taskId: process.env.ATM_COMMIT_TASK_ID })) { console.error("temporary claim expired during seal commit"); process.exit(2); }'\ntouch .seal-hook-ran\n`);
chmodSync(hook, 0o755);
const before = git('rev-parse', 'HEAD').trim();
const attempt = (message: string) => executeCommitAttempt({
  options: { cwd: root, taskId }, actorId, args: ['commit', '--message', message],
  commitEnv: { GIT_AUTHOR_NAME: 'Seal Test', GIT_AUTHOR_EMAIL: 'seal@example.invalid', GIT_COMMITTER_NAME: 'Seal Test', GIT_COMMITTER_EMAIL: 'seal@example.invalid', ATM_COMMIT_ACTOR_ID: actorId, ATM_COMMIT_TASK_ID: taskId },
  commitTimeoutMs: 30_000, hookBypassRequest: null, protectedOverrideAudit: null,
  commitAttemptStatusPath: '.atm/runtime/git-commit-attempts/seal.json', commitAttemptStartedAt: new Date().toISOString(),
  session: null, laneSessionId: null, headShaBeforeCommit: before, statusCommand: 'status', retryCommand: 'retry',
  rawCopyableCommitCommand: 'commit', taskScopedBundleReport: null, scopedCommitFiles: [kit], stagedCommitSurface: [kit],
});
attempt('seal kit generation');
const renewed = JSON.parse(readFileSync(lockPath, 'utf8'));
assert.notEqual(git('rev-parse', 'HEAD').trim(), before);
assert.equal(renewed.leaseId, original.leaseId);
assert.equal(renewed.ttlSeconds, 14400);
assert.deepEqual(renewed.files, original.files);
assert.equal(hasLiveFrameworkTempClaimAttribution({ cwd: root, actorId, taskId, now: Date.parse(original.heartbeatAt) + 2_000 }), true);
assert.equal(readFileSync(path.join(root, '.seal-hook-ran'), 'utf8'), '');
const expired = { ...original, heartbeatAt: '2000-01-01T00:00:00.000Z' };
writeFileSync(lockPath, `${JSON.stringify(expired)}\n`);
assert.throws(() => attempt('must not seal'), /exact live temporary framework claim/);
assert.equal(readFileSync(lockPath, 'utf8'), `${JSON.stringify(expired)}\n`);
console.log('[seal-temp-claim-expiry] ok');
