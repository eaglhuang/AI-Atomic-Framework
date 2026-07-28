import { createHash } from 'node:crypto';

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

export interface BuildOutputOwnership {
  readonly path: string;
  readonly ownerTaskId?: string | null;
  readonly ownerActorId?: string | null;
  readonly leaseFresh?: boolean | null;
}

/** The stable output family of a sealed ATM runner build. */
export function isRunnerBuildOutputPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('packages/cli/dist/')
    || normalized.startsWith('release/atm-root-drop/')
    || normalized.startsWith('release/atm-onefile/')
    || /^\.atm\/history\/evidence\/[^/]+\.runner-sync-receipt\.json$/i.test(normalized);
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
