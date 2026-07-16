import { assert, parsePayload, root, runCli } from './context.ts';

export function runRootEmergencyAudit() {
const protectedOverrideAudit = parsePayload(runCli(root, ['emergency', 'audit', '--json']));
assert(protectedOverrideAudit.ok === true, 'emergency audit must list protected override audit events');
assert(Array.isArray(protectedOverrideAudit.evidence?.events), 'emergency audit evidence must include events array');
const blockedNoVerify = parsePayload(runCli(root, ['git', 'commit', '--actor', 'fixture-agent', '--message', 'blocked no-verify', '--no-verify', '--json'], { allowFailure: true }));
assert(blockedNoVerify.ok === false, 'git commit --no-verify without emergency approval must fail closed');
assert(
  JSON.stringify(blockedNoVerify.messages ?? []).includes('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED')
    || JSON.stringify(blockedNoVerify).includes('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED'),
  'blocked git commit --no-verify must surface emergency approval requirement'
);

}
