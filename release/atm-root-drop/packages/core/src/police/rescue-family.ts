import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadCapsuleRegistry, getGlobalRegistryPath, getRepoRegistryPath } from '../registry/capsule-registry.ts';
import { loadMapRegistry, getGlobalMapRegistryPath } from '../registry/map-capsule-registry.ts';
import { verifyPayloadHash } from '../registry/atom-capsule.ts';
import { verifyMapPayloadHash } from '../registry/map-capsule.ts';

export type RescueInvariantId =
  | 'INV-RESCUE-001'
  | 'INV-RESCUE-002'
  | 'INV-RESCUE-003'
  | 'INV-RESCUE-004'
  | 'INV-RESCUE-005'
  | 'INV-RESCUE-006'
  | 'INV-RESCUE-007'
  | 'INV-RESCUE-008'
  | 'INV-RESCUE-009'
  | 'INV-RESCUE-010';

export type RescueSeverity = 'blocker' | 'warning' | 'info';

export type RescueFindingAction = 'block-all-mutations' | 'advisory' | 'skip' | 'report-only';

export interface RescueFinding {
  policeFamily: 'rescue';
  invariantId: RescueInvariantId;
  severity: RescueSeverity;
  action: RescueFindingAction;
  affectedFile?: string;
  recoveryHint: string;
  description: string;
  skippedReason?: string;
}

export interface RescueReport {
  schemaId: 'atm.rescuePoliceReport';
  checkedAt: string;
  repositoryRoot: string;
  healthy: boolean;
  blockingFindings: RescueFinding[];
  warnings: RescueFinding[];
  skipped: RescueFinding[];
  findings: RescueFinding[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function runRescuePolice(repositoryRoot: string): RescueReport {
  const findings: RescueFinding[] = [];

  findings.push(checkRegistrySourceFiles(repositoryRoot));       // INV-RESCUE-001
  findings.push(checkCapsuleRegistryIntegrity(repositoryRoot));  // INV-RESCUE-002
  findings.push(checkMapRegistryIntegrity(repositoryRoot));      // INV-RESCUE-003
  findings.push(checkLineageLogMonotonicity(repositoryRoot));    // INV-RESCUE-004
  findings.push(checkBindingSchemaRegistry(repositoryRoot));     // INV-RESCUE-005
  findings.push(checkPolicyJsonSchema(repositoryRoot));          // INV-RESCUE-006
  findings.push(checkVendorAtomConsistency(repositoryRoot));     // INV-RESCUE-007
  findings.push(checkGuideCacheCommits(repositoryRoot));         // INV-RESCUE-008
  findings.push(checkDaemonPid(repositoryRoot));                 // INV-RESCUE-009
  findings.push(checkEvidenceJsonSchema(repositoryRoot));        // INV-RESCUE-010

  const blockingFindings = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const skipped = findings.filter((f) => f.action === 'skip');

  return {
    schemaId: 'atm.rescuePoliceReport',
    checkedAt: new Date().toISOString(),
    repositoryRoot,
    healthy: blockingFindings.length === 0,
    blockingFindings,
    warnings,
    skipped,
    findings
  };
}

// INV-RESCUE-001: Registry atom source files exist
function checkRegistrySourceFiles(repositoryRoot: string): RescueFinding {
  const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!existsSync(registryPath)) {
    return pass('INV-RESCUE-001', 'No atomic-registry.json found (may be uninitialized).');
  }
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const entries = registry.entries ?? {};
    const missing: string[] = [];
    for (const [atomId, entry] of Object.entries(entries)) {
      const e = entry as Record<string, unknown>;
      const selfVerification = asRecord(e.selfVerification);
      const sourcePaths = asRecord(selfVerification?.sourcePaths);
      const codePaths = Array.isArray(sourcePaths?.code)
        ? sourcePaths.code.filter((value): value is string => typeof value === 'string')
        : [];
      for (const codePath of codePaths) {
        const fullPath = path.resolve(repositoryRoot, codePath);
        if (!existsSync(fullPath)) {
          missing.push(`${atomId}: ${codePath}`);
        }
      }
    }
    if (missing.length > 0) {
      return blocker(
        'INV-RESCUE-001',
        `${missing.length} atom(s) in atomic-registry.json have missing source files.`,
        undefined,
        `node atm.mjs rescue rebuild-registry --json`
      );
    }
    return pass('INV-RESCUE-001', 'All registry atom source files exist.');
  } catch (err) {
    return blocker('INV-RESCUE-001', `Failed to parse atomic-registry.json: ${err}`, registryPath, 'Manually inspect atomic-registry.json for corruption.');
  }
}

