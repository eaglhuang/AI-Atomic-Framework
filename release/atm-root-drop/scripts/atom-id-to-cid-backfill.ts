import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAtomCid } from '../packages/core/src/registry/atom-capsule.ts';

interface AtomBundle {
  canonicalSourceCode: string;
  inputSchema: unknown;
  outputSchema: unknown;
  policeConfig: unknown;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Helper to recursively collect all files under a directory
function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  if (!existsSync(dir)) return [];
  const list = readdirSync(dir);
  for (const file of list) {
    if (file === '.git' || file === 'node_modules' || file === '.atm' || file === '.atm-temp') continue;
    const fullPath = path.join(dir, file);
    const stat = statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// Get directory prefix before any glob character
function getBaseDir(pattern: string): string {
  const parts = pattern.split('/');
  const baseParts: string[] = [];
  for (const part of parts) {
    if (part.includes('*') || part.includes('?')) break;
    baseParts.push(part);
  }
  return baseParts.length > 0 ? baseParts.join('/') : '.';
}

// Convert glob pattern to deterministic RegExp
function globToRegex(pattern: string): RegExp {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  escaped = escaped.replace(/\*\*/g, '.*');
  escaped = escaped.replace(/\*(?!\*)/g, '[^/]*');
  return new RegExp('^' + escaped + '$');
}

// Resolve the first deterministic file matching the glob pattern
function resolveGlobFirstFile(pattern: string): string | null {
  const resolvedPath = path.resolve(root, pattern);
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return existsSync(resolvedPath) && statSync(resolvedPath).isFile() ? pattern : null;
  }
  const baseDirPart = getBaseDir(pattern);
  const baseDirResolved = path.resolve(root, baseDirPart);
  if (!existsSync(baseDirResolved)) return null;

  const allFiles = getAllFiles(baseDirResolved).map(f => {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    return rel;
  });

  const regex = globToRegex(pattern);
  const matched = allFiles.filter(f => regex.test(f));
  if (matched.length === 0) return null;
  matched.sort();
  return matched[0];
}

function main() {
  const isWrite = process.argv.includes('--write');
  const isJsonOutput = process.argv.includes('--json');

  const pathToAtomMapPath = path.resolve(root, 'atomic_workbench/atomization-coverage/path-to-atom-map.json');
  if (!existsSync(pathToAtomMapPath)) {
    console.error(`[backfill] Error: path-to-atom-map.json not found at ${pathToAtomMapPath}`);
    process.exit(1);
  }

  const mapData = JSON.parse(readFileSync(pathToAtomMapPath, 'utf8'));
  const mappingsList = mapData.mappings || [];

  // Group path patterns by atom_id
  const atomGroups = new Map<string, string[]>();
  for (const mapping of mappingsList) {
    const { atom_id, path_pattern } = mapping;
    if (!atom_id || !path_pattern) continue;
    if (!atomGroups.has(atom_id)) {
      atomGroups.set(atom_id, []);
    }
    atomGroups.get(atom_id)!.push(path_pattern);
  }

  const resultMappings: Array<{ atom_id: string; atom_cid: string; sourcePath: string }> = [];
  const failures: string[] = [];

  // Process each unique atom_id
  const sortedAtomIds = Array.from(atomGroups.keys()).sort();
  for (const atomId of sortedAtomIds) {
    const patterns = atomGroups.get(atomId)!;
    let resolvedSourcePath: string | null = null;

    // 1. Try non-glob patterns first
    for (const pattern of patterns) {
      if (!pattern.includes('*') && !pattern.includes('?')) {
        const resolved = resolveGlobFirstFile(pattern);
        if (resolved) {
          resolvedSourcePath = resolved;
          break;
        }
      }
    }

    // 2. Fallback to glob patterns
    if (!resolvedSourcePath) {
      for (const pattern of patterns) {
        const resolved = resolveGlobFirstFile(pattern);
        if (resolved) {
          resolvedSourcePath = resolved;
          break;
        }
      }
    }

    if (!resolvedSourcePath) {
      // Generate a deterministic placeholder CID for unattached atoms
      const sourcePath = `placeholder:unattached/${atomId}`;
      const sourceContent = `placeholder:unattached atom capsule for ${atomId}`;
      const bundle: AtomBundle = {
        canonicalSourceCode: sourceContent,
        inputSchema: null,
        outputSchema: null,
        policeConfig: null
      };
      const atomCid = computeAtomCid(bundle);
      resultMappings.push({
        atom_id: atomId,
        atom_cid: atomCid,
        sourcePath
      });
      continue;
    }

    // Read source code and compute CID
    try {
      const fullSourcePath = path.resolve(root, resolvedSourcePath);
      const sourceContent = readFileSync(fullSourcePath, 'utf8');
      const bundle: AtomBundle = {
        canonicalSourceCode: sourceContent,
        inputSchema: null,
        outputSchema: null,
        policeConfig: null
      };
      const atomCid = computeAtomCid(bundle);
      resultMappings.push({
        atom_id: atomId,
        atom_cid: atomCid,
        sourcePath: resolvedSourcePath
      });
    } catch (err) {
      console.error(`[backfill] Error processing ${atomId} via ${resolvedSourcePath}:`, err);
      failures.push(atomId);
    }
  }

  const outputObj = {
    schemaVersion: 'atm.atomIdToCid.v1',
    generatedAt: new Date().toISOString(),
    mappings: resultMappings
  };

  if (isWrite) {
    const outputPath = path.resolve(root, 'atomic_workbench/atomization-coverage/atom-id-to-cid.json');
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(outputObj, null, 2) + '\n', 'utf8');
    if (!isJsonOutput) {
      console.log(`[backfill] Successfully wrote ${resultMappings.length} mappings to ${outputPath}`);
      if (failures.length > 0) {
        console.warn(`[backfill] Warning: Failed to resolve source files for ${failures.length} atoms:`, failures);
      }
    } else {
      console.log(JSON.stringify({ ok: true, written: resultMappings.length, failures }));
    }
  } else {
    if (isJsonOutput) {
      console.log(JSON.stringify({ ok: true, dryRun: true, count: resultMappings.length, failures }));
    } else {
      console.log(`[backfill] Dry-run complete. Resolved ${resultMappings.length} atoms, ${failures.length} failures.`);
      if (failures.length > 0) {
        console.warn(`[backfill] Failures:`, failures);
      }
    }
  }
}

main();
