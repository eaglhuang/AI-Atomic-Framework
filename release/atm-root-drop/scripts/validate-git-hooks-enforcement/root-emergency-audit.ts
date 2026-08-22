import { assert, parsePayload, root, runCli } from './context.ts';

export function runRootEmergencyAudit() {
const protectedOverrideAudit = parsePayload(runCli(root, ['emergency', 'audit', '--json']));
assert(protectedOverrideAudit.ok === true, 'emergency audit must list protected override audit events');
assert(Array.isArray(protectedOverrideAudit.evidence?.events), 'emergency audit evidence must include events array');
const blockedNoVerify = parsePayload(runCli(root, ['git', 'commit', '--actor', 'fixture-agent', '--message', 'blocked no-verify', '--no-verify', '--json'], { allowFailure: true }));
assert(blockedNoVerify.ok === false, 'git commit --no-verify without emergency approval must fail closed');
const blockedNoVerifyCodes = JSON.stringify(blockedNoVerify.messages ?? []);
assert(
  blockedNoVerifyCodes.includes('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED')
    || blockedNoVerifyCodes.includes('ATM_GIT_COMMIT_IDENTITY_MISSING')
    || blockedNoVerifyCodes.includes('ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED'),
  'git commit --no-verify must be rejected by an emergency, identity, or framework-claim safety gate before mutation'
);

}
