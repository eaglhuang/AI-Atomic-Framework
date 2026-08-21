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

/**
 * A queue-head approved replacement of pre-existing generated publication
 * bytes.  It is intentionally a plan, rather than a broad "force" switch:
 * every replacement stays bound to the sealed source and the exact bytes that
 * were observed before the build began.
 */
export interface RunnerPublicationTakeoverPlan {
  readonly schemaId: 'atm.runnerPublicationTakeoverPlan.v1';
  readonly sealedSourceSha: string;
  readonly snapshotDigest: string;
  readonly entries: readonly { readonly path: string; readonly observedDigest: string }[];
  readonly digest: string;
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
  /** A queue-head sealed build owns the publication roots it has admitted. */
  readonly includeDirtyPublicationMembers?: boolean;
  /**
   * Pre-existing output bytes become current-task owned only after the
   * publication boundary has validated an exact digest-bound takeover plan.
   */
  readonly takeoverPaths?: readonly string[];
}): RunnerBuildOutputInventory {
  const outputPaths = changedPathsSinceSnapshot(input.cwd, input.buildTarget, input.beforeBuildSnapshot);
  if (input.includeDirtyPublicationMembers) {
    outputPaths.push(...listDirtyPaths(input.cwd).filter(isRunnerPublicationArtifactPath));
  }
  if (input.taskId) outputPaths.push(`.atm/history/evidence/${input.taskId}.runner-sync-receipt.json`);
  const preexistingDirtyPaths = new Set(input.beforeBuildSnapshot.preexistingDirtyPaths.map(normalizePath));
  const takeoverPaths = new Set((input.takeoverPaths ?? []).map(normalizePath));
  return deriveRunnerBuildOutputInventory({
    sealedSourceSha: input.sealedSourceSha,
    observedPaths: outputPaths,
    currentTaskId: input.taskId,
    // A queue-head build may observe pre-existing generated WIP, but it cannot
    // convert that observation into ownership unless the publication boundary
    // has supplied an exact digest-bound takeover for that same path.
    ownership: outputPaths.map((entry) => ({
      path: entry,
      ownerTaskId: preexistingDirtyPaths.has(normalizePath(entry)) && !takeoverPaths.has(normalizePath(entry))
        ? null
        : input.taskId
    }))
  });
}

/** Capture byte identities before a sealed build mutates its output surfaces. */
export function captureRunnerBuildOutputSnapshot(input: {
  readonly cwd: string;
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly currentTaskId?: string | null;
  readonly currentTaskAllowedFiles?: readonly string[];
}): RunnerBuildOutputSnapshot {
  const roots = publicationRoots(input.cwd, input.buildTarget);
  const members = Object.fromEntries(collectOutputPaths(input.cwd, roots).map((entry) => [entry, fileFingerprint(input.cwd, entry)]));
  const allowedFiles = input.currentTaskAllowedFiles ?? [];
  const hasCanonicalScope = Boolean(input.currentTaskId?.trim()) && allowedFiles.length > 0;
  const preexistingDirtyPaths = listDirtyPaths(input.cwd)
    .filter((entry) => Object.hasOwn(members, entry))
    .filter((entry) => !hasCanonicalScope || !pathMatchesScope(entry, allowedFiles));
  return { schemaId: 'atm.runnerBuildOutputSnapshot.v1', buildTarget: input.buildTarget, members, preexistingDirtyPaths };
}

/** Create the immutable payload a broker must persist before a takeover. */
export function planRunnerPublicationTakeover(input: {
  readonly sealedSourceSha: string;
  readonly snapshot: RunnerBuildOutputSnapshot;
}): RunnerPublicationTakeoverPlan {
  const entries = uniquePaths(input.snapshot.preexistingDirtyPaths)
    .map((entry) => ({ path: entry, observedDigest: input.snapshot.members[entry] ?? 'missing' }));
  // `missing` is an observed pre-build state, not an absent observation.  The
  // snapshot digest binds it just as strongly as a content digest, allowing a
  // sealed publication to restore a deleted generated member without
  // weakening the exact-path takeover boundary.
  if (entries.some((entry) => !isRunnerPublicationArtifactPath(entry.path))) {
    throw new Error('Runner publication takeover can only name pre-existing generated publication members with an observed digest.');
  }
  const sealedSourceSha = input.sealedSourceSha.trim();
  const snapshotDigest = digestSnapshot(input.snapshot);
  return {
    schemaId: 'atm.runnerPublicationTakeoverPlan.v1',
    sealedSourceSha,
    snapshotDigest,
    entries,
    digest: digestTakeoverPlan({ sealedSourceSha, snapshotDigest, entries })
  };
}

