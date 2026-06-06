import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runRescuePolice } from '../police/rescue-family.ts';
import { rebuildCapsuleRegistry, rebuildMapRegistry } from './registry-rebuilder.ts';
import { reloadAtomsFromCapsules } from './atom-reloader.ts';
import { replayLineageFromEvidence } from './lineage-replayer.ts';

export interface DiagnoseReport {
  schemaId: 'atm.rescueDiagnoseReport';
  checkedAt: string;
  repositoryRoot: string;
  healthScore: number;
  criticalFindings: Array<{ invariantId: string; description: string; recoveryHint: string }>;
  recommendedActions: string[];
  recoverableData: {
    atomsFromCapsule: number;
    mapsFromVendor: number;
    lineageMaps: string[];
  };
}

export interface ClearCacheResult {
  dryRun: boolean;
  clearedPaths: string[];
  errors: string[];
}

export interface FactoryResetResult {
  dryRun: boolean;
  backedUpTo: string;
  clearedPaths: string[];
  errors: string[];
}

export function diagnoseRecovery(repositoryRoot: string): DiagnoseReport {
  const rescueReport = runRescuePolice(repositoryRoot);
  const total = rescueReport.findings.length;
  const blocking = rescueReport.blockingFindings.length;
  const healthScore = total === 0 ? 1.0 : Math.max(0, (total - blocking) / total);

  const criticalFindings = rescueReport.blockingFindings.map((f) => ({
    invariantId: f.invariantId,
    description: f.description,
    recoveryHint: f.recoveryHint
  }));

  // Enumerate recoverable data
  const vendorDir = path.join(repositoryRoot, 'vendor', 'atoms');
  const atomsFromCapsule = existsSync(vendorDir)
    ? readdirSync(vendorDir).filter((f) => f.endsWith('.json') && f !== 'capsule-registry.json').length
    : 0;

  const vendorMapsDir = path.join(repositoryRoot, 'vendor', 'maps');
  const mapsFromVendor = existsSync(vendorMapsDir)
    ? readdirSync(vendorMapsDir).filter((f) => f.endsWith('.json') && f !== 'map-registry.json').length
    : 0;

  const mapsDir = path.join(repositoryRoot, 'atomic_workbench', 'maps');
  const lineageMaps: string[] = existsSync(mapsDir)
    ? readdirSync(mapsDir).filter((mapId) => {
        const evidenceDirs = [
          path.join(repositoryRoot, '.atm', 'history', 'evidence'),
          path.join(repositoryRoot, '.atm', 'evidence')
        ];
        return evidenceDirs.some((d) => existsSync(d) && readdirSync(d).some((f) => {
          try {
            const c = JSON.parse(readFileSync(path.join(d, f), 'utf-8'));
            return c.mapId === mapId || c.map === mapId;
          } catch { return false; }
        }));
      })
    : [];

  const recommendedActions: string[] = [];
  if (blocking > 0) {
    recommendedActions.push('node atm.mjs rescue rebuild-registry --dry-run --json');
    recommendedActions.push('node atm.mjs rescue reload-atoms --dry-run --json');
  }
  if (rescueReport.warnings.length > 0) {
    recommendedActions.push('node atm.mjs rescue rebuild-maps --dry-run --json');
  }

  return {
    schemaId: 'atm.rescueDiagnoseReport',
    checkedAt: new Date().toISOString(),
    repositoryRoot,
    healthScore,
    criticalFindings,
    recommendedActions,
    recoverableData: { atomsFromCapsule, mapsFromVendor, lineageMaps }
  };
}

export function clearCache(
  repositoryRoot: string,
  options: { dryRun?: boolean } = {}
): ClearCacheResult {
  const dryRun = options.dryRun ?? true;

  const cachePaths = [
    path.join(repositoryRoot, '.atm-guide-cache'),
    path.join(repositoryRoot, '.atm-cache'),
    path.join(repositoryRoot, '.atm', 'daemon', 'notifications.jsonl')
  ];

  const result: ClearCacheResult = {
    dryRun,
    clearedPaths: [],
    errors: []
  };

  for (const p of cachePaths) {
    if (!existsSync(p)) continue;
    if (!dryRun) {
      try {
        rmSync(p, { recursive: true, force: true });
        result.clearedPaths.push(p);
      } catch (err) {
        result.errors.push(`Failed to clear ${p}: ${err}`);
      }
    } else {
      result.clearedPaths.push(p);
    }
  }

  return result;
}

export function factoryReset(
  repositoryRoot: string,
  options: {
    dryRun?: boolean;
    confirm?: boolean;
    iUnderstandThisDeletesState?: boolean;
    backupDir?: string;
  } = {}
): FactoryResetResult {
  const dryRun = options.dryRun ?? true;

  const result: FactoryResetResult = {
    dryRun,
    backedUpTo: '',
    clearedPaths: [],
    errors: []
  };

  if (!dryRun && (!options.confirm || !options.iUnderstandThisDeletesState)) {
    result.errors.push(
      'factory-reset requires both --confirm and --i-understand-this-deletes-state flags. ' +
      'This operation deletes all ATM derived state. Refusing without explicit double confirmation.'
    );
    return result;
  }

  const backupDir = options.backupDir ?? path.join(repositoryRoot, '.atm', 'rescue-backup');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(backupDir, `factory-reset.${ts}`);

  // Paths to clear (derived state only — never source or evidence)
  const derivedPaths = [
    path.join(repositoryRoot, '.atm', 'runtime'),
    path.join(repositoryRoot, '.atm', 'daemon'),
    path.join(repositoryRoot, '.atm-guide-cache'),
    path.join(repositoryRoot, '.atm-cache'),
    path.join(repositoryRoot, 'vendor', 'atoms', 'capsule-registry.json'),
    path.join(repositoryRoot, 'vendor', 'maps', 'map-registry.json'),
    path.join(repositoryRoot, 'atomic-registry.json')
  ];

  // Map lineage-log files are derived from evidence — include them
  const mapsDir = path.join(repositoryRoot, 'atomic_workbench', 'maps');
  if (existsSync(mapsDir)) {
    for (const mapId of readdirSync(mapsDir)) {
      const logPath = path.join(mapsDir, mapId, 'lineage-log.json');
      if (existsSync(logPath)) {
        derivedPaths.push(logPath);
      }
    }
  }

  for (const p of derivedPaths) {
    if (!existsSync(p)) continue;
    if (!dryRun) {
      try {
        // Backup before clearing
        const relPath = path.relative(repositoryRoot, p);
        const backupTarget = path.join(backupRoot, relPath);
        mkdirSync(path.dirname(backupTarget), { recursive: true });
        if (readFileSync(p)) {
          writeFileSync(backupTarget, readFileSync(p));
        }
        rmSync(p, { recursive: true, force: true });
        result.clearedPaths.push(p);
      } catch (err) {
        result.errors.push(`Failed to process ${p}: ${err}`);
      }
    } else {
      result.clearedPaths.push(p);
    }
  }

  if (!dryRun) {
    result.backedUpTo = backupRoot;
  }

  return result;
}

export {
  rebuildCapsuleRegistry,
  rebuildMapRegistry,
  reloadAtomsFromCapsules,
  replayLineageFromEvidence
};