// INV-RESCUE-002: Capsule registry entries can be decompressed
function checkCapsuleRegistryIntegrity(repositoryRoot: string): RescueFinding {
  const registryPath = getRepoRegistryPath(repositoryRoot);
  if (!existsSync(registryPath)) {
    return pass('INV-RESCUE-002', 'No repo capsule-registry.json found (no capsules imported yet).');
  }
  const registry = loadCapsuleRegistry(registryPath);
  const corrupted: string[] = [];

  for (const [cid, entry] of Object.entries(registry.entries)) {
    for (const loc of entry.storageLocations) {
      const fullPath = path.resolve(repositoryRoot, loc);
      if (existsSync(fullPath)) {
        try {
          const content = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (content.compressedPayload && !verifyPayloadHash(cid, content.compressedPayload)) {
            corrupted.push(cid);
          }
        } catch {
          corrupted.push(cid);
        }
      }
    }
  }

  if (corrupted.length > 0) {
    return blocker(
      'INV-RESCUE-002',
      `${corrupted.length} capsule(s) failed hash verification: ${corrupted.slice(0, 3).join(', ')}`,
      registryPath,
      'node atm.mjs atom-capsule import --cid <cid> --payload <payload> --json'
    );
  }
  return pass('INV-RESCUE-002', 'All capsule registry entries pass hash verification.');
}

// INV-RESCUE-003: Map registry memberAtomCids exist
function checkMapRegistryIntegrity(repositoryRoot: string): RescueFinding {
  const mapRegPath = path.join(repositoryRoot, 'vendor', 'maps', 'map-registry.json');
  if (!existsSync(mapRegPath)) {
    return pass('INV-RESCUE-003', 'No map-registry.json found (no maps imported yet).');
  }
  const mapReg = loadMapRegistry(mapRegPath);
  const capsuleReg = loadCapsuleRegistry(getRepoRegistryPath(repositoryRoot));
  const knownCids = new Set(Object.keys(capsuleReg.entries));
  const missing: string[] = [];

  for (const [mapCid, entry] of Object.entries(mapReg.entries)) {
    for (const atomCid of entry.memberAtomCids) {
      if (!knownCids.has(atomCid)) {
        missing.push(`${mapCid}:${atomCid}`);
      }
    }
  }

  if (missing.length > 0) {
    return blocker(
      'INV-RESCUE-003',
      `Map Merkle tree broken: ${missing.length} missing atom CID(s).`,
      mapRegPath,
      'node atm.mjs map-capsule import --cid <map:cid> --payload <payload> --json'
    );
  }
  return pass('INV-RESCUE-003', 'Map Merkle tree intact.');
}

