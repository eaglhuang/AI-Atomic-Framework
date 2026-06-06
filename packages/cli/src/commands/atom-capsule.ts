import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  type AtomBundle,
  exportAtomCapsule,
  importAtomCapsule,
  validateCidFormat,
  cidToShortId,
  AtomCapsuleError
} from '../../../core/src/registry/atom-capsule.ts';
import {
  loadCapsuleRegistry,
  saveCapsuleRegistry,
  upsertCapsuleEntry,
  linkCapsuleChain,
  markCapsuleRolledBack,
  listAdvisoryCids,
  syncRegistries,
  getGlobalRegistryPath,
  getRepoRegistryPath
} from '../../../core/src/registry/capsule-registry.ts';
import { CliError, makeResult, message } from './shared.ts';

interface CapsuleOptions {
  cwd: string;
  atom?: string;
  name?: string;
  source?: string;
  cid?: string;
  payload?: string;
  vendor: boolean;
  previousCid?: string;
  sourceRef?: string;
  exportedBy?: string;
  inputSchema?: string;
  outputSchema?: string;
  policeConfig?: string;
}

function parseCapsuleArgs(argv: string[]): { action: string; options: CapsuleOptions } {
  const options: CapsuleOptions = {
    cwd: process.cwd(),
    vendor: true
  };
  let action = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !action) {
      action = arg;
      continue;
    }
    if (arg === '--cwd') { options.cwd = argv[++i]; continue; }
    if (arg === '--atom') { options.atom = argv[++i]; continue; }
    if (arg === '--name') { options.name = argv[++i]; continue; }
    if (arg === '--source') { options.source = argv[++i]; continue; }
    if (arg === '--cid') { options.cid = argv[++i]; continue; }
    if (arg === '--payload') { options.payload = argv[++i]; continue; }
    if (arg === '--no-vendor') { options.vendor = false; continue; }
    if (arg === '--previous-cid') { options.previousCid = argv[++i]; continue; }
    if (arg === '--source-ref') { options.sourceRef = argv[++i]; continue; }
    if (arg === '--exported-by') { options.exportedBy = argv[++i]; continue; }
  }

  if (!action) {
    throw new CliError('ATM_CLI_USAGE', 'Usage: atm atom-capsule <export|import|rollback|advisories> [options]', { exitCode: 2 });
  }
  return { action, options };
}

export async function runAtomCapsule(argv: string[]) {
  const { action, options } = parseCapsuleArgs(argv);
  const cwd = path.resolve(options.cwd);

  switch (action) {
    case 'export':
      return runExport(cwd, options);
    case 'import':
      return runImport(cwd, options);
    case 'rollback':
      return runRollback(cwd, options);
    case 'advisories':
      return runAdvisories(cwd, options);
    default:
      throw new CliError(
        'ATM_CLI_USAGE',
        `Unknown action "${action}". Usage: atm atom-capsule <export|import|rollback|advisories> [options]`,
        { exitCode: 2 }
      );
  }
}

async function runExport(cwd: string, options: CapsuleOptions) {
  const atomId = options.atom ?? '';
  const humanName = options.name ?? atomId;
  const sourceFile = options.source ?? '';
  const previousCid = options.previousCid ?? null;

  if (!atomId) {
    throw new CliError('ATM_CLI_USAGE', 'atom-capsule export requires --atom <id>', { exitCode: 2 });
  }
  if (!sourceFile || !existsSync(path.resolve(cwd, sourceFile))) {
    throw new CliError('ATM_CLI_USAGE', 'atom-capsule export requires --source <path-to-source-file>', { exitCode: 2 });
  }

  const sourceCode = readFileSync(path.resolve(cwd, sourceFile), 'utf-8');
  const bundle: AtomBundle = {
    canonicalSourceCode: sourceCode,
    inputSchema: null,
    outputSchema: null,
    policeConfig: null
  };

  const capsule = exportAtomCapsule(bundle);
  const shortId = cidToShortId(capsule.cid);

  // Write to Capsule Registry (global + repo)
  const globalRegistryPath = getGlobalRegistryPath();
  const repoRegistryPath = getRepoRegistryPath(cwd);
  const globalRegistry = loadCapsuleRegistry(globalRegistryPath);
  const repoRegistry = loadCapsuleRegistry(repoRegistryPath);

  const entry = {
    atomId,
    humanName,
    sourceRef: options.sourceRef,
    exportedAt: new Date().toISOString(),
    exportedBy: options.exportedBy ?? 'unknown',
    previousCid,
    storageLocations: [] as string[]
  };

  upsertCapsuleEntry(globalRegistry, capsule.cid, entry);
  upsertCapsuleEntry(repoRegistry, capsule.cid, entry);

  if (previousCid) {
    linkCapsuleChain(globalRegistry, previousCid, capsule.cid);
    linkCapsuleChain(repoRegistry, previousCid, capsule.cid);
  }

  saveCapsuleRegistry(globalRegistry, globalRegistryPath);
  saveCapsuleRegistry(repoRegistry, repoRegistryPath);

  return makeResult({
    ok: true,
    command: 'atom-capsule',
    cwd,
    messages: [
      message('info', 'ATM_CAPSULE_EXPORT_OK', `Atom capsule exported successfully.`, {
        atomId,
        cid: capsule.cid,
        shortId
      })
    ],
    evidence: {
      atomId,
      cid: capsule.cid,
      shortId,
      compressedPayload: capsule.compressedPayload,
      previousCid,
      registryUpdated: true
    }
  });
}

