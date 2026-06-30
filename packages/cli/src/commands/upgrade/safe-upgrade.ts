/**
 * upgrade/safe-upgrade.ts
 *
 * TASK-ASR-0014 — upgrade.ts complete split
 *
 * Safe ATM onboarding upgrade: plan / apply / rollback / file collection.
 */
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createATMVersionSummary, loadCompatibilityMatrix, runATMChart } from '../atm-chart.ts';
import { CliError, makeResult, message, readJsonFile, writeJsonFile } from '../shared.ts';
import {
  normalizeRepositoryRelativePath,
  requireOptionValue,
  resolveRepositoryPath,
  safeReadJson,
  sha256File
} from './path-helpers.ts';
import { parseCanaryPercent, resolveCanarySelection, shouldApplyUpgradeFile } from './canary.ts';

interface SafeUpgradeOptions {
  action: 'plan' | 'apply' | 'rollback';
  cwd: string;
  out: string | null;
  fromPlan: string | null;
  backup: string | null;
  canaryPercent: number | null;
  allowUnknownChart: boolean;
}

// ─── Action detection ──────────────────────────────────────────────────────

export function firstSafeUpgradeAction(argv: readonly string[]) {
  const flagsWithValues = new Set(['--cwd', '--out', '--from-plan', '--backup', '--canary']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flagsWithValues.has(argument)) {
      index += 1;
      continue;
    }
    if (argument === 'plan' || argument === 'apply' || argument === 'rollback') {
      return argument;
    }
  }
  return null;
}

export function parseSafeUpgradeOptions(argv: readonly string[], action: 'plan' | 'apply' | 'rollback') {
  const options: SafeUpgradeOptions = {
    action,
    cwd: process.cwd(),
    out: null,
    fromPlan: null,
    backup: null,
    canaryPercent: null,
    allowUnknownChart: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === action) continue;
    if (argument === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (argument === '--out') {
      options.out = requireOptionValue(argv, index, '--out');
      index += 1;
      continue;
    }
    if (argument === '--from-plan') {
      options.fromPlan = requireOptionValue(argv, index, '--from-plan');
      index += 1;
      continue;
    }
    if (argument === '--backup') {
      options.backup = requireOptionValue(argv, index, '--backup');
      index += 1;
      continue;
    }
    if (argument === '--canary') {
      if (action !== 'apply') {
        throw new CliError('ATM_CLI_USAGE', '--canary is only valid for upgrade apply', { exitCode: 2 });
      }
      options.canaryPercent = parseCanaryPercent(requireOptionValue(argv, index, '--canary'));
      index += 1;
      continue;
    }
    if (argument === '--allow-unknown-chart') {
      if (action !== 'plan') {
        throw new CliError('ATM_CLI_USAGE', '--allow-unknown-chart is only valid for upgrade plan', { exitCode: 2 });
      }
      options.allowUnknownChart = true;
      continue;
    }
    if (argument === '--json' || argument === '--pretty') continue;
    if (argument.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `upgrade ${action} does not support option ${argument}`, { exitCode: 2 });
    }
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd)
  };
}

// ─── Plan ─────────────────────────────────────────────────────────────────

