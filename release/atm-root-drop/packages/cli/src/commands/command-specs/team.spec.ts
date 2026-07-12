import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export const teamSpecCommandSurface = {
  name: 'team' as const,
  summary:
    'Plan, start, or validate scoped ATM team agents for a task. Validates permissions, leases, task claim dependency gates, parallel CID advisor preflight, and broker lane routing for steward/composer paths.',
  positional: [
    {
      name: 'action',
      summary:
        'Team action. Supports: plan, start, status, validate, patrol, lease, release, complete, abandon, handoff show|context|stats, wave, knowledge. Plan and start evaluate broker lanes plus task claim dependency gates, and fail closed before a run starts.'
    }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to plan, validate, or start a team for.' },
    { flag: '--recipe', value: 'id', summary: 'Optional team recipe id. Defaults to a language-aware built-in recipe.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for team start.' },
    { flag: '--runtime-mode', value: 'mode', summary: 'Team runtime mode: real-agent, editor-subagent, or broker-only. Defaults to broker-only.' },
    { flag: '--runtime-language', value: 'name', summary: 'Runtime language contract for this team run. Defaults to node.' },
    { flag: '--runtime-adapter', value: 'id', summary: 'Vendor-neutral runtime adapter id recorded on the team run.' },
    { flag: '--provider', value: 'id', summary: 'Optional provider metadata recorded on the runtime contract.' },
    { flag: '--sdk', value: 'id', summary: 'Optional SDK metadata recorded on the runtime contract.' },
    { flag: '--model', value: 'id', summary: 'Optional model metadata recorded on the runtime contract.' },
    { flag: '--role-provider', value: 'role=provider:model[:sdk][:mode]', repeatable: true, summary: 'Override provider/model selection for one Team role. Repeatable.' },
    { flag: '--team-size', value: 'level', summary: 'Manual team size/level override: small/L1 core, medium/L2 reader+evidence, large/L3 scope, L4 lieutenant, L5 review+knowledge.' },
    { flag: '--disable-editor-bridge', summary: 'Disable the editor-subagent bridge contract for this run while preserving Team governance semantics.' },
    { flag: '--execute', summary: 'Execute governed provider orchestration for selected Team roles after runtime state is written. Defaults off.' },
    { flag: '--team', value: 'id', summary: 'Team run id for status or patrol.' },
    { flag: '--broker-proposal-file', value: 'path', summary: 'Validated broker proposal consumed by team plan (readiness preview) and a matching hot Team start; mismatched, stale, or out-of-scope proposals fail closed on both surfaces.' },
    { flag: '--permission', value: 'id', summary: 'Permission id for team lease or release.' },
    { flag: '--paths', value: 'csv', summary: 'Comma-separated lease paths for team lease.' },
    { flag: '--reason', value: 'text', summary: 'Reason recorded for team lease, release, complete, or abandon.' },
    { flag: '--mode', value: 'name', summary: 'Team patrol mode: claim-preflight, close-preflight, big-script, or daily-noon.' },
    { flag: '--compact', summary: 'Return a compact status payload.' },
    { flag: '--scope', value: 'name', summary: 'Knowledge build scope for team knowledge build.' },
    { flag: '--dry-run', summary: 'Run team knowledge build without writing generated runtime cache files.' },
    { flag: '--write', summary: 'Write team knowledge generated cache files under .atm/runtime/knowledge.' },
    { flag: '--query', value: 'text', summary: 'Literal advisory query text for team knowledge query.' },
    { flag: '--top', value: 'n', summary: 'Maximum advisory team knowledge hits to return.' },
    { flag: '--repo', value: 'name', summary: 'Team knowledge metadata filter.' },
    { flag: '--channel', value: 'name', summary: 'Team knowledge metadata filter.' },
    { flag: '--domain', value: 'name', summary: 'Team knowledge metadata filter.' },
    { flag: '--path', value: 'glob', summary: 'Team knowledge metadata path filter.' },
    { flag: '--atom', value: 'id', summary: 'Team knowledge metadata atom filter.' },
    { flag: '--validator', value: 'command', summary: 'Team knowledge metadata validator filter.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ]
};

export const teamSpecCrewBriefing = {
  summary:
    'Plan examples for minimal crew briefing contract output (TASK-TEAM-0002 owns team.plan-crew-briefing-contract).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0002 --json']
};

export const teamSpecAtomizationPlanner = {
  summary:
    'Plan examples for atomization planner advisory output (TASK-TEAM-0003 owns team.plan-atomization-planner).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0003 --json']
};

export const teamSpecTask0009Preflight = {
  summary:
    'Plan examples for TASK-TEAM-0009 preflight / referee output (uses team plan dry-run resolver for the next integration gate).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0009 --json']
};

export const teamSpecPlanResolver = {
  summary:
    'Plan examples for the TASK-TEAM-0009 dry-run resolver output, including the team implementer selector and atm.teamPlan.v1 evidence surface.',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0009 --json']
};

export const teamSpecRoleSelector = {
  summary:
    'Plan examples for deterministic role and implementer selection output with language, role, fallback, and confidence signals (TASK-TEAM-0010 owns the selector surface).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0010 --json']
};

