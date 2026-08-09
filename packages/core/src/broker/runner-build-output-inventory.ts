import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type RunnerBuildOutputDisposition =
  | 'owned-current'
  | 'foreign-live'
  | 'stale-recovery-input'
  | 'unowned';

export interface RunnerBuildOutputInventoryEntry {
  readonly path: string;
  readonly disposition: RunnerBuildOutputDisposition;
  readonly ownerTaskId: string | null;
  readonly ownerActorId: string | null;
}

export interface RunnerBuildOutputInventory {
  readonly schemaId: 'atm.runnerBuildOutputInventory.v1';
  readonly sealedSourceSha: string;
  readonly entries: readonly RunnerBuildOutputInventoryEntry[];
  readonly digest: string;
}

export interface RunnerBuildOutputSnapshot {
  readonly schemaId: 'atm.runnerBuildOutputSnapshot.v1';
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly members: Readonly<Record<string, string>>;
  readonly preexistingDirtyPaths: readonly string[];
}

export type RunnerPublicationDisposition =
  | 'published'
  | 'publication-pending'
  | 'inventory-incomplete'
  | 'recovery-retained';

/**
 * The stable answer shared by doctor, runner-sync release, and publication.
 * Callers supply observed worktree state; this provider never runs Git or
 * selects a receipt on its own.
 */
export interface RunnerPublicationDispositionReport {
  readonly schemaId: 'atm.runnerPublicationDisposition.v1';
  readonly disposition: RunnerPublicationDisposition;
  readonly ok: boolean;
  readonly inventoryDigest: string;
  readonly dirtyInventoryPaths: readonly string[];
  readonly extraOutputPaths: readonly string[];
  readonly terminalDisposition: 'published' | 'recovery-retained' | null;
}

export interface RunnerBuildOutputInventoryValidation {
  readonly ok: boolean;
  readonly inventory: RunnerBuildOutputInventory | null;
  readonly reason: string | null;
}

export interface BuildOutputOwnership {
  readonly path: string;
  readonly ownerTaskId?: string | null;
  readonly ownerActorId?: string | null;
  readonly leaseFresh?: boolean | null;
}

export type RunnerBuildOutputTarget = 'full' | 'packages' | 'root-drop' | 'onefile';

/** The stable output family of a sealed ATM runner build. */
export function isRunnerBuildOutputPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('packages/cli/dist/')
    || normalized.startsWith('release/atm-root-drop/')
    || normalized.startsWith('release/atm-onefile/')
    || /^\.atm\/history\/evidence\/[^/]+\.runner-sync-receipt\.json$/i.test(normalized);
}

/** Build artifacts whose unexpected dirty state must match a sealed inventory. */
export function isRunnerPublicationArtifactPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('packages/cli/dist/')
    || normalized.startsWith('release/atm-root-drop/')
    || normalized.startsWith('release/atm-onefile/');
}

export function deriveRunnerBuildOutputInventory(input: {
  readonly sealedSourceSha: string;
  readonly observedPaths: readonly string[];
  readonly currentTaskId?: string | null;
  readonly ownership?: readonly BuildOutputOwnership[];
}): RunnerBuildOutputInventory {
  return buildRunnerBuildOutputInventory({
    ...input,
    outputPaths: input.observedPaths.filter(isRunnerBuildOutputPath)
  });
}

/**
 * The sealed build adapter asks this module for publication membership. It does
 * not infer it from a dirty Git diff, which may contain another lane's work.
 */
export function scanSealedRunnerBuildOutputInventory(input: {
  readonly cwd: string;
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly sealedSourceSha: string;
  readonly taskId: string | null;
  readonly beforeBuildSnapshot: RunnerBuildOutputSnapshot;
}): RunnerBuildOutputInventory {
  const outputPaths = changedPathsSinceSnapshot(input.cwd, input.buildTarget, input.beforeBuildSnapshot);
  if (input.taskId) outputPaths.push(`.atm/history/evidence/${input.taskId}.runner-sync-receipt.json`);
  return deriveRunnerBuildOutputInventory({
    sealedSourceSha: input.sealedSourceSha,
    observedPaths: outputPaths,
    currentTaskId: input.taskId,
    ownership: outputPaths.map((entry) => ({ path: entry, ownerTaskId: input.taskId }))
  });
}

/** Capture byte identities before a sealed build mutates its output surfaces. */
export function captureRunnerBuildOutputSnapshot(input: {
  readonly cwd: string;
  readonly buildTarget: RunnerBuildOutputTarget;
}): RunnerBuildOutputSnapshot {
  const roots = publicationRoots(input.cwd, input.buildTarget);
  const members = Object.fromEntries(collectOutputPaths(input.cwd, roots).map((entry) => [entry, fileFingerprint(input.cwd, entry)]));
  const preexistingDirtyPaths = listDirtyPaths(input.cwd).filter((entry) => Object.hasOwn(members, entry));
  return { schemaId: 'atm.runnerBuildOutputSnapshot.v1', buildTarget: input.buildTarget, members, preexistingDirtyPaths };
}