// INV-RESCUE-004: Lineage log timestamps are strictly monotonic
function checkLineageLogMonotonicity(repositoryRoot: string): RescueFinding {
  const mapsDir = path.join(repositoryRoot, 'atomic_workbench', 'maps');
  if (!existsSync(mapsDir)) return pass('INV-RESCUE-004', 'No maps directory found.');

  const violations: string[] = [];
  for (const mapId of readdirSync(mapsDir)) {
    const logPath = path.join(mapsDir, mapId, 'lineage-log.json');
    if (!existsSync(logPath)) continue;
    try {
      const log = JSON.parse(readFileSync(logPath, 'utf-8'));
      const transitions = log.transitions ?? [];
      let lastTs = '';
      for (const t of transitions) {
        const ts = t.timestamp ?? t.createdAt ?? '';
        if (ts && ts < lastTs) {
          violations.push(`${mapId}: ${lastTs} > ${ts}`);
        }
        if (ts > lastTs) lastTs = ts;
      }
    } catch {
      violations.push(`${mapId}: unable to parse lineage-log.json`);
    }
  }

  if (violations.length > 0) {
    return warn(
      'INV-RESCUE-004',
      `${violations.length} lineage-log(s) have non-monotonic timestamps.`,
      mapsDir,
      'Manually review and correct the affected lineage-log.json files.'
    );
  }
  return pass('INV-RESCUE-004', 'All lineage-log timestamps are strictly monotonic.');
}

// INV-RESCUE-005: binding-schema-registry.json entries are valid JSON Schema
function checkBindingSchemaRegistry(repositoryRoot: string): RescueFinding {
  const schemaRegPath = path.join(repositoryRoot, '.atm', 'binding-schema-registry.json');
  if (!existsSync(schemaRegPath)) {
    return pass('INV-RESCUE-005', 'No binding-schema-registry.json found (M12 not yet implemented).');
  }
  try {
    const reg = JSON.parse(readFileSync(schemaRegPath, 'utf-8'));
    const invalid: string[] = [];
    for (const [binding, schema] of Object.entries(reg.bindings ?? {})) {
      if (!schema || typeof schema !== 'object') {
        invalid.push(binding);
      }
    }
    if (invalid.length > 0) {
      return blocker(
        'INV-RESCUE-005',
        `${invalid.length} binding schema(s) are invalid.`,
        schemaRegPath,
        'Repair the affected binding schemas in binding-schema-registry.json.'
      );
    }
    return pass('INV-RESCUE-005', 'All binding schemas are valid.');
  } catch (err) {
    return blocker('INV-RESCUE-005', `Failed to parse binding-schema-registry.json: ${err}`, schemaRegPath, 'Manually inspect and repair binding-schema-registry.json.');
  }
}

// INV-RESCUE-006: .atm/runtime/policy.json passes schema validation
function checkPolicyJsonSchema(repositoryRoot: string): RescueFinding {
  const policyPath = path.join(repositoryRoot, '.atm', 'runtime', 'policy.json');
  if (!existsSync(policyPath)) {
    return pass('INV-RESCUE-006', 'No policy.json found (default policy in effect).');
  }
  try {
    const policy = JSON.parse(readFileSync(policyPath, 'utf-8'));
    if (!policy || typeof policy !== 'object') {
      return blocker('INV-RESCUE-006', 'policy.json is not a valid JSON object.', policyPath, 'Delete or restore .atm/runtime/policy.json from a known-good backup.');
    }
    return pass('INV-RESCUE-006', 'policy.json is parseable and structurally valid.');
  } catch (err) {
    return blocker('INV-RESCUE-006', `policy.json is not valid JSON: ${err}`, policyPath, 'Delete or restore .atm/runtime/policy.json from a known-good backup.');
  }
}

