import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface LineageTransition {
  timestamp: string;
  fromState: string;
  toState: string;
  triggeredBy?: string;
  evidenceRef?: string;
  [key: string]: unknown;
}

export interface LineageLog {
  schemaId: 'atm.lineageLog';
  mapId: string;
  createdAt: string;
  transitions: LineageTransition[];
}

export interface ReplayLineageResult {
  dryRun: boolean;
  backedUpTo: string | null;
  mapId: string;
  transitionsFound: number;
  transitionsWritten: number;
  outOfOrderFixed: number;
  errors: string[];
}

export function replayLineageFromEvidence(
  repositoryRoot: string,
  mapId: string,
  options: { dryRun?: boolean; backupDir?: string } = {}
): ReplayLineageResult {
  const dryRun = options.dryRun ?? true;
  const backupDir = options.backupDir ?? path.join(repositoryRoot, '.atm', 'rescue-backup');
  const lineageLogPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'lineage-log.json');

  const result: ReplayLineageResult = {
    dryRun,
    backedUpTo: null,
    mapId,
    transitionsFound: 0,
    transitionsWritten: 0,
    outOfOrderFixed: 0,
    errors: []
  };

  // Gather transitions from evidence directories
  const evidenceDirs = [
    path.join(repositoryRoot, '.atm', 'history', 'evidence'),
    path.join(repositoryRoot, '.atm', 'evidence')
  ];

  const transitions: LineageTransition[] = [];

  for (const dir of evidenceDirs) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      if (!filename.endsWith('.json')) continue;
      const filePath = path.join(dir, filename);
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        // Match evidence files that relate to this mapId
        if (content.mapId !== mapId && content.map !== mapId) continue;

        const ts: string = content.timestamp ?? content.createdAt ?? content.completedAt ?? '';
        if (!ts) continue;

        transitions.push({
          timestamp: ts,
          fromState: content.fromState ?? content.previousState ?? 'unknown',
          toState: content.toState ?? content.newState ?? content.status ?? 'unknown',
          triggeredBy: content.triggeredBy ?? content.agentId ?? undefined,
          evidenceRef: path.relative(repositoryRoot, filePath)
        });
      } catch {
        // skip unparseable evidence files
      }
    }
  }

  result.transitionsFound = transitions.length;

  // Sort by timestamp (ascending)
  const sorted = [...transitions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Detect out-of-order fixes
  let lastTs = '';
  for (const t of sorted) {
    if (t.timestamp < lastTs) {
      result.outOfOrderFixed++;
    }
    lastTs = t.timestamp;
  }

  result.transitionsWritten = sorted.length;

  if (!dryRun) {
    // Backup existing lineage-log
    if (existsSync(lineageLogPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `lineage-log.${mapId}.${ts}.json`);
      writeFileSync(backupPath, readFileSync(lineageLogPath));
      result.backedUpTo = backupPath;
    }

    const log: LineageLog = {
      schemaId: 'atm.lineageLog',
      mapId,
      createdAt: sorted.length > 0 ? sorted[0].timestamp : new Date().toISOString(),
      transitions: sorted
    };

    mkdirSync(path.dirname(lineageLogPath), { recursive: true });
    writeFileSync(lineageLogPath, JSON.stringify(log, null, 2) + '\n');
  }

  return result;
}