export function runSafeUpgradePlan(options: SafeUpgradeOptions) {
  const versionSummary = createATMVersionSummary(options.cwd);
  if (versionSummary.compatibility.code === 'unknown-chart-version' && options.allowUnknownChart !== true) {
    throw new CliError('ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE', 'ATMChart version is unknown. Safe upgrade plan is read-only but still requires --allow-unknown-chart before preparing write-oriented follow-up steps.', {
      exitCode: 2,
      details: {
        versionSummary,
        requiredFlag: '--allow-unknown-chart'
      }
    });
  }
  const planId = `atm-upgrade-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupPath = `.atm/backups/${planId}`;
  const backupFiles = collectSafeUpgradeFiles(options.cwd);
  const willModify = [
    '.atm/memory/atm-chart.md',
    '.atm/runtime/compatibility-matrix.snapshot.json'
  ].filter((filePath) => backupFiles.some((entry) => entry.path === filePath) || filePath.endsWith('compatibility-matrix.snapshot.json'));
  const plan = {
    schemaId: 'atm.safeUpgradePlan',
    specVersion: '0.1.0',
    planId,
    createdAt: new Date().toISOString(),
    cwd: options.cwd,
    status: versionSummary.compatibility.status,
    readOnlyDiagnostic: versionSummary.compatibility.readOnlyDiagnostic,
    requiresExplicitApply: true,
    versions: versionSummary,
    backupPath,
    rollbackPath: `${backupPath}/backup-manifest.json`,
    willModify,
    backupFiles
  };

  const outPath = typeof options.out === 'string'
    ? resolveRepositoryPath(options.cwd, options.out)
    : null;
  if (outPath) {
    writeJsonFile(outPath, plan);
  }

  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [
      versionSummary.compatibility.code === 'unknown-chart-version'
        ? message('warning', 'ATM_UPGRADE_UNKNOWN_CHART_ALLOWED', 'Unknown ATMChart version allowed by explicit --allow-unknown-chart override.', { readOnlyDiagnostic: true })
        : message('info', 'ATM_UPGRADE_PLAN_READY', 'Safe ATM onboarding upgrade plan generated as dry-run output.')
    ],
    evidence: {
      action: 'plan',
      planPath: outPath ? path.relative(options.cwd, outPath).replace(/\\/g, '/') : null,
      plan
    }
  });
}

// ─── Apply ────────────────────────────────────────────────────────────────

export async function runSafeUpgradeApply(options: SafeUpgradeOptions) {
  if (typeof options.fromPlan !== 'string') {
    throw new CliError('ATM_CLI_USAGE', 'upgrade apply requires --from-plan <plan.json>', { exitCode: 2 });
  }
  const planPath = resolveRepositoryPath(options.cwd, options.fromPlan);
  const plan = readJsonFile(planPath, 'ATM_UPGRADE_PLAN_NOT_FOUND');
  if (plan?.schemaId !== 'atm.safeUpgradePlan') {
    throw new CliError('ATM_UPGRADE_PLAN_INVALID', 'Safe upgrade apply requires an atm.safeUpgradePlan document.', { exitCode: 2 });
  }
  const cwd = path.resolve(String(plan.cwd ?? options.cwd));
  const willModify = Array.isArray(plan.willModify) ? (plan.willModify as unknown[]).map((entry) => normalizeRepositoryRelativePath(String(entry))) : [];
  const canary = resolveCanarySelection(options.canaryPercent, willModify);
  const backupRoot = resolveRepositoryPath(cwd, String(plan.backupPath));
  const backupManifestPath = path.join(backupRoot, 'backup-manifest.json');
  const backedUpFiles = backupSafeUpgradeFiles(cwd, backupRoot, Array.isArray(plan.backupFiles) ? plan.backupFiles : []);
  const compatibilitySnapshotPath = path.join(backupRoot, 'compatibility-matrix.snapshot.json');
  writeJsonFile(compatibilitySnapshotPath, loadCompatibilityMatrix());
  writeJsonFile(backupManifestPath, {
    schemaId: 'atm.safeUpgradeBackupManifest',
    specVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    planId: plan.planId,
    plan,
    backedUpFiles,
    canary: canary.enabled ? {
      percent: canary.percent,
      selectedFiles: canary.selectedFiles,
      deferredFiles: canary.deferredFiles
    } : null
  });

  const modifiedFiles = [];
  if (shouldApplyUpgradeFile(canary, '.atm/memory/atm-chart.md')) {
    await runATMChart(['render', '--cwd', cwd]);
    modifiedFiles.push('.atm/memory/atm-chart.md');
  }
  if (shouldApplyUpgradeFile(canary, '.atm/runtime/compatibility-matrix.snapshot.json')) {
    writeJsonFile(resolveRepositoryPath(cwd, '.atm/runtime/compatibility-matrix.snapshot.json'), loadCompatibilityMatrix());
    modifiedFiles.push('.atm/runtime/compatibility-matrix.snapshot.json');
  }

  const canaryStatePath = path.join(backupRoot, 'canary-state.json');
  if (canary.enabled) {
    writeJsonFile(canaryStatePath, {
      schemaId: 'atm.safeUpgradeCanaryState',
      specVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      planId: plan.planId,
      percent: canary.percent,
      selectedFiles: canary.selectedFiles,
      deferredFiles: canary.deferredFiles,
      rollbackPath: path.relative(cwd, backupManifestPath).replace(/\\/g, '/'),
      status: 'canary-applied'
    });
  }

  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd,
    messages: [canary.enabled
      ? message('info', 'ATM_UPGRADE_CANARY_APPLIED', 'Safe ATM onboarding upgrade applied to the selected canary subset after backup.', { percent: canary.percent })
      : message('info', 'ATM_UPGRADE_APPLIED', 'Safe ATM onboarding upgrade applied after backup.')],
    evidence: {
      action: 'apply',
      planPath: path.relative(cwd, planPath).replace(/\\/g, '/'),
      backupPath: path.relative(cwd, backupRoot).replace(/\\/g, '/'),
      rollbackPath: path.relative(cwd, backupManifestPath).replace(/\\/g, '/'),
      canary: canary.enabled ? {
        percent: canary.percent,
        statePath: path.relative(cwd, canaryStatePath).replace(/\\/g, '/'),
        selectedFiles: canary.selectedFiles,
        deferredFiles: canary.deferredFiles
      } : null,
      backedUpFiles,
      modifiedFiles
    }
  });
}

// ─── Rollback ─────────────────────────────────────────────────────────────

export function runSafeUpgradeRollback(options: SafeUpgradeOptions) {
  if (typeof options.backup !== 'string') {
    throw new CliError('ATM_CLI_USAGE', 'upgrade rollback requires --backup <backup-dir>', { exitCode: 2 });
  }
  const backupRoot = resolveRepositoryPath(options.cwd, options.backup);
  const backupManifestPath = path.join(backupRoot, 'backup-manifest.json');
  const manifest = readJsonFile(backupManifestPath, 'ATM_UPGRADE_BACKUP_NOT_FOUND');
  if (manifest?.schemaId !== 'atm.safeUpgradeBackupManifest' || !Array.isArray(manifest.backedUpFiles)) {
    throw new CliError('ATM_UPGRADE_BACKUP_INVALID', 'Rollback requires an atm.safeUpgradeBackupManifest document.', { exitCode: 2 });
  }

  const restoredFiles = [];
  const removedFiles = [];
  for (const fileRecord of manifest.backedUpFiles) {
    const relativeFilePath = normalizeRepositoryRelativePath(fileRecord.path);
    const targetPath = resolveRepositoryPath(options.cwd, relativeFilePath);
    const backupFilePath = path.join(backupRoot, 'files', relativeFilePath);
    if (fileRecord.present === true && existsSync(backupFilePath)) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(backupFilePath, targetPath);
      restoredFiles.push(relativeFilePath);
      continue;
    }
    if (fileRecord.present === false && existsSync(targetPath)) {
      rmSync(targetPath, { force: true });
      removedFiles.push(relativeFilePath);
    }
  }

  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [message('info', 'ATM_UPGRADE_ROLLBACK_OK', 'Safe ATM onboarding upgrade rollback restored the previous files.')],
    evidence: {
      action: 'rollback',
      backupPath: path.relative(options.cwd, backupRoot).replace(/\\/g, '/'),
      canaryRollback: existsSync(path.join(backupRoot, 'canary-state.json')),
      restoredFiles,
      removedFiles
    }
  });
}

// ─── File collection ───────────────────────────────────────────────────────

export function collectSafeUpgradeFiles(cwd: string) {
  const records = new Map<string, Record<string, unknown>>();
  addBackupRecord(records, cwd, '.atm/memory/atm-chart.md', { role: 'atm-chart' });
  addManifestFiles(records, cwd, '.atm/agent-pack', 'agent-pack-manifest');
  addManifestFiles(records, cwd, '.atm/integrations', 'integration-manifest');
  addBackupRecord(records, cwd, '.atm/runtime/compatibility-matrix.snapshot.json', { role: 'compatibility-matrix-snapshot' });
  return [...records.values()].sort((left, right) => String(left.path).localeCompare(String(right.path)));
}

// ─── Private helpers ───────────────────────────────────────────────────────

function addManifestFiles(records: Map<string, Record<string, unknown>>, cwd: string, manifestDir: string, role: string) {
  const absoluteManifestDir = resolveRepositoryPath(cwd, manifestDir);
  if (!existsSync(absoluteManifestDir)) return;
  for (const entryName of readdirSync(absoluteManifestDir).filter((entry) => entry.endsWith('.manifest.json')).sort((left, right) => left.localeCompare(right))) {
    const manifestPath = `${manifestDir}/${entryName}`;
    addBackupRecord(records, cwd, manifestPath, { role });
    const manifest = safeReadJson(resolveRepositoryPath(cwd, manifestPath));
    for (const managedFile of extractManagedFilesFromManifest(manifest)) {
      addBackupRecord(records, cwd, managedFile.path, {
        role: 'agent-native-entry-file',
        expectedHash: managedFile.expectedHash,
        hashFormat: managedFile.hashFormat
      });
    }
  }
}

function extractManagedFilesFromManifest(manifest: Record<string, unknown> | null | undefined) {
  if (manifest && 'renderedManifest' in manifest && manifest.renderedManifest && typeof manifest.renderedManifest === 'object' && 'renderedFiles' in manifest.renderedManifest && Array.isArray(manifest.renderedManifest.renderedFiles)) {
    return manifest.renderedManifest.renderedFiles.map((entry) => ({
      path: String((entry as Record<string, unknown>).path),
      expectedHash: String((entry as Record<string, unknown>).contentHash),
      hashFormat: 'hex'
    }));
  }
  if (manifest && 'files' in manifest && Array.isArray(manifest.files)) {
    return manifest.files.map((entry) => ({
      path: String((entry as Record<string, unknown>).path),
      expectedHash: String((entry as Record<string, unknown>).sha256),
      hashFormat: 'prefixed'
    }));
  }
  return [];
}

function addBackupRecord(records: Map<string, Record<string, unknown>>, cwd: string, filePath: string, details: Record<string, unknown>) {
  const relativeFilePath = normalizeRepositoryRelativePath(filePath);
  const absolutePath = resolveRepositoryPath(cwd, relativeFilePath);
  const exists = existsSync(absolutePath);
  const currentHash = exists ? sha256File(absolutePath) : null;
  const expectedHash = typeof details.expectedHash === 'string' ? details.expectedHash : null;
  const expectedComparable = expectedHash?.startsWith('sha256:') ? expectedHash.slice('sha256:'.length) : expectedHash;
  records.set(relativeFilePath, {
    path: relativeFilePath,
    role: details.role,
    exists,
    userModified: Boolean(exists && expectedComparable && currentHash !== expectedComparable),
    currentHash,
    expectedHash
  });
}

function backupSafeUpgradeFiles(cwd: string, backupRoot: string, backupFiles: readonly Record<string, unknown>[]) {
  const backedUpFiles = [];
  for (const fileRecord of backupFiles) {
    const relativeFilePath = normalizeRepositoryRelativePath(String(fileRecord.path));
    const sourcePath = resolveRepositoryPath(cwd, relativeFilePath);
    const backupFilePath = path.join(backupRoot, 'files', relativeFilePath);
    if (!existsSync(sourcePath)) {
      backedUpFiles.push({ path: relativeFilePath, present: false, backupPath: null });
      continue;
    }
    mkdirSync(path.dirname(backupFilePath), { recursive: true });
    copyFileSync(sourcePath, backupFilePath);
    backedUpFiles.push({ path: relativeFilePath, present: true, backupPath: path.relative(cwd, backupFilePath).replace(/\\/g, '/') });
  }
  return backedUpFiles;
}