export function buildRunnerBuildOutputInventory(input: {
  readonly sealedSourceSha: string;
  readonly outputPaths: readonly string[];
  readonly currentTaskId?: string | null;
  readonly ownership?: readonly BuildOutputOwnership[];
}): RunnerBuildOutputInventory {
  const ownershipByPath = new Map(
    (input.ownership ?? []).map((entry) => [normalizePath(entry.path), entry])
  );
  const entries = uniquePaths(input.outputPaths).map((outputPath) => {
    const ownership = ownershipByPath.get(outputPath);
    const ownerTaskId = ownership?.ownerTaskId?.trim() || null;
    const ownerActorId = ownership?.ownerActorId?.trim() || null;
    const disposition: RunnerBuildOutputDisposition = ownerTaskId === input.currentTaskId
      ? 'owned-current'
      : ownerTaskId && ownership?.leaseFresh !== false
        ? 'foreign-live'
        : ownerTaskId
          ? 'stale-recovery-input'
          : 'unowned';
    return { path: outputPath, disposition, ownerTaskId, ownerActorId };
  });
  const sealedSourceSha = input.sealedSourceSha.trim();
  return {
    schemaId: 'atm.runnerBuildOutputInventory.v1',
    sealedSourceSha,
    entries,
    digest: digestInventory(sealedSourceSha, entries)
  };
}

export function inventoryPathsForPublication(inventory: RunnerBuildOutputInventory): readonly string[] {
  return inventory.entries
    .filter((entry) => entry.disposition === 'owned-current')
    .map((entry) => entry.path);
}

export function inventoryRecoveryBlockers(inventory: RunnerBuildOutputInventory): readonly RunnerBuildOutputInventoryEntry[] {
  return inventory.entries.filter((entry) => entry.disposition === 'foreign-live' || entry.disposition === 'unowned');
}

export function evaluateRunnerPublicationDisposition(input: {
  readonly inventory: RunnerBuildOutputInventory;
  readonly dirtyPaths: readonly string[];
  /** A receipt-backed recovery transaction may intentionally retain exact members. */
  readonly terminalDisposition?: 'published' | 'recovery-retained' | null;
}): RunnerPublicationDispositionReport {
  const inventoryPaths = new Set(input.inventory.entries.map((entry) => entry.path));
  const dirtyPaths = uniquePaths(input.dirtyPaths);
  // A foreign task's evidence receipt is not an artifact of this generation.
  // It is relevant only when this inventory explicitly named it.
  const publicationDirtyPaths = dirtyPaths.filter((entry) => (
    inventoryPaths.has(entry) || isRunnerPublicationArtifactPath(entry)
  ));
  const dirtyInventoryPaths = publicationDirtyPaths.filter((entry) => inventoryPaths.has(entry));
  const extraOutputPaths = publicationDirtyPaths.filter((entry) => !inventoryPaths.has(entry));
  const terminalDisposition = input.terminalDisposition ?? null;

  const disposition: RunnerPublicationDisposition = terminalDisposition === 'recovery-retained'
      ? 'recovery-retained'
      : dirtyInventoryPaths.length > 0
        ? 'publication-pending'
        : 'published';
  return {
    schemaId: 'atm.runnerPublicationDisposition.v1',
    disposition,
    ok: disposition === 'published' || disposition === 'recovery-retained',
    inventoryDigest: input.inventory.digest,
    dirtyInventoryPaths,
    extraOutputPaths,
    terminalDisposition
  };
}

function changedPathsSinceSnapshot(cwd: string, buildTarget: RunnerBuildOutputTarget, before: RunnerBuildOutputSnapshot): string[] {
  if (before.schemaId !== 'atm.runnerBuildOutputSnapshot.v1' || before.buildTarget !== buildTarget) {
    throw new Error('Runner build output snapshot does not match the sealed build target.');
  }
  const roots = publicationRoots(cwd, buildTarget);
  const afterPaths = collectOutputPaths(cwd, roots);
  const paths = uniquePaths([...Object.keys(before.members), ...afterPaths]);
  return paths.filter((entry) => before.members[entry] !== fileFingerprint(cwd, entry));
}

function collectOutputPaths(cwd: string, roots: readonly string[]): string[] {
  return uniquePaths([...roots.flatMap((root) => listFiles(cwd, root)), ...listTrackedFiles(cwd, roots)]);
}

function fileFingerprint(cwd: string, relativePath: string): string {
  const absolute = path.join(cwd, relativePath);
  if (!existsSync(absolute)) return 'missing';
  return `sha256:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`;
}

