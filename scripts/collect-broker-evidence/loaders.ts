import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrokerEnvelope, BrokerExperimentRun, BrokerRegistryDocument, BrokerRunSummary, GitBoundaryEvidenceEnvelope, RegistryActiveIntent, TeamRun } from './types.ts';
import { isBrokerEnvelope, isBrokerExperimentRun, isBrokerRegistry, isGitBoundaryEvidenceEnvelope, isTeamRun, summarizeEnvelopeRecord, summarizeExperimentRun, summarizeGitBoundaryEvidence, summarizeTeamRun } from './summaries.ts';
import { toCsv } from './strings.ts';

export function loadRunSummaries(runDir: string): BrokerRunSummary[] {
  if (!existsSync(runDir)) {
    return [];
  }
  const rows: BrokerRunSummary[] = [];
  const entries = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of entries) {
    const fullPath = path.join(runDir, fileName);
    try {
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
      let row: BrokerRunSummary | null = null;
      if (isBrokerEnvelope(raw)) {
        row = summarizeEnvelopeRecord(raw as BrokerEnvelope, fileName);
      } else if (isBrokerExperimentRun(raw)) {
        row = summarizeExperimentRun(raw as BrokerExperimentRun);
      }
      if (row) {
        rows.push(row);
      }
    } catch {
      // ignore invalid or malformed run files
    }
  }

  return rows;
}

export function loadTeamRunSummaries(teamRunDir: string | null): BrokerRunSummary[] {
  if (!teamRunDir || !existsSync(teamRunDir)) {
    return [];
  }
  const rows: BrokerRunSummary[] = [];
  const entries = listActiveTeamRunFiles(teamRunDir);

  for (const fullPath of entries) {
    try {
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
      if (!isTeamRun(raw)) {
        continue;
      }
      const row = summarizeTeamRun(raw, fullPath);
      if (row) {
        rows.push(row);
      }
    } catch {
      // ignore invalid or malformed team run files
    }
  }

  return rows;
}

export function summarizeRegistryIntent(intent: RegistryActiveIntent, registryPath: string): BrokerRunSummary | null {
  const taskId = typeof intent.taskId === 'string' ? intent.taskId.trim() : '';
  const actorId = typeof intent.actorId === 'string' ? intent.actorId.trim() : '';
  const admissionState = typeof intent.admission?.state === 'string' ? intent.admission.state.trim() : '';
  if (!taskId || !admissionState || admissionState === 'not-required') {
    return null;
  }
  const files = Array.isArray(intent.resourceKeys?.files)
    ? intent.resourceKeys?.files.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const commit = typeof intent.baseCommit === 'string' ? intent.baseCommit.trim() : '';
  const identity = typeof intent.intentId === 'string' ? intent.intentId.trim() : '';
  return {
    runId: `registry-${taskId}`,
    planId: taskId,
    scenario: 'field',
    tasks: taskId,
    actors: actorId || 'unknown',
    files: toCsv(new Set(files)),
    vendor: 'broker-registry',
    lane: `direct-brokered:${admissionState}`,
    verdict: `recorded:${admissionState}`,
    commits: commit || 'n/a',
    transactions: identity || 'n/a',
    identities: identity || taskId,
    evidence: registryPath.replace(/\\/g, '/')
  };
}

export function loadRegistryAdmissionSummaries(atmRoot: string): BrokerRunSummary[] {
  const registryPath = path.join(atmRoot, '.atm', 'runtime', 'write-broker.registry.json');
  if (!existsSync(registryPath)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as unknown;
    if (!isBrokerRegistry(raw)) {
      return [];
    }
    return (raw.activeIntents ?? [])
      .map((intent) => summarizeRegistryIntent(intent, registryPath))
      .filter((row): row is BrokerRunSummary => Boolean(row));
  } catch {
    return [];
  }
}

export function loadGitBoundaryRunSummaries(atmRoot: string): BrokerRunSummary[] {
  const runDir = path.join(atmRoot, '.atm', 'history', 'evidence', 'git-boundary-runs');
  if (!existsSync(runDir)) {
    return [];
  }
  const rows: BrokerRunSummary[] = [];
  for (const fullPath of readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(runDir, entry.name))
    .sort()) {
    try {
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
      let row: BrokerRunSummary | null = null;
      if (isGitBoundaryEvidenceEnvelope(raw)) {
        row = summarizeGitBoundaryEvidence(raw, fullPath);
      } else if (raw && typeof raw === 'object') {
        const nested = (raw as { evidence?: { gitBoundaryEvidence?: unknown } }).evidence?.gitBoundaryEvidence;
        if (isGitBoundaryEvidenceEnvelope(nested)) {
          row = summarizeGitBoundaryEvidence(nested, fullPath);
        }
      }
      if (row) {
        rows.push(row);
      }
    } catch {
      // ignore malformed evidence files
    }
  }
  return rows;
}

export function listActiveTeamRunFiles(teamRunDir: string): string[] {
  if (!existsSync(teamRunDir)) {
    return [];
  }
  return readdirSync(teamRunDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(teamRunDir, entry.name))
    .sort();
}
