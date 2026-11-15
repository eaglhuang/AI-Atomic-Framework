import { spawnSync } from 'node:child_process';
import type { TargetCharterUpgradeReport } from './types.ts';

/**
 * Upgrade the target's AtomicCharter with the runner just copied into it, so
 * the runner and the charter it bundles move together. A runner that predates
 * `charter upgrade` reports ok:false with a detail; the sync itself continues.
 */
export function upgradeTargetCharter(repoPath: string): TargetCharterUpgradeReport {
  const result = spawnSync(process.execPath, ['atm.mjs', 'charter', 'upgrade', '--write', '--json'], { cwd: repoPath, encoding: 'utf8' });
  try {
    const parsed = JSON.parse(result.stdout ?? '') as {
      ok?: boolean;
      evidence?: { status?: string; currentVersion?: string | null; bundledVersion?: string; changedFiles?: string[]; receiptPath?: string | null; written?: boolean };
    };
    const evidence = parsed.evidence ?? {};
    const written = evidence.written === true;
    return {
      ok: parsed.ok === true,
      status: evidence.status ?? 'unknown',
      fromVersion: evidence.currentVersion ?? null,
      toVersion: evidence.bundledVersion ?? null,
      paths: written ? [...(evidence.changedFiles ?? []), ...(evidence.receiptPath ? [evidence.receiptPath] : [])] : [],
      detail: parsed.ok === true ? null : 'charter upgrade reported a conflict; inspect the target with node atm.mjs charter upgrade --json'
    };
  } catch {
    const detail = [result.stderr, result.error?.message].filter(Boolean).join(' ').trim().slice(-500);
    return { ok: false, status: 'unavailable', fromVersion: null, toVersion: null, paths: [], detail: detail || 'runner did not return charter upgrade JSON' };
  }
}