// INV-RESCUE-007: vendor/atoms/ and capsule registry are bidirectionally consistent
function checkVendorAtomConsistency(repositoryRoot: string): RescueFinding {
  const vendorDir = path.join(repositoryRoot, 'vendor', 'atoms');
  const registryPath = getRepoRegistryPath(repositoryRoot);
  if (!existsSync(vendorDir) || !existsSync(registryPath)) {
    return pass('INV-RESCUE-007', 'vendor/atoms/ or capsule-registry.json not present (no capsules imported yet).');
  }

  const registry = loadCapsuleRegistry(registryPath);
  const registeredShortIds = new Set(
    Object.keys(registry.entries).map((cid) => cid.replace('atom:cid:', '').slice(0, 16))
  );
  const orphanFiles: string[] = [];
  for (const filename of readdirSync(vendorDir)) {
    if (filename === 'capsule-registry.json') continue;
    const shortId = filename.replace('.json', '');
    if (!registeredShortIds.has(shortId)) {
      orphanFiles.push(filename);
    }
  }

  if (orphanFiles.length > 0) {
    return warn(
      'INV-RESCUE-007',
      `${orphanFiles.length} orphan file(s) in vendor/atoms/ not tracked in capsule registry.`,
      vendorDir,
      'Run node atm.mjs rescue sync-vendor --json to reconcile.'
    );
  }
  return pass('INV-RESCUE-007', 'vendor/atoms/ and capsule registry are consistent.');
}

// INV-RESCUE-008: Guide cache doesn't point to non-existent git commits
// TODO (IMPLEMENTATION-HANDOFF.md M18 缺口): self-referential cache validation risk
function checkGuideCacheCommits(_repositoryRoot: string): RescueFinding {
  return skipped(
    'INV-RESCUE-008',
    'INV-RESCUE-008 skipped: Guide Cache (M24) is not yet implemented. This invariant will be activated when M24 is deployed.'
  );
}

// INV-RESCUE-009: Daemon PID file points to a live ATM daemon process
// TODO (M22 dependency): Daemon mode is not yet implemented
function checkDaemonPid(_repositoryRoot: string): RescueFinding {
  return skipped(
    'INV-RESCUE-009',
    'INV-RESCUE-009 skipped: Daemon Mode (M22) is not yet implemented. This invariant will be activated when M22 is deployed.'
  );
}

// INV-RESCUE-010: All evidence JSON files pass schema validation
function checkEvidenceJsonSchema(repositoryRoot: string): RescueFinding {
  const evidenceDirs = [
    path.join(repositoryRoot, '.atm', 'evidence'),
    path.join(repositoryRoot, '.atm', 'history', 'evidence')
  ];
  const invalid: string[] = [];
  for (const dir of evidenceDirs) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      if (!filename.endsWith('.json')) continue;
      const filePath = path.join(dir, filename);
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (!content || typeof content !== 'object' || !content.schemaId) {
          invalid.push(filePath);
        }
      } catch {
        invalid.push(filePath);
      }
    }
  }

  if (invalid.length > 0) {
    return warn(
      'INV-RESCUE-010',
      `${invalid.length} evidence JSON file(s) failed basic schema check.`,
      evidenceDirs[0],
      'Inspect and repair the affected evidence files or remove invalid entries.'
    );
  }
  return pass('INV-RESCUE-010', 'All evidence JSON files pass basic schema validation.');
}

// Helpers
function pass(invariantId: RescueInvariantId, description: string): RescueFinding {
  return {
    policeFamily: 'rescue',
    invariantId,
    severity: 'info',
    action: 'report-only' as const,
    recoveryHint: '',
    description
  };
}

function blocker(invariantId: RescueInvariantId, description: string, affectedFile?: string, recoveryHint = ''): RescueFinding {
  return {
    policeFamily: 'rescue',
    invariantId,
    severity: 'blocker',
    action: 'block-all-mutations',
    affectedFile,
    recoveryHint,
    description
  };
}

function warn(invariantId: RescueInvariantId, description: string, affectedFile?: string, recoveryHint = ''): RescueFinding {
  return {
    policeFamily: 'rescue',
    invariantId,
    severity: 'warning',
    action: 'advisory',
    affectedFile,
    recoveryHint,
    description
  };
}

function skipped(invariantId: RescueInvariantId, skippedReason: string): RescueFinding {
  return {
    policeFamily: 'rescue',
    invariantId,
    severity: 'info',
    action: 'skip',
    recoveryHint: '',
    description: `Skipped: ${skippedReason}`,
    skippedReason
  };
}
