import assert from 'node:assert/strict';
import {
  buildEmergencyGitAuthorEnv,
  verifyEmergencyGitAuthorContinuity
} from '../../packages/cli/src/commands/shared/identity-normalization.ts';

const actorId = 'cursor-grok45-plan31-captain';
const gitName = 'cursor-grok45-plan31-captain';
const gitEmail = 'cursor-grok45-plan31-captain@atm.local';

const env = buildEmergencyGitAuthorEnv({ actorId, gitName, gitEmail });
assert.equal(env.GIT_AUTHOR_NAME, gitName);
assert.equal(env.GIT_AUTHOR_EMAIL, gitEmail);
assert.equal(env.GIT_COMMITTER_NAME, gitName);
assert.equal(env.GIT_COMMITTER_EMAIL, gitEmail);
assert.equal(env.ATM_ACTOR_ID, actorId);
assert.equal(Object.prototype.hasOwnProperty.call(env, 'AGENT_IDENTITY'), false);

const ok = verifyEmergencyGitAuthorContinuity({
  expectedGitName: gitName,
  expectedGitEmail: gitEmail,
  expectedActorId: actorId,
  observedAuthorName: gitName,
  observedAuthorEmail: gitEmail,
  observedCommitterName: gitName,
  observedCommitterEmail: gitEmail,
  atmActorTrailer: actorId
});
assert.equal(ok.ok, true);
assert.equal(ok.recoveryCommand, null);

const staleHost = verifyEmergencyGitAuthorContinuity({
  expectedGitName: gitName,
  expectedGitEmail: gitEmail,
  expectedActorId: actorId,
  observedAuthorName: 'codex-gpt-5.4-mini',
  observedAuthorEmail: 'codex-gpt-5.4-mini@atm.local',
  observedCommitterName: 'codex-gpt-5.4-mini',
  observedCommitterEmail: 'codex-gpt-5.4-mini@atm.local',
  atmActorTrailer: actorId
});
assert.equal(staleHost.ok, false);
assert.match(String(staleHost.reason ?? ''), /Stale host Git author/);
assert.match(String(staleHost.recoveryCommand ?? ''), /GIT_AUTHOR_NAME=/);
assert.match(String(staleHost.recoveryCommand ?? ''), /--reset-author/);

const trailerMismatch = verifyEmergencyGitAuthorContinuity({
  expectedGitName: gitName,
  expectedGitEmail: gitEmail,
  expectedActorId: actorId,
  observedAuthorName: gitName,
  observedAuthorEmail: gitEmail,
  atmActorTrailer: 'other-captain'
});
assert.equal(trailerMismatch.ok, false);
assert.match(String(trailerMismatch.reason ?? ''), /ATM-Actor trailer/);

assert.throws(
  () => buildEmergencyGitAuthorEnv({ gitName: '', gitEmail }),
  /requires both gitName and gitEmail/
);

console.log('[emergency-git-author-continuity.test] ok');