function listDirtyPaths(cwd: string): string[] {
  const collect = (args: readonly string[]) => {
    const result = spawnSync('git', args as string[], { cwd, encoding: 'utf8' });
    if ((result.status ?? 1) !== 0) return [] as string[];
    return String(result.stdout ?? '').split(/\r?\n/).map(normalizePath).filter(Boolean);
  };
  return uniquePaths([...collect(['diff', '--name-only']), ...collect(['diff', '--name-only', '--cached'])]);
}

export function verifyRunnerBuildOutputParity(
  inventory: RunnerBuildOutputInventory,
  declaredPaths: readonly string[]
): { readonly ok: boolean; readonly missing: readonly string[]; readonly extra: readonly string[] } {
  const observed = new Set(inventory.entries.map((entry) => entry.path));
  const declared = new Set(uniquePaths(declaredPaths));
  const missing = [...declared].filter((entry) => !observed.has(entry)).sort();
  const extra = [...observed].filter((entry) => !declared.has(entry)).sort();
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * Validate a receipt-provided inventory against the same canonical digest used
 * by the build writer. Consumers must not accept a merely shape-compatible
 * inventory, because it could describe a different sealed generation.
 */
export function validateRunnerBuildOutputInventory(value: unknown): RunnerBuildOutputInventoryValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, inventory: null, reason: 'inventory must be an object' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaId !== 'atm.runnerBuildOutputInventory.v1') {
    return { ok: false, inventory: null, reason: 'inventory schemaId is invalid' };
  }
  const sealedSourceSha = typeof candidate.sealedSourceSha === 'string' ? candidate.sealedSourceSha.trim() : '';
  if (!sealedSourceSha || !Array.isArray(candidate.entries) || typeof candidate.digest !== 'string') {
    return { ok: false, inventory: null, reason: 'inventory is missing sealedSourceSha, entries, or digest' };
  }
  const entries: RunnerBuildOutputInventoryEntry[] = [];
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, inventory: null, reason: 'inventory contains an invalid entry' };
    }
    const raw = entry as Record<string, unknown>;
    const path = typeof raw.path === 'string' ? normalizePath(raw.path) : '';
    const disposition = raw.disposition;
    if (!path || !['owned-current', 'foreign-live', 'stale-recovery-input', 'unowned'].includes(String(disposition))) {
      return { ok: false, inventory: null, reason: 'inventory contains an invalid path or disposition' };
    }
    entries.push({
      path,
      disposition: disposition as RunnerBuildOutputDisposition,
      ownerTaskId: typeof raw.ownerTaskId === 'string' && raw.ownerTaskId.trim() ? raw.ownerTaskId.trim() : null,
      ownerActorId: typeof raw.ownerActorId === 'string' && raw.ownerActorId.trim() ? raw.ownerActorId.trim() : null
    });
  }
  const paths = entries.map((entry) => entry.path);
  if (paths.length !== new Set(paths).size || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    return { ok: false, inventory: null, reason: 'inventory paths must be unique and sorted' };
  }
  const inventory: RunnerBuildOutputInventory = {
    schemaId: 'atm.runnerBuildOutputInventory.v1',
    sealedSourceSha,
    entries,
    digest: String(candidate.digest).trim()
  };
  if (inventory.digest !== digestInventory(inventory.sealedSourceSha, inventory.entries)) {
    return { ok: false, inventory: null, reason: 'inventory digest does not match its canonical entries' };
  }
  return { ok: true, inventory, reason: null };
}

function digestInventory(sealedSourceSha: string, entries: readonly RunnerBuildOutputInventoryEntry[]): string {
  const payload = JSON.stringify({ sealedSourceSha, entries });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function publicationRoots(cwd: string, buildTarget: RunnerBuildOutputTarget): string[] {
  const roots: string[] = [];
  if (buildTarget === 'full' || buildTarget === 'packages') {
    const packagesRoot = path.join(cwd, 'packages');
    if (existsSync(packagesRoot)) {
      for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) roots.push(path.join('packages', entry.name, 'dist'));
      }
    }
  }
  if (buildTarget === 'full' || buildTarget === 'root-drop') roots.push(path.join('release', 'atm-root-drop'));
  if (buildTarget === 'full' || buildTarget === 'onefile') roots.push(path.join('release', 'atm-onefile'));
  return roots;
}

function listFiles(cwd: string, relativeRoot: string): string[] {
  const absoluteRoot = path.join(cwd, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  const visit = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(path.relative(cwd, child).replace(/\\/g, '/'));
    }
  };
  visit(absoluteRoot);
  return files;
}

function listTrackedFiles(cwd: string, relativeRoots: readonly string[]): string[] {
  if (relativeRoots.length === 0) return [];
  const result = spawnSync('git', ['ls-files', '--', ...relativeRoots.map(normalizePath)], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if ((result.status ?? 1) !== 0) return [];
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);
}
