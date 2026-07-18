import { quoteCliValue } from '../../shared.js';
export function buildTeamRunPatrolFindings(teamRun, input) {
    const findings = [];
    if (!teamRun)
        return findings;
    const run = teamRun;
    if (run.executionMode !== 'manual-team') {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_RUNTIME_MODE_UNEXPECTED',
            category: 'runtime-mode',
            summary: `Team run ${run.teamRunId} is not in manual-team execution mode.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { executionMode: run.executionMode ?? null }
        }));
    }
    if (run.agentsSpawned === true) {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_AGENTS_SPAWNED',
            category: 'runtime-mode',
            summary: `Team run ${run.teamRunId} reports spawned agents; coordinator should verify advisory role boundaries.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`
        }));
    }
    const brokerSubagent = run.brokerSubagent ?? run.runtimeContract?.brokerSubagent ?? null;
    if (!brokerSubagent || brokerSubagent.enabled !== true) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} does not expose an enabled broker subagent contract.`,
            suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { schemaId: brokerSubagent?.schemaId ?? null, enabled: brokerSubagent?.enabled ?? null }
        }));
    }
    else {
        findings.push(...buildBrokerSubagentPatrolFindings(run, brokerSubagent));
    }
    const commitLane = run.commitLane ?? run.runtimeContract?.commitLane ?? null;
    if (commitLane && (commitLane.serializedBy !== 'branch-commit-queue'
        || commitLane.ownerRole !== 'coordinator'
        || commitLane.workerGitWrite === true)) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} commit lane no longer enforces coordinator-owned serialized commits.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: {
                serializedBy: commitLane.serializedBy ?? null,
                ownerRole: commitLane.ownerRole ?? null,
                workerGitWrite: commitLane.workerGitWrite ?? null
            }
        }));
    }
    const artifactFindings = Array.isArray(run.artifactHandoff?.findings)
        ? run.artifactHandoff.findings
        : Array.isArray(run.runtimeContract?.artifactHandoff?.findings)
            ? run.runtimeContract.artifactHandoff.findings
            : [];
    for (const artifactFinding of artifactFindings) {
        if (artifactFinding?.blocking === true) {
            findings.push(teamPatrolFinding({
                level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
                code: 'ATM_TEAM_PATROL_ARTIFACT_HANDOFF_BLOCKED',
                category: 'artifact-gap',
                summary: String(artifactFinding.summary ?? 'Team role artifact handoff has a missing required artifact.'),
                suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
                details: {
                    role: artifactFinding.role ?? null,
                    agentId: artifactFinding.agentId ?? null,
                    artifact: artifactFinding.artifact ?? null
                }
            }));
        }
    }
    const remaining = extractRetryBudgetRemaining(teamRun);
    if (remaining !== null && remaining <= 0) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_RETRY_BUDGET_EXHAUSTED',
            category: 'retry-budget',
            summary: `Team run ${run.teamRunId} has no retry budget remaining.`,
            suggestedCommand: `node atm.mjs team patrol --task ${quoteCliValue(input.taskId)} --mode close-preflight --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { retryBudgetRemaining: remaining }
        }));
    }
    const reworkStatus = String(run.reworkRoute?.status ?? run.reworkStatus ?? '').trim();
    if (['needs-rework', 'blocked', 'stale'].includes(reworkStatus)) {
        findings.push(teamPatrolFinding({
            level: reworkStatus === 'blocked' ? 'blocker' : 'warning',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_ATTENTION',
            category: 'rework-state',
            summary: `Team run ${run.teamRunId} rework route is ${reworkStatus}.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { reworkStatus }
        }));
    }
    if (reworkStatus === 'ready-for-close' && input.mode === 'close-preflight') {
        findings.push(teamPatrolFinding({
            level: 'info',
            code: 'ATM_TEAM_PATROL_REWORK_ROUTE_READY_FOR_CLOSE',
            category: 'rework-state',
            summary: `Team run ${run.teamRunId} rework route is ready-for-close.`,
            suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { reworkStatus }
        }));
    }
    return findings;
}
export function summarizePatrolSeverity(findings) {
    if (findings.some((finding) => finding.level === 'blocker'))
        return 'blocker';
    if (findings.some((finding) => finding.level === 'warning'))
        return 'warning';
    return 'info';
}
export function suggestedPatrolCommand(taskId, mode, severity) {
    if (severity === 'blocker') {
        return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    if (mode === 'claim-preflight') {
        return `node atm.mjs next --claim --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    if (mode === 'close-preflight') {
        return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
    }
    return `node atm.mjs team patrol --task ${quoteCliValue(taskId)} --mode ${mode} --json`;
}
export function buildTeamPatrolFollowUp(taskId, mode, findings) {
    const commands = uniqueStrings(findings.map((finding) => finding.suggestedCommand).filter((entry) => Boolean(entry)));
    if (commands.length > 0)
        return commands;
    if (mode === 'close-preflight') {
        return [`node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`];
    }
    return [`node atm.mjs team plan --task ${quoteCliValue(taskId)} --json`];
}
function buildBrokerSubagentPatrolFindings(run, brokerSubagent) {
    const findings = [];
    if (brokerSubagent.decisionSurface !== 'brokerLane' || brokerSubagent.stewardId !== 'neutral-write-steward') {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} broker subagent contract does not match the expected broker lane steward.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: {
                decisionSurface: brokerSubagent.decisionSurface ?? null,
                stewardId: brokerSubagent.stewardId ?? null
            }
        }));
    }
    const expectedEvidenceRequired = [
        'atm.teamBrokerLaneEvidence.v1',
        'atm.stewardApplyEvidence.v1',
        'atm.brokerOperationRunRecordEnvelope.v1'
    ];
    const evidenceRequired = normalizeStringArray(brokerSubagent.evidenceRequired);
    const missingEvidence = expectedEvidenceRequired.filter((entry) => !evidenceRequired.includes(entry));
    if (missingEvidence.length > 0) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_BROKER_EVIDENCE_GATE_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} broker subagent evidence gates are incomplete.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { evidenceRequired, expectedEvidenceRequired, missingEvidence }
        }));
    }
    const boundary = brokerSubagent.authorityBoundary ?? {};
    if (boundary.fileWrite === true || boundary.gitWrite === true || boundary.taskLifecycle === true || boundary.selfClose === true) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_AUTHORITY_DRIFT',
            category: 'broker-governance',
            summary: `Team run ${run.teamRunId} broker subagent authority boundary is too broad.`,
            suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
            details: { authorityBoundary: boundary }
        }));
    }
    return findings;
}
function extractRetryBudgetRemaining(teamRun) {
    const run = teamRun;
    const retryBudget = run?.retryBudget ?? run?.runtimeContract?.brokerSubagent ?? null;
    if (retryBudget?.status === 'escalation-required' || retryBudget?.exhausted === true) {
        return 0;
    }
    const candidates = [
        run?.reworkRoute?.retryBudgetRemaining,
        run?.reworkRoute?.retryBudget?.remaining
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate;
        }
    }
    return null;
}
export function teamPatrolFinding(input) {
    return input;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry).trim()).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
