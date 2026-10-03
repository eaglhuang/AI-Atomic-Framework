/**
 * verify/verify-installed.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Hash-compare drift detection for installed integration files.
 * Returns an IntegrationVerifyResult describing which files match
 * or have diverged from the install manifest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { normalizeManifestPath, resolveRepositoryPath, sha256Bytes, sha256File } from '../manifest/schema.ts';
import { losslessUtf8, managedBlock, readManagedBlocks, safeInstallPath } from '../manifest/safe-install.ts';
import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.ts';
import type {
  IntegrationFinding,
  IntegrationFindingCode,
  IntegrationFindingLevel,
  IntegrationVerifyResult
} from './types.ts';

export function verifyManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationVerifyResult {
  const findings: IntegrationFinding[] = [];
  const driftedFiles: string[] = [];
  const blocks = readManagedBlocks(manifest);
  for (const fileRecord of manifest.files) {
    const absolutePath = blocks[fileRecord.path] ? safeInstallPath(context.repositoryRoot, fileRecord.path) : resolveRepositoryPath(context.repositoryRoot, fileRecord.path);
    if (!existsSync(absolutePath)) {
      findings.push(createFinding('error', 'file-missing', fileRecord.path, 'Installed file is missing.'));
      driftedFiles.push(fileRecord.path);
      continue;
    }
    const block = blocks[fileRecord.path] ? managedBlock(losslessUtf8(readFileSync(absolutePath)), blocks[fileRecord.path]) : null;
    const currentDigest = blocks[fileRecord.path] ? (block ? sha256Bytes(block.content) : null) : sha256File(absolutePath);
    if (currentDigest !== fileRecord.sha256) {
      findings.push(createFinding('error', 'hash-mismatch', fileRecord.path, 'Installed file hash no longer matches the manifest.'));
      driftedFiles.push(fileRecord.path);
      continue;
    }
    findings.push(createFinding('info', 'file-ok', fileRecord.path, 'Installed file matches the manifest.'));
  }
  return {
    ok: driftedFiles.length === 0,
    adapterId,
    findings,
    driftedFiles
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────

function createFinding(level: IntegrationFindingLevel, code: IntegrationFindingCode, filePath: string, message: string): IntegrationFinding {
  return {
    level,
    code,
    path: normalizeManifestPath(filePath),
    message
  };
}
