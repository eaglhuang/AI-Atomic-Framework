/**
 * verify/uninstall-safety.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Preserve-if-modified uninstall safety. Compares each file's current
 * hash against the manifest; user-edited files are preserved, untouched
 * files are removed. The manifest file itself is hash-checked before
 * deletion.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertUnchanged, losslessUtf8, managedBlock, readManagedBlocks, safeInstallPath, validateOwnershipManifest } from '../manifest/safe-install.ts';
import {
  formatInstallManifest,
  normalizeManifestPath,
  resolveRepositoryPath,
  sha256Bytes,
  sha256File
} from '../manifest/schema.ts';
import type { IntegrationInstallContext, InstallManifest } from '../manifest/types.ts';
import type {
  IntegrationFinding,
  IntegrationFindingCode,
  IntegrationFindingLevel,
  IntegrationUninstallResult
} from './types.ts';

export function uninstallManifestFiles(adapterId: string, context: IntegrationInstallContext, manifest: InstallManifest): IntegrationUninstallResult {
  validateOwnershipManifest(manifest);
  const findings: IntegrationFinding[] = [];
  const removedFiles: string[] = [];
  const preservedFiles: string[] = [];
  const blocks = readManagedBlocks(manifest);
  const peerFiles = collectPeerOwnership(context);
  for (const file of manifest.files) {
    const target = safeInstallPath(context.repositoryRoot, file.path);
    if (existsSync(target) && blocks[file.path]) managedBlock(losslessUtf8(readFileSync(target)), blocks[file.path]);
  }
  for (const fileRecord of manifest.files) {
    const absolutePath = safeInstallPath(context.repositoryRoot, fileRecord.path);
    if (!existsSync(absolutePath)) {
      findings.push(createFinding('warning', 'file-missing', fileRecord.path, 'Installed file was already missing.'));
      continue;
    }
    if (blocks[fileRecord.path]) {
      const bytes = readFileSync(absolutePath);
      const text = losslessUtf8(bytes);
      const block = managedBlock(text, blocks[fileRecord.path]);
      if (block && sha256Bytes(block.content) === fileRecord.sha256) {
        assertUnchanged(context.repositoryRoot, fileRecord.path, bytes);
        writeFileSync(absolutePath, text.slice(0, block.start) + text.slice(block.end));
        findings.push(createFinding('info', 'file-ok', fileRecord.path, 'Removed only the ATM-owned block; user content was preserved.'));
      } else {
        findings.push(createFinding('warning', 'hash-mismatch', fileRecord.path, 'Modified ATM block was preserved.'));
      }
      preservedFiles.push(fileRecord.path);
      continue;
    }
    const currentDigest = sha256File(absolutePath);
    if (currentDigest !== fileRecord.sha256) {
      findings.push(createFinding('warning', 'hash-mismatch', fileRecord.path, 'Installed file was edited and will be preserved.'));
      preservedFiles.push(fileRecord.path);
      continue;
    }
    if (peerFiles.has(fileRecord.path)) {
      preservedFiles.push(fileRecord.path);
      findings.push(createFinding('info', 'file-ok', fileRecord.path, 'Preserved a file still owned by another project integration manifest.'));
      continue;
    }
    rmSync(absolutePath, { force: true });
    removedFiles.push(fileRecord.path);
  }

  const manifestPath = normalizeManifestPath(context.manifestPath ?? '.atm/integrations/manifest.json');
  const absoluteManifestPath = safeInstallPath(context.repositoryRoot, manifestPath);
  if (existsSync(absoluteManifestPath)) {
    const expectedManifestDigest = sha256Bytes(formatInstallManifest(manifest));
    const actualManifestDigest = sha256File(absoluteManifestPath);
    if (actualManifestDigest === expectedManifestDigest) {
      rmSync(absoluteManifestPath, { force: true });
      removedFiles.push(manifestPath);
      findings.push(createFinding('info', 'manifest-removed', manifestPath, 'Install manifest matched and was removed.'));
    } else {
      preservedFiles.push(manifestPath);
      findings.push(createFinding('warning', 'manifest-preserved', manifestPath, 'Install manifest was edited and will be preserved.'));
    }
  }

  return {
    ok: true,
    adapterId,
    removedFiles,
    preservedFiles,
    findings
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────

function collectPeerOwnership(context: IntegrationInstallContext): Set<string> {
  const files = new Set<string>();
  const directory = safeInstallPath(context.repositoryRoot, '.atm/integrations');
  if (!existsSync(directory)) return files;
  const own = path.resolve(context.repositoryRoot, context.manifestPath ?? '.atm/integrations/manifest.json');
  for (const name of readdirSync(directory).filter(entry => entry.endsWith('.manifest.json') || entry === 'codex.host.json' || entry === 'manifest.json')) {
    const candidate = safeInstallPath(context.repositoryRoot, `.atm/integrations/${name}`);
    if (candidate === own) continue;
    const other = JSON.parse(losslessUtf8(readFileSync(candidate))) as InstallManifest;
    validateOwnershipManifest(other);
    for (const entry of other.files) {
      if (!entry || typeof entry.path !== 'string' || normalizeManifestPath(entry.path) !== entry.path) {
        throw new Error(`ATM_INTEGRATION_INVALID_OWNERSHIP: invalid peer file in ${name}`);
      }
      files.add(entry.path); // Stale peer digests still represent live ownership.
    }
  }
  return files;
}

function createFinding(level: IntegrationFindingLevel, code: IntegrationFindingCode, filePath: string, message: string): IntegrationFinding {
  return {
    level,
    code,
    path: normalizeManifestPath(filePath),
    message
  };
}
