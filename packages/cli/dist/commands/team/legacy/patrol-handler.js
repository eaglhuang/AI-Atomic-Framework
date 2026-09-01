import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, quoteCliValue, readJsonFile } from '../../shared.js';
import { readTeamHandoffArtifacts, renderTeamHandoffIndex, teamHandoffRuntimeDirectory, verifyTeamHandoffLedger } from '../../../../../core/dist/team-runtime/handoff-ledger.js';
import { normalizeOptionalRuntimeString } from './runtime-governance.js';
import { buildTeamPatrolFollowUp, buildTeamRunPatrolFindings, summarizePatrolSeverity, suggestedPatrolCommand, teamPatrolFinding } from './patrol-contracts.js';
import { evaluateLargeScriptRisk } from './crew-decision-policy.js';
import { findLatestTeamRunForTask, readTeamRun } from './team-run-store.js';
import { deriveWritePaths, summarizeTask, uniqueStrings } from './team-utils.js';
export function buildTeamPatrolResult(input) {
    const report = buildTeamPatrolReport(input);
    return makeResult({
        ok: true,
        command: 'team',
        cwd: input.cwd,
        messages: [
            message(report.safeToProceed ? 'info' : 'warning', report.safeToProceed ? 'ATM_TEAM_PATROL_READY' : 'ATM_TEAM_PATROL_FINDINGS', report.safeToProceed
                ? 'Team patrol completed with no blocking findings. No runtime or history state was written.'
                : 'Team patrol found follow-up items. No runtime or history state was written.', {
                taskId: input.taskId,
                mode: input.mode,
                severity: report.severity,
                findingCount: report.findings.length
            })
        ],
        evidence: report
    });
}
export function buildTeamPatrolReport(input) {
    const findings = [];
    const taskPath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
    const evidencePath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.json`);
    const closurePacketPath = path.join(input.cwd, '.atm', 'history', 'closure-packets', `${input.taskId}.json`);
    const taskExists = existsSync(taskPath);
    const evidenceExists = existsSync(evidencePath);
    const closurePacketExists = existsSync(closurePacketPath);
    const task = taskExists ? readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID') : null;
    const taskSummary = task ? summarizeTask(input.taskId, task) : { taskId: input.taskId, title: input.taskId, status: null, targetRepo: null, sourcePlanPath: null };
    const writePaths = task ? deriveWritePaths(task, input.cwd) : [];
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const teamRun = input.requestedTeamRunId ? readTeamRun(input.cwd, input.requestedTeamRunId) : findLatestTeamRunForTask(input.cwd, input.taskId);
    if (!taskExists) {
        findings.push(teamPatrolFinding({
            level: 'blocker',
            code: 'ATM_TEAM_PATROL_TASK_MISSING',
            category: 'artifact-gap',
            summary: `Task ledger is missing for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs next --task ${quoteCliValue(input.taskId)} --json`,
            details: { path: path.relative(input.cwd, taskPath).replace(/\\/g, '/') }
        }));
    }
    if (!evidenceExists) {
        findings.push(teamPatrolFinding({
            level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
            code: 'ATM_TEAM_PATROL_EVIDENCE_MISSING',
            category: 'evidence',
            summary: `Command-backed evidence file is not present for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs evidence run --task ${quoteCliValue(input.taskId)} --actor <actor> -- <validator-command>`,
            details: { path: path.relative(input.cwd, evidencePath).replace(/\\/g, '/') }
        }));
    }
    if (input.mode === 'close-preflight' && !closurePacketExists) {
        findings.push(teamPatrolFinding({
            level: 'warning',
            code: 'ATM_TEAM_PATROL_CLOSURE_PACKET_MISSING',
            category: 'artifact-gap',
            summary: `Closure packet has not been materialized for ${input.taskId}.`,
            suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
            details: { path: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/') }
        }));
    }
    if (!teamRun) {
        findings.push(teamPatrolFinding({
            level: 'info',
            code: 'ATM_TEAM_PATROL_NO_TEAM_RUN',
            category: 'runtime-mode',
            summary: 'No matching active team runtime record was found; patrol continues from ledger artifacts only.',
            suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`
        }));
    }
    else {
        const taskStatus = normalizeOptionalRuntimeString(taskSummary.status);
        if (taskStatus && ['done', 'abandoned', 'blocked'].includes(taskStatus) && String(teamRun.status ?? '').trim() === 'active') {
            findings.push(teamPatrolFinding({
                level: 'warning',
                code: 'ATM_TEAM_PATROL_STALE_TERMINAL_TEAM_RUN',
                category: 'runtime-mode',
                summary: `Team run ${teamRun.teamRunId} is still active even though task ${input.taskId} is already ${taskStatus}.`,
                suggestedCommand: `node atm.mjs tasks close --task ${quoteCliValue(input.taskId)} --actor <actor> --status ${taskStatus} --json`,
                details: { teamRunId: teamRun.teamRunId, taskStatus }
            }));
        }
        findings.push(...buildTeamRunPatrolFindings(teamRun, input));
    }
    if (input.mode === 'big-script' || largeScriptRisk.level === 'high') {
        findings.push(teamPatrolFinding({
            level: largeScriptRisk.level === 'high' ? 'warning' : 'info',
            code: largeScriptRisk.level === 'high' ? 'ATM_TEAM_PATROL_LARGE_SCRIPT_RISK' : 'ATM_TEAM_PATROL_SCOPE_LOW_RISK',
            category: 'scope',
            summary: largeScriptRisk.level === 'high'
                ? 'Task write scope has large-script or hot-file risk and should receive extra review.'
                : 'Task write scope does not exceed the large-script threshold.',
            suggestedCommand: largeScriptRisk.level === 'high'
                ? `node atm.mjs team plan --task ${quoteCliValue(input.taskId)} --json`
                : null,
            details: { writePaths, largeScriptRisk }
        }));
    }
    if (teamRun?.teamRunId) {
        findings.push(...buildTeamHandoffPatrolFindings(input.cwd, input.taskId, String(teamRun.teamRunId), input.mode));
    }
    const severity = summarizePatrolSeverity(findings);
    return {
        schemaId: 'atm.teamPatrolReport.v1',
        action: 'patrol',
        readOnly: true,
        runtimeWritten: false,
        historyWritten: false,
        agentsSpawned: false,
        mutations: [],
        taskId: input.taskId,
        runId: `patrol-${input.taskId}-${input.mode}`,
        patrolTeam: ['atomic-police', 'scope-guardian', 'evidence-auditor', 'runtime-sentinel'],
        mode: input.mode,
        severity,
        safeToProceed: severity !== 'blocker',
        findings,
        suggestedCommand: suggestedPatrolCommand(input.taskId, input.mode, severity),
        followUp: buildTeamPatrolFollowUp(input.taskId, input.mode, findings),
        task: taskSummary,
        inspected: {
            taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
            evidencePath: path.relative(input.cwd, evidencePath).replace(/\\/g, '/'),
            closurePacketPath: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/'),
            teamRunId: teamRun?.teamRunId ?? null,
            teamRunPath: teamRun?.teamRunId ? `.atm/runtime/team-runs/${teamRun.teamRunId}.json` : null,
            runtimeRoot: '.atm/runtime',
            historyRoot: '.atm/history'
        }
    };
}
function buildTeamHandoffPatrolFindings(cwd, taskId, teamRunId, mode) {
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    if (!existsSync(directory))
        return [];
    const findings = [];
    const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
    if (!integrity.ok) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_INTEGRITY_BLOCKED', category: 'artifact-gap',
            summary: `Handoff ledger integrity is blocked: ${integrity.reason ?? 'unknown reason'}.`,
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, reason: integrity.reason, canonicalReason: 'handoff-integrity-blocked' }
        }));
        return findings;
    }
    const indexPath = path.join(directory, 'index.md');
    const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    const expected = renderCanonicalTeamHandoffIndex(integrity.manifest, directory);
    if (!index || index !== expected) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_NARRATIVE_DRIFT', category: 'artifact-gap',
            summary: 'Handoff Markdown is not the deterministic JSON-whitelist projection.',
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
        }));
    }
    if (/\uFFFD/.test(index) || Buffer.from(index, 'utf8').toString('utf8') !== index) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_ENCODING_INVALID', category: 'artifact-gap',
            summary: 'Handoff Markdown is not valid stable UTF-8 text.',
            suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
        }));
    }
    const bytes = integrity.manifest.artifacts.reduce((total, entry) => total + readFileSync(path.join(directory, entry.file)).byteLength, 0);
    if (integrity.manifest.transitionCount >= 64 || bytes >= 512 * 1024) {
        findings.push(teamPatrolFinding({
            level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_HARD_LIMIT', category: 'runtime-mode',
            summary: 'Handoff retention hard limit requires Captain sign-off before another transition.',
            suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes, decisionClass: 'human-signoff-required' }
        }));
    }
    else if (integrity.manifest.transitionCount >= 48 || bytes >= 384 * 1024) {
        findings.push(teamPatrolFinding({
            level: mode === 'close-preflight' ? 'warning' : 'info', code: 'ATM_TEAM_PATROL_HANDOFF_SOFT_LIMIT', category: 'runtime-mode',
            summary: 'Handoff retention soft limit reached; Captain should prepare to split or archive the run.',
            suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
            details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes }
        }));
    }
    return findings;
}
function renderCanonicalTeamHandoffIndex(manifest, directory) {
    return renderTeamHandoffIndex(manifest, readTeamHandoffArtifacts(directory, manifest));
}
function normalizeTeamLifecyclePaths(value) {
    return uniqueStrings(String(value ?? '')
        .split(',')
        .map((entry) => entry.trim().replace(/\\/g, '/'))
        .filter(Boolean));
}
export function normalizeTeamPatrolMode(value) {
    const mode = String(value ?? 'claim-preflight').trim();
    if (['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'].includes(mode)) {
        return mode;
    }
    throw new CliError('ATM_TEAM_PATROL_MODE_INVALID', `Unsupported team patrol mode: ${mode}`, {
        exitCode: 2,
        details: { supportedModes: ['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'] }
    });
}
