import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export const TEAM_HANDOFF_SOFT_TRANSITIONS = 48;
export const TEAM_HANDOFF_HARD_TRANSITIONS = 64;
export const TEAM_HANDOFF_SOFT_BYTES = 384 * 1024;
export const TEAM_HANDOFF_HARD_BYTES = 512 * 1024;
export function buildTeamHandoffRetentionDecision(stats) {
    if (stats.hardLimitReached)
        return { decisionClass: 'human-signoff-required', violationStatus: 'human-signoff-required', statusCode: 'handoff-hard-limit-reached', summary: 'Handoff hard retention limit reached; Captain must split the run or continue without recording further handoffs.' };
    if (stats.softLimitReached)
        return { decisionClass: 'auto-execution', violationStatus: 'warning', statusCode: 'handoff-soft-limit-warning', summary: 'Handoff soft retention limit reached; Patrol warning emitted before the hard stop.' };
    return { decisionClass: 'auto-execution', violationStatus: 'none', statusCode: 'none', summary: 'Handoff retention is within budget.' };
}
export function teamHandoffRuntimeDirectory(cwd, taskId, teamRunId) {
    return path.join(cwd, '.atm', 'runtime', 'handoff', safeSegment(taskId), safeSegment(teamRunId));
}
export function teamHandoffHistoryDirectory(cwd, taskId, teamRunId) {
    return path.join(cwd, '.atm', 'history', 'handoff', safeSegment(taskId), safeSegment(teamRunId));
}
/** Coordinator-only archive promotion. Callers commit the returned history path in the task closure bundle. */
export function promoteTeamHandoffArchive(input) {
    const integrity = verifyTeamHandoffLedger(input.cwd, input.taskId, input.teamRunId);
    if (!integrity.ok)
        throw new Error(`ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED: ${integrity.reason}.`);
    const runtimePath = teamHandoffRuntimeDirectory(input.cwd, input.taskId, input.teamRunId);
    const historyPath = teamHandoffHistoryDirectory(input.cwd, input.taskId, input.teamRunId);
    const archived = { ...integrity.manifest, runOutcome: input.runOutcome, updatedAt: new Date().toISOString() };
    atomicWrite(path.join(runtimePath, 'manifest.json'), `${JSON.stringify(archived, null, 2)}\n`);
    atomicWrite(path.join(runtimePath, 'index.md'), renderTeamHandoffIndex(archived, readTeamHandoffArtifacts(runtimePath, archived)));
    rmSync(historyPath, { recursive: true, force: true });
    mkdirSync(path.dirname(historyPath), { recursive: true });
    cpSync(runtimePath, historyPath, { recursive: true, force: true });
    return { historyPath, manifest: archived };
}
export function materializeTeamRoleHandoff(input) {
    const directory = teamHandoffRuntimeDirectory(input.cwd, input.taskId, input.teamRunId);
    mkdirSync(directory, { recursive: true });
    const manifest = readTeamHandoffManifest(directory, input.taskId, input.teamRunId);
    const stats = computeTeamHandoffStats(directory, manifest);
    if (stats.hardLimitReached) {
        const decision = buildTeamHandoffRetentionDecision(stats);
        const error = new Error(`ATM_TEAM_HANDOFF_HARD_LIMIT: ${decision.summary}`);
        error.decision = decision;
        throw error;
    }
    const sequence = manifest.transitionCount + 1;
    const previous = manifest.artifacts.at(-1)?.sha256 ?? null;
    const preview = redactPreview(input.redactedPreview);
    const artifact = {
        schemaId: 'atm.teamRoleHandoffArtifact.v1', handoffId: `${input.teamRunId}-${String(sequence).padStart(4, '0')}`, sequence,
        taskId: input.taskId, teamRunId: input.teamRunId,
        from: { role: required(input.fromRole, 'fromRole'), providerId: required(input.fromProviderId, 'fromProviderId'), modelId: required(input.fromModelId, 'fromModelId') },
        to: { role: optional(input.toRole), providerId: optional(input.toProviderId) }, createdAt: input.createdAt ?? new Date().toISOString(),
        leaseEpoch: positiveInteger(input.leaseEpoch, 'leaseEpoch'),
        sourceArtifact: { schemaId: 'atm.teamProviderRunArtifact.v1', artifactId: required(input.sourceArtifactId, 'sourceArtifactId'), sha256: sha256(preview) },
        humanSummary: firstSentence(preview), routeNote: optional(input.routeNote),
        decision: { decisionClass: optional(input.decisionClass) ?? 'auto-execution', decisionReason: optional(input.decisionReason), violationStatus: optional(input.violationStatus) },
        redaction: { rawSecretsStored: false, source: 'provider-preview', redactedFields: ['provider-output'] }, previousHandoffSha256: previous
    };
    const file = `${String(sequence).padStart(4, '0')}-${safeSegment(artifact.from.role)}.json`;
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    const hash = sha256(serialized);
    atomicWrite(path.join(directory, file), serialized);
    const next = {
        ...manifest, transitionCount: sequence,
        artifacts: [...manifest.artifacts, { sequence, file, sha256: hash, previousHandoffSha256: previous }],
        rootHandoffSha256: hash, updatedAt: artifact.createdAt
    };
    atomicWrite(path.join(directory, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
    atomicWrite(path.join(directory, 'index.md'), renderTeamHandoffIndex(next, readTeamHandoffArtifacts(directory, next)));
    return { artifact, manifest: next, stats: computeTeamHandoffStats(directory, next) };
}
export function verifyTeamHandoffLedger(cwd, taskId, teamRunId) {
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    return verifyTeamHandoffDirectory(directory, taskId, teamRunId);
}
export function verifyTeamHandoffHistory(cwd, taskId, teamRunId) {
    return verifyTeamHandoffDirectory(teamHandoffHistoryDirectory(cwd, taskId, teamRunId), taskId, teamRunId);
}
export function verifyTeamHandoffDirectory(directory, taskId, teamRunId) {
    const manifest = readTeamHandoffManifest(directory, taskId, teamRunId);
    if (manifest.taskId !== taskId || manifest.teamRunId !== teamRunId)
        return { ok: false, reason: 'manifest task/run mismatch', manifest };
    let previous = null;
    for (const [index, entry] of manifest.artifacts.entries()) {
        if (entry.sequence !== index + 1)
            return { ok: false, reason: `sequence gap at ${entry.file}`, manifest };
        const filePath = path.join(directory, entry.file);
        if (!existsSync(filePath))
            return { ok: false, reason: `missing ${entry.file}`, manifest };
        const content = readFileSync(filePath, 'utf8');
        if (sha256(content) !== entry.sha256)
            return { ok: false, reason: `hash mismatch ${entry.file}`, manifest };
        const artifact = JSON.parse(content);
        if (artifact.sequence !== entry.sequence || artifact.previousHandoffSha256 !== previous)
            return { ok: false, reason: `chain mismatch ${entry.file}`, manifest };
        if (artifact.taskId !== taskId || artifact.teamRunId !== teamRunId)
            return { ok: false, reason: `artifact task/run mismatch ${entry.file}`, manifest };
        previous = entry.sha256;
    }
    if (manifest.transitionCount !== manifest.artifacts.length)
        return { ok: false, reason: 'transition count mismatch', manifest };
    if (previous !== manifest.rootHandoffSha256)
        return { ok: false, reason: 'root hash mismatch', manifest };
    const indexPath = path.join(directory, 'index.md');
    if (!existsSync(indexPath))
        return { ok: false, reason: 'missing index.md', manifest };
    const index = readFileSync(indexPath, 'utf8');
    const expectedFrontmatter = `manifest_sha256: ${sha256(JSON.stringify(manifest))}`;
    if (!index.includes(`task_id: ${taskId}`) || !index.includes(`team_run_id: ${teamRunId}`) || !index.includes(expectedFrontmatter))
        return { ok: false, reason: 'frontmatter mismatch', manifest };
    return { ok: true, reason: null, manifest };
}
export function readTeamHandoffArtifacts(directory, manifest) {
    return manifest.artifacts.map((entry) => JSON.parse(readFileSync(path.join(directory, entry.file), 'utf8')));
}
export function renderTeamHandoffIndex(manifest, artifacts) {
    const frontmatter = ['---', `task_id: ${manifest.taskId}`, `team_run_id: ${manifest.teamRunId}`, 'manifest_ref: manifest.json', `manifest_sha256: ${sha256(JSON.stringify(manifest))}`, `created_at: ${manifest.createdAt}`, `updated_at: ${manifest.updatedAt}`, `transition_count: ${manifest.transitionCount}`, '---', ''];
    const blocks = artifacts.flatMap((artifact) => [
        `## Transition ${artifact.sequence}: ${artifact.from.role} -> ${artifact.to.role ?? 'coordinator'}`,
        '',
        `- Who: ${artifact.from.role} (${artifact.from.providerId}:${artifact.from.modelId}) -> ${artifact.to.role ?? 'coordinator'}${artifact.to.providerId ? ` (${artifact.to.providerId})` : ''}`,
        `- Time: ${artifact.createdAt} | decisionClass: ${artifact.decision.decisionClass}`,
        `- Summary: "${artifact.humanSummary}"`,
        `- Artifact: ${artifact.sourceArtifact.schemaId} -> ${artifact.sourceArtifact.artifactId} (sha256:${artifact.sourceArtifact.sha256})`,
        ...(artifact.routeNote ? [`- Route: ${artifact.routeNote}`] : []),
        ''
    ]);
    return [...frontmatter, ...blocks].join('\n');
}
function readTeamHandoffManifest(directory, taskId, teamRunId) {
    const manifestPath = path.join(directory, 'manifest.json');
    if (existsSync(manifestPath))
        return JSON.parse(readFileSync(manifestPath, 'utf8'));
    const now = new Date().toISOString();
    return { schemaId: 'atm.teamRoleHandoffManifest.v1', taskId, teamRunId, runOutcome: 'running', transitionCount: 0, artifacts: [], rootHandoffSha256: null, createdAt: now, updatedAt: now };
}
function computeTeamHandoffStats(directory, manifest) {
    const bytes = manifest.artifacts.reduce((total, entry) => total + (existsSync(path.join(directory, entry.file)) ? readFileSync(path.join(directory, entry.file)).byteLength : 0), 0);
    return { transitionCount: manifest.transitionCount, bytes, softLimitReached: manifest.transitionCount >= TEAM_HANDOFF_SOFT_TRANSITIONS || bytes >= TEAM_HANDOFF_SOFT_BYTES, hardLimitReached: manifest.transitionCount >= TEAM_HANDOFF_HARD_TRANSITIONS || bytes >= TEAM_HANDOFF_HARD_BYTES };
}
function atomicWrite(filePath, content) { const temporary = `${filePath}.${process.pid}.tmp`; writeFileSync(temporary, content, 'utf8'); renameSync(temporary, filePath); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function firstSentence(value) { const sentence = value.match(/^(.+?[.!?](?:\s|$)|.+$)/)?.[1] ?? value; return tokenize(sentence).slice(0, 64).join(' '); }
function tokenize(value) { return value.trim().split(/\s+/).filter(Boolean); }
function redactPreview(value) { return String(value ?? '').replace(/(?:sk-|AIza|Bearer\s+)[A-Za-z0-9_\-.]+/g, '[REDACTED]').trim(); }
function safeSegment(value) { return required(value, 'path').replace(/[^A-Za-z0-9._-]/g, '_'); }
function required(value, label) { const normalized = String(value ?? '').trim(); if (!normalized)
    throw new Error(`${label} is required.`); return normalized; }
function optional(value) { const normalized = String(value ?? '').trim(); return normalized || null; }
function positiveInteger(value, label) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer.`); return parsed; }