export const teamSpecPermissionValidation = {
  summary: 'Validate recipe permissions and scoped file.write leases before team start (TASK-TEAM-0012 owns structured permission lease findings; TASK-TEAM-0013 owns file.write scope checks).',
  examples: [
    'node atm.mjs team validate --task TASK-TEAM-0013 --json',
    'node atm.mjs team validate --task TASK-TEAM-0012 --json',
    'node atm.mjs team validate --task TASK-AAO-0005 --recipe atm.default.normal.typescript --json'
  ]
};

export const teamSpecLeaseFencing = {
  summary:
    'Team lease fencing and deadlock contract diagnostics cover duplicate exclusive owners, stale lease epochs, wait-for cycles, released tombstones, and allowedFiles write boundaries across real-agent, editor-subagent, and broker-only runs.',
  examples: [
    'node --strip-types scripts/validate-team-agents.ts --case fencing-deadlock',
    'node --strip-types scripts/validate-team-agents.ts --case active-resource-index-readonly'
  ]
};

export const teamSpecBrokerLane = {
  summary:
    'Plan and start evaluate broker lanes; blocked CID conflicts fail closed before a run starts, broker verdicts outrank Coordinator decisions, and lane evidence records write transaction identity, lease epoch, read/write sets, file hashes, and broker decision linkage (team.plan-broker-lane).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0002 --json', 'node atm.mjs team start --task TASK-AAO-0005 --actor codex-main --json']
};

export const teamSpecClaimGateParity = {
  summary:
    'Plan/start claim-gate parity: team start fails closed when the normal task claim dependency gate would reject the task (TASK-TEAM-0029).',
  examples: [
    'node atm.mjs team plan --task TASK-TEAM-0029 --json',
    'node atm.mjs team start --task TASK-TEAM-0029 --actor codex-main --json'
  ]
};

export const teamSpecCaptainDecision = {
  summary:
    'Plan examples for captain decision dry-run output that includes team sizing, confidence, and stop conditions (TASK-TEAM-0007 owns the decision surface).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0007 --json']
};

export const teamSpecLieutenantEscalation = {
  summary:
    'Plan examples for lieutenant escalation dry-run output that includes escalationRequired, escalationReason, needLieutenant, nextTeamShape, and the broker-over-coordinator authority chain (TASK-TEAM-0008 owns the escalation surface).',
  examples: ['node atm.mjs team plan --task TASK-TEAM-0008 --json']
};

export const teamSpecRuntimeStatus = {
  summary:
    'Start and inspect a team runtime record with neutral runtime mode, adapter metadata, serialized commit lane, and broker subagent status fields (TASK-TEAM-0011 owns status; TASK-TEAM-0031 owns runtime contract fields).',
  examples: [
    'node atm.mjs team start --task TASK-TEAM-0011 --actor codex-main --json',
    'node atm.mjs team start --task TASK-TEAM-0031 --actor codex-main --runtime-mode broker-only --runtime-adapter atm.node.broker --json',
    'node atm.mjs team start --task TASK-TEAM-0032 --actor codex-main --runtime-mode editor-subagent --runtime-adapter codex.desktop.subagent --json',
    'node atm.mjs team start --task TASK-TEAM-0041 --actor codex-main --provider openai --sdk responses --model gpt-5-mini --json',
    'node atm.mjs team status --compact --json'
  ]
};

export const teamSpecPatrolReport = {
  summary:
    'Read-only Team patrol report for runtime mode, broker-governance drift, rework readiness, missing artifacts, retry-budget risk, and close/claim preflight guidance (TASK-TEAM-0014).',
  examples: [
    'node atm.mjs team patrol --task TASK-TEAM-0014 --json',
    'node atm.mjs team patrol --task TASK-TEAM-0014 --mode close-preflight --json',
    'node atm.mjs team patrol --task TASK-TEAM-0014 --team <teamRunId> --json'
  ]
};

export const teamSpecNextRecommendation = {
  summary:
    'Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands (TASK-TEAM-0015).',
  examples: [
    'node atm.mjs next --task TASK-TEAM-0015 --json',
    'node atm.mjs team plan --task TASK-TEAM-0015 --json'
  ]
};

export const teamSpecKnowledgeBuildQuery = {
  summary:
    'Advisory Team knowledge build/query surface. Build discovers canonical .atm/knowledge shards; query and team plan expose compact Captain-facing hits from generated runtime cache without becoming a task gate.',
  examples: [
    'node atm.mjs team knowledge build --scope project --dry-run --json',
    'node atm.mjs team knowledge query --task TASK-AAO-0005 --top 5 --json',
    'node atm.mjs team plan --task TASK-AAO-0005 --json'
  ]
};

export default defineCommandSpec({
  ...teamSpecCommandSurface,
  examples: [
    ...teamSpecCrewBriefing.examples,
    ...teamSpecAtomizationPlanner.examples,
    ...teamSpecPlanResolver.examples,
    ...teamSpecRoleSelector.examples,
    ...teamSpecCaptainDecision.examples,
    ...teamSpecLieutenantEscalation.examples,
    ...teamSpecPermissionValidation.examples,
    ...teamSpecLeaseFencing.examples,
    ...teamSpecClaimGateParity.examples,
    ...teamSpecRuntimeStatus.examples,
    ...teamSpecPatrolReport.examples,
    ...teamSpecNextRecommendation.examples,
    ...teamSpecKnowledgeBuildQuery.examples
  ]
});
