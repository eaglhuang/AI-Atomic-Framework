import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface AtomHealthEntry {
  atomId: string;
  gitEditCount: number;
  policeViolationCount: number;
  driftDetected: boolean;
  lastModified: string | null;
  risk: 'low' | 'medium' | 'high';
}

export interface MapHealthReport {
  schemaId: 'atm.mapHealthReport';
  mapId: string;
  generatedAt: string;
  atomCount: number;
  edgeCount: number;
  atoms: AtomHealthEntry[];
  topBottlenecks: string[];
  topUnstable: string[];
}

export function generateMapHealthReport(
  repositoryRoot: string,
  mapId: string
): MapHealthReport {
  const mapSpecPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');

  if (!existsSync(mapSpecPath)) {
    return {
      schemaId: 'atm.mapHealthReport',
      mapId,
      generatedAt: new Date().toISOString(),
      atomCount: 0,
      edgeCount: 0,
      atoms: [],
      topBottlenecks: [],
      topUnstable: []
    };
  }

  const spec = JSON.parse(readFileSync(mapSpecPath, 'utf-8'));
  const members: Array<{ atomId?: string; id?: string; sourcePath?: string; source?: string }> =
    spec.members ?? [];
  const edges = spec.edges ?? [];

  const atomEntries: AtomHealthEntry[] = [];

  for (const member of members) {
    const atomId = member.atomId ?? member.id ?? 'unknown';
    const sourcePath = member.sourcePath ?? member.source ?? '';

    const gitEditCount = countGitEdits(repositoryRoot, sourcePath);
    const policeViolationCount = countPoliceViolations(repositoryRoot, mapId, atomId);
    const driftDetected = checkFingerprintDrift(repositoryRoot, mapId, atomId);
    const lastModified = getLastModified(repositoryRoot, sourcePath);

    const risk = computeRisk(gitEditCount, policeViolationCount, driftDetected);

    atomEntries.push({
      atomId,
      gitEditCount,
      policeViolationCount,
      driftDetected,
      lastModified,
      risk
    });
  }

  const topBottlenecks = atomEntries
    .filter((a) => a.risk === 'high')
    .sort((a, b) => b.gitEditCount - a.gitEditCount)
    .slice(0, 5)
    .map((a) => a.atomId);

  const topUnstable = atomEntries
    .filter((a) => a.driftDetected || a.policeViolationCount > 0)
    .sort((a, b) => b.policeViolationCount - a.policeViolationCount)
    .slice(0, 5)
    .map((a) => a.atomId);

  return {
    schemaId: 'atm.mapHealthReport',
    mapId,
    generatedAt: new Date().toISOString(),
    atomCount: members.length,
    edgeCount: edges.length,
    atoms: atomEntries,
    topBottlenecks,
    topUnstable
  };
}

function countGitEdits(repositoryRoot: string, sourcePath: string): number {
  if (!sourcePath) return 0;
  try {
    const output = execSync(`git log --follow --oneline -- "${sourcePath}"`, {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return output ? output.split('\n').length : 0;
  } catch {
    return 0;
  }
}

function countPoliceViolations(repositoryRoot: string, mapId: string, atomId: string): number {
  // Check recent police reports for this atom
  const reportsDir = path.join(repositoryRoot, '.atm', 'history', 'reports');
  if (!existsSync(reportsDir)) return 0;

  let count = 0;
  try {
    for (const filename of readdirSync(reportsDir)) {
      if (!filename.endsWith('.json')) continue;
      const filePath = path.join(reportsDir, filename);
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        const findings = content.blockingFindings ?? content.findings ?? [];
        for (const f of findings) {
          if (f.atomId === atomId || f.mapId === mapId) count++;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return count;
}

function checkFingerprintDrift(repositoryRoot: string, mapId: string, _atomId: string): boolean {
  // Check if the map's fingerprint has drifted
  const mapSpecPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');
  if (!existsSync(mapSpecPath)) return false;
  try {
    const spec = JSON.parse(readFileSync(mapSpecPath, 'utf-8'));
    // If fingerprint is marked as stale in the spec
    return spec.semanticFingerprintStatus === 'stale' || spec._fingerprintDrift === true;
  } catch {
    return false;
  }
}

function getLastModified(repositoryRoot: string, sourcePath: string): string | null {
  if (!sourcePath) return null;
  try {
    const output = execSync(`git log --follow -1 --format=%ci -- "${sourcePath}"`, {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function computeRisk(
  gitEditCount: number,
  policeViolationCount: number,
  driftDetected: boolean
): 'low' | 'medium' | 'high' {
  if (driftDetected || policeViolationCount > 0) return 'high';
  if (gitEditCount > 10) return 'high';
  if (gitEditCount > 3) return 'medium';
  return 'low';
}
