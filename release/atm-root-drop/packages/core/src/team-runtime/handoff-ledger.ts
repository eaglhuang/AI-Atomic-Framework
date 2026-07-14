import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TEAM_HANDOFF_SOFT_TRANSITIONS = 48;
export const TEAM_HANDOFF_HARD_TRANSITIONS = 64;
export const TEAM_HANDOFF_SOFT_BYTES = 384 * 1024;
export const TEAM_HANDOFF_HARD_BYTES = 512 * 1024;

export type TeamRoleHandoffArtifact = {
  readonly schemaId: 'atm.teamRoleHandoffArtifact.v1';
  readonly handoffId: string;
  readonly sequence: number;
  readonly taskId: string;
  readonly teamRunId: string;
  readonly from: { readonly role: string; readonly providerId: string; readonly modelId: string };
  readonly to: { readonly role: string | null; readonly providerId: string | null };
  readonly createdAt: string;
  readonly leaseEpoch: number;
  readonly sourceArtifact: {
    readonly schemaId: 'atm.teamProviderRunArtifact.v1';
    readonly artifactId: string;
    readonly sha256: string;
  };
  readonly humanSummary: string;
  readonly routeNote: string | null;
  readonly decision: { readonly decisionClass: string; readonly decisionReason: string | null; readonly violationStatus: string | null };
  readonly redaction: { readonly rawSecretsStored: false; readonly source: 'provider-preview'; readonly redactedFields: readonly string[] };
  readonly previousHandoffSha256: string | null;
};

export type TeamHandoffManifest = {
  readonly schemaId: 'atm.teamRoleHandoffManifest.v1';
  readonly taskId: string;
  readonly teamRunId: string;
  readonly runOutcome: 'running' | 'completed' | 'aborted' | 'failed';
  readonly transitionCount: number;
  readonly artifacts: readonly { readonly sequence: number; readonly file: string; readonly sha256: string; readonly previousHandoffSha256: string | null }[];
  readonly rootHandoffSha256: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TeamHandoffStats = {
  readonly transitionCount: number;
  readonly bytes: number;
  readonly softLimitReached: boolean;
  readonly hardLimitReached: boolean;
};

export type TeamHandoffRetentionDecision = {
  readonly decisionClass: 'auto-execution' | 'human-signoff-required';
  readonly violationStatus: 'none' | 'warning' | 'human-signoff-required';
  readonly statusCode: 'none' | 'handoff-soft-limit-warning' | 'handoff-hard-limit-reached';
  readonly summary: string;
};

export function buildTeamHandoffRetentionDecision(stats: TeamHandoffStats): TeamHandoffRetentionDecision {
  if (stats.hardLimitReached) return { decisionClass: 'human-signoff-required', violationStatus: 'human-signoff-required', statusCode: 'handoff-hard-limit-reached', summary: 'Handoff hard retention limit reached; Captain must split the run or continue without recording further handoffs.' };
  if (stats.softLimitReached) return { decisionClass: 'auto-execution', violationStatus: 'warning', statusCode: 'handoff-soft-limit-warning', summary: 'Handoff soft retention limit reached; Patrol warning emitted before the hard stop.' };
  return { decisionClass: 'auto-execution', violationStatus: 'none', statusCode: 'none', summary: 'Handoff retention is within budget.' };
}

export function teamHandoffRuntimeDirectory(cwd: string, taskId: string, teamRunId: string): string {
  return path.join(cwd, '.atm', 'runtime', 'handoff', safeSegment(taskId), safeSegment(teamRunId));
}

export function teamHandoffHistoryDirectory(cwd: string, taskId: string, teamRunId: string): string {
  return path.join(cwd, '.atm', 'history', 'handoff', safeSegment(taskId), safeSegment(teamRunId));
}

/** Coordinator-only archive promotion. Callers commit the returned history path in the task closure bundle. */
export function promoteTeamHandoffArchive(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly teamRunId: string;
  readonly runOutcome: 'completed' | 'aborted' | 'failed';
}): { readonly historyPath: string; readonly manifest: TeamHandoffManifest } {
  const integrity = verifyTeamHandoffLedger(input.cwd, input.taskId, input.teamRunId);
  if (!integrity.ok) throw new Error(`ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED: ${integrity.reason}.`);
  const runtimePath = teamHandoffRuntimeDirectory(input.cwd, input.taskId, input.teamRunId);
  const historyPath = teamHandoffHistoryDirectory(input.cwd, input.taskId, input.teamRunId);
  const archived: TeamHandoffManifest = { ...integrity.manifest, runOutcome: input.runOutcome, updatedAt: new Date().toISOString() };
  atomicWrite(path.join(runtimePath, 'manifest.json'), `${JSON.stringify(archived, null, 2)}\n`);
  atomicWrite(path.join(runtimePath, 'index.md'), renderTeamHandoffIndex(archived, readTeamHandoffArtifacts(runtimePath, archived)));
  rmSync(historyPath, { recursive: true, force: true });
  mkdirSync(path.dirname(historyPath), { recursive: true });
  cpSync(runtimePath, historyPath, { recursive: true, force: true });
  return { historyPath, manifest: archived };
}