async function runImport(cwd: string, options: CapsuleOptions) {
  const cid = options.cid ?? '';
  const payload = options.payload ?? '';
  const vendor = options.vendor;

  if (!cid) {
    throw new CliError('ATM_CLI_USAGE', 'atom-capsule import requires --cid <cid>', { exitCode: 2 });
  }
  if (!payload) {
    throw new CliError('ATM_CLI_USAGE', 'atom-capsule import requires --payload <base64-brotli-payload>', { exitCode: 2 });
  }

  validateCidFormat(cid);

  let importResult;
  try {
    importResult = importAtomCapsule(cid, payload, { repositoryRoot: cwd, vendorDir: vendor ? undefined : undefined });
  } catch (err) {
    if (err instanceof AtomCapsuleError) {
      throw new CliError(err.code, err.message, { details: err.details });
    }
    throw err;
  }

  // Update registry
  const globalRegistryPath = getGlobalRegistryPath();
  const repoRegistryPath = getRepoRegistryPath(cwd);
  const globalRegistry = loadCapsuleRegistry(globalRegistryPath);
  const repoRegistry = loadCapsuleRegistry(repoRegistryPath);

  const storageLocations = [importResult.bundlePath];
  const globalEntry = globalRegistry.entries[cid];
  if (globalEntry) {
    for (const loc of storageLocations) {
      if (!globalEntry.storageLocations.includes(loc)) {
        globalEntry.storageLocations.push(loc);
      }
    }
  } else {
    upsertCapsuleEntry(globalRegistry, cid, {
      atomId: cid,
      humanName: cidToShortId(cid),
      storageLocations
    });
  }

  syncRegistries(globalRegistry, repoRegistry, cwd);
  saveCapsuleRegistry(globalRegistry, globalRegistryPath);
  saveCapsuleRegistry(repoRegistry, repoRegistryPath);

  return makeResult({
    ok: true,
    command: 'atom-capsule',
    cwd,
    messages: [
      message('info', 'ATM_CAPSULE_IMPORT_OK', `Atom capsule imported and verified.`, {
        cid,
        fromCache: importResult.fromCache,
        warnings: importResult.warnings
      })
    ],
    evidence: {
      cid,
      bundlePath: importResult.bundlePath,
      verified: importResult.verified,
      fromCache: importResult.fromCache,
      warnings: importResult.warnings
    }
  });
}

async function runRollback(cwd: string, options: CapsuleOptions) {
  const cid = options.cid ?? '';
  if (!cid) {
    throw new CliError('ATM_CLI_USAGE', 'atom-capsule rollback requires --cid <cid>', { exitCode: 2 });
  }
  validateCidFormat(cid);

  const globalRegistryPath = getGlobalRegistryPath();
  const globalRegistry = loadCapsuleRegistry(globalRegistryPath);
  const entry = globalRegistry.entries[cid];

  if (!entry) {
    throw new CliError('ATM_CAPSULE_NOT_FOUND', `No registry entry found for CID: ${cid}`, { exitCode: 1 });
  }
  if (!entry.previousCid) {
    throw new CliError('ATM_CAPSULE_NO_PREVIOUS', `CID ${cid} has no previousCid; cannot rollback.`, { exitCode: 1 });
  }

  markCapsuleRolledBack(globalRegistry, cid);
  saveCapsuleRegistry(globalRegistry, globalRegistryPath);

  const repoRegistryPath = getRepoRegistryPath(cwd);
  if (existsSync(repoRegistryPath)) {
    const repoRegistry = loadCapsuleRegistry(repoRegistryPath);
    markCapsuleRolledBack(repoRegistry, cid);
    saveCapsuleRegistry(repoRegistry, repoRegistryPath);
  }

  return makeResult({
    ok: true,
    command: 'atom-capsule',
    cwd,
    messages: [
      message('info', 'ATM_CAPSULE_ROLLBACK_OK', `Capsule rolled back. Use previousCid to restore.`, {
        cid,
        previousCid: entry.previousCid
      })
    ],
    evidence: {
      cid,
      previousCid: entry.previousCid,
      action: 'rolled-back'
    }
  });
}

async function runAdvisories(cwd: string, _options: CapsuleOptions) {
  const globalRegistryPath = getGlobalRegistryPath();
  const globalRegistry = loadCapsuleRegistry(globalRegistryPath);
  const advisoryCids = listAdvisoryCids(globalRegistry);

  return makeResult({
    ok: advisoryCids.length === 0,
    command: 'atom-capsule',
    cwd,
    messages: [
      advisoryCids.length === 0
        ? message('info', 'ATM_CAPSULE_ADVISORIES_CLEAR', 'No advisory CIDs found in capsule registry.')
        : message('warn', 'ATM_CAPSULE_ADVISORIES_FOUND', `${advisoryCids.length} advisory CID(s) found.`, { advisoryCids })
    ],
    evidence: {
      advisoryCids,
      count: advisoryCids.length,
      entries: advisoryCids.map((cid) => ({
        cid,
        entry: globalRegistry.entries[cid]
      }))
    }
  });
}