/** Reject stale, broadened, or hand-edited takeovers before any bytes move. */
export function validateRunnerPublicationTakeoverPlan(input: {
  readonly plan: unknown;
  readonly sealedSourceSha: string;
  readonly snapshot: RunnerBuildOutputSnapshot;
}): { readonly ok: boolean; readonly plan: RunnerPublicationTakeoverPlan | null; readonly reason: string | null } {
  if (!input.plan || typeof input.plan !== 'object' || Array.isArray(input.plan)) return { ok: false, plan: null, reason: 'plan must be an object' };
  const raw = input.plan as Record<string, unknown>;
  if (raw.schemaId !== 'atm.runnerPublicationTakeoverPlan.v1' || !Array.isArray(raw.entries)) return { ok: false, plan: null, reason: 'plan schema or entries are invalid' };
  const sealedSourceSha = typeof raw.sealedSourceSha === 'string' ? raw.sealedSourceSha.trim() : '';
  const snapshotDigest = typeof raw.snapshotDigest === 'string' ? raw.snapshotDigest.trim() : '';
  const entries = raw.entries.map((entry) => {
    const value = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    return { path: typeof value.path === 'string' ? normalizePath(value.path) : '', observedDigest: typeof value.observedDigest === 'string' ? value.observedDigest : '' };
  });
  // Keep validation on the same deterministic byte-order comparator used by
  // `uniquePaths()` when the broker authored the plan. `localeCompare()` is
  // locale-sensitive and can reorder mixed-case generated members differently
  // (for example an `ATM-*` directory beside lowercase siblings), turning a
  // freshly authorized plan into an invalid one at publication time.
  if (!sealedSourceSha || !snapshotDigest || entries.some((entry) => !entry.path || !entry.observedDigest) || JSON.stringify(entries) !== JSON.stringify([...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    return { ok: false, plan: null, reason: 'plan entries must be complete, unique, and sorted' };
  }
  const plan: RunnerPublicationTakeoverPlan = { schemaId: 'atm.runnerPublicationTakeoverPlan.v1', sealedSourceSha, snapshotDigest, entries, digest: typeof raw.digest === 'string' ? raw.digest.trim() : '' };
  if (plan.digest !== digestTakeoverPlan(plan)) return { ok: false, plan: null, reason: 'plan digest is invalid' };
  if (plan.sealedSourceSha !== input.sealedSourceSha.trim()) return { ok: false, plan: null, reason: 'plan sealed source does not match this build' };
  if (plan.snapshotDigest !== digestSnapshot(input.snapshot)) return { ok: false, plan: null, reason: 'plan snapshot does not match current pre-build bytes' };
  const expected = planRunnerPublicationTakeover({ sealedSourceSha: input.sealedSourceSha, snapshot: input.snapshot });
  if (plan.digest !== expected.digest) return { ok: false, plan: null, reason: 'plan does not cover exactly the current pre-existing publication members' };
  return { ok: true, plan, reason: null };
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
      : terminalDisposition === 'published' && extraOutputPaths.length === 0
        ? 'published'
        : extraOutputPaths.length > 0
        ? 'inventory-incomplete'
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

export function pathMatchesScope(filePath: string, allowedFiles: readonly string[]): boolean {
  const normalizedFile = normalizePath(filePath).toLowerCase();
  return allowedFiles.some((candidate) => {
    const normalizedCandidate = normalizePath(candidate).toLowerCase();
    if (normalizedCandidate.includes('*')) {
      const escaped = normalizedCandidate
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__ATM_DOUBLE_STAR__/g, '.*');
      return new RegExp(`^${escaped}$`).test(normalizedFile);
    }
    if (!normalizedCandidate) return false;
    if (normalizedFile === normalizedCandidate) return true;
    if (normalizedCandidate.endsWith('/')) return normalizedFile.startsWith(normalizedCandidate);
    if (!/\.[a-z0-9]+$/i.test(normalizedCandidate)) return normalizedFile.startsWith(`${normalizedCandidate}/`);
    return false;
  });
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

function digestSnapshot(snapshot: RunnerBuildOutputSnapshot): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ buildTarget: snapshot.buildTarget, members: snapshot.members, preexistingDirtyPaths: uniquePaths(snapshot.preexistingDirtyPaths) })).digest('hex')}`;
}

function digestTakeoverPlan(plan: Pick<RunnerPublicationTakeoverPlan, 'sealedSourceSha' | 'snapshotDigest' | 'entries'>): string {
  const payload = {
    sealedSourceSha: plan.sealedSourceSha,
    snapshotDigest: plan.snapshotDigest,
    entries: plan.entries
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
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