export function materializeTeamRoleHandoff(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly teamRunId: string;
  readonly fromRole: string;
  readonly fromProviderId: string;
  readonly fromModelId: string;
  readonly toRole?: string | null;
  readonly toProviderId?: string | null;
  readonly sourceArtifactId: string;
  readonly redactedPreview: string;
  readonly leaseEpoch: number;
  readonly decisionClass?: string;
  readonly decisionReason?: string | null;
  readonly violationStatus?: string | null;
  readonly routeNote?: string | null;
  readonly createdAt?: string;
}): { artifact: TeamRoleHandoffArtifact; manifest: TeamHandoffManifest; stats: TeamHandoffStats } {
  const directory = teamHandoffRuntimeDirectory(input.cwd, input.taskId, input.teamRunId);
  mkdirSync(directory, { recursive: true });
  const manifest = readTeamHandoffManifest(directory, input.taskId, input.teamRunId);
  const stats = computeTeamHandoffStats(directory, manifest);
  if (stats.hardLimitReached) {
    const decision = buildTeamHandoffRetentionDecision(stats);
    const error = new Error(`ATM_TEAM_HANDOFF_HARD_LIMIT: ${decision.summary}`) as Error & { decision?: TeamHandoffRetentionDecision };
    error.decision = decision;
    throw error;
  }
  const sequence = manifest.transitionCount + 1;
  const previous = manifest.artifacts.at(-1)?.sha256 ?? null;
  const preview = redactPreview(input.redactedPreview);
  const artifact: TeamRoleHandoffArtifact = {
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
  const next: TeamHandoffManifest = {
    ...manifest, transitionCount: sequence,
    artifacts: [...manifest.artifacts, { sequence, file, sha256: hash, previousHandoffSha256: previous }],
    rootHandoffSha256: hash, updatedAt: artifact.createdAt
  };
  atomicWrite(path.join(directory, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`);
  atomicWrite(path.join(directory, 'index.md'), renderTeamHandoffIndex(next, readTeamHandoffArtifacts(directory, next)));
  return { artifact, manifest: next, stats: computeTeamHandoffStats(directory, next) };
}

export function verifyTeamHandoffLedger(cwd: string, taskId: string, teamRunId: string): { ok: boolean; reason: string | null; manifest: TeamHandoffManifest } {
  const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
  return verifyTeamHandoffDirectory(directory, taskId, teamRunId);
}

export function verifyTeamHandoffHistory(cwd: string, taskId: string, teamRunId: string): { ok: boolean; reason: string | null; manifest: TeamHandoffManifest } {
  return verifyTeamHandoffDirectory(teamHandoffHistoryDirectory(cwd, taskId, teamRunId), taskId, teamRunId);
}

export function verifyTeamHandoffDirectory(directory: string, taskId: string, teamRunId: string): { ok: boolean; reason: string | null; manifest: TeamHandoffManifest } {
  const manifest = readTeamHandoffManifest(directory, taskId, teamRunId);
  if (manifest.taskId !== taskId || manifest.teamRunId !== teamRunId) return { ok: false, reason: 'manifest task/run mismatch', manifest };
  let previous: string | null = null;
  for (const [index, entry] of manifest.artifacts.entries()) {
    if (entry.sequence !== index + 1) return { ok: false, reason: `sequence gap at ${entry.file}`, manifest };
    const filePath = path.join(directory, entry.file);
    if (!existsSync(filePath)) return { ok: false, reason: `missing ${entry.file}`, manifest };
    const content = readFileSync(filePath, 'utf8');
    if (sha256(content) !== entry.sha256) return { ok: false, reason: `hash mismatch ${entry.file}`, manifest };
    const artifact = JSON.parse(content) as TeamRoleHandoffArtifact;
    if (artifact.sequence !== entry.sequence || artifact.previousHandoffSha256 !== previous) return { ok: false, reason: `chain mismatch ${entry.file}`, manifest };
    if (artifact.taskId !== taskId || artifact.teamRunId !== teamRunId) return { ok: false, reason: `artifact task/run mismatch ${entry.file}`, manifest };
    previous = entry.sha256;
  }
  if (manifest.transitionCount !== manifest.artifacts.length) return { ok: false, reason: 'transition count mismatch', manifest };
  if (previous !== manifest.rootHandoffSha256) return { ok: false, reason: 'root hash mismatch', manifest };
  const indexPath = path.join(directory, 'index.md');
  if (!existsSync(indexPath)) return { ok: false, reason: 'missing index.md', manifest };
  const index = readFileSync(indexPath, 'utf8');
  const expectedFrontmatter = `manifest_sha256: ${sha256(JSON.stringify(manifest))}`;
  if (!index.includes(`task_id: ${taskId}`) || !index.includes(`team_run_id: ${teamRunId}`) || !index.includes(expectedFrontmatter)) return { ok: false, reason: 'frontmatter mismatch', manifest };
  return { ok: true, reason: null, manifest };
}

export function readTeamHandoffArtifacts(directory: string, manifest: TeamHandoffManifest): TeamRoleHandoffArtifact[] {
  return manifest.artifacts.map((entry) => JSON.parse(readFileSync(path.join(directory, entry.file), 'utf8')) as TeamRoleHandoffArtifact);
}

export function renderTeamHandoffIndex(manifest: TeamHandoffManifest, artifacts: readonly TeamRoleHandoffArtifact[]): string {
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

function readTeamHandoffManifest(directory: string, taskId: string, teamRunId: string): TeamHandoffManifest {
  const manifestPath = path.join(directory, 'manifest.json');
  if (existsSync(manifestPath)) return JSON.parse(readFileSync(manifestPath, 'utf8')) as TeamHandoffManifest;
  const now = new Date().toISOString();
  return { schemaId: 'atm.teamRoleHandoffManifest.v1', taskId, teamRunId, runOutcome: 'running', transitionCount: 0, artifacts: [], rootHandoffSha256: null, createdAt: now, updatedAt: now };
}

function computeTeamHandoffStats(directory: string, manifest: TeamHandoffManifest): TeamHandoffStats {
  const bytes = manifest.artifacts.reduce((total, entry) => total + (existsSync(path.join(directory, entry.file)) ? readFileSync(path.join(directory, entry.file)).byteLength : 0), 0);
  return { transitionCount: manifest.transitionCount, bytes, softLimitReached: manifest.transitionCount >= TEAM_HANDOFF_SOFT_TRANSITIONS || bytes >= TEAM_HANDOFF_SOFT_BYTES, hardLimitReached: manifest.transitionCount >= TEAM_HANDOFF_HARD_TRANSITIONS || bytes >= TEAM_HANDOFF_HARD_BYTES };
}
function atomicWrite(filePath: string, content: string) { const temporary = `${filePath}.${process.pid}.tmp`; writeFileSync(temporary, content, 'utf8'); renameSync(temporary, filePath); }
function sha256(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function firstSentence(value: string) { const sentence = value.match(/^(.+?[.!?](?:\s|$)|.+$)/)?.[1] ?? value; return tokenize(sentence).slice(0, 64).join(' '); }
function tokenize(value: string) { return value.trim().split(/\s+/).filter(Boolean); }
function redactPreview(value: string) { return String(value ?? '').replace(/(?:sk-|AIza|Bearer\s+)[A-Za-z0-9_\-.]+/g, '[REDACTED]').trim(); }
function safeSegment(value: string) { return required(value, 'path').replace(/[^A-Za-z0-9._-]/g, '_'); }
function required(value: unknown, label: string) { const normalized = String(value ?? '').trim(); if (!normalized) throw new Error(`${label} is required.`); return normalized; }
function optional(value: unknown) { const normalized = String(value ?? '').trim(); return normalized || null; }
function positiveInteger(value: unknown, label: string) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`); return parsed; }
