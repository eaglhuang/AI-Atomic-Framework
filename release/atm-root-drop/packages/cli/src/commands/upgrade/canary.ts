/**
 * Canary selection helpers for the safe-upgrade apply path.
 *
 * Extracted from `packages/cli/src/commands/upgrade.ts` per the
 * `upgrade/SPLIT_PLAN.md` Layer 1 split. Pure calculation — no side
 * effects.
 *
 * Surface contract: the `CanarySelection` shape (`enabled`, `percent`,
 * `selectedFiles`, `deferredFiles`) is consumed by safe-upgrade apply
 * and recorded into upgrade evidence. The sort order
 * (`localeCompare`) and the ceiling calculation are part of that
 * contract — refactors here must preserve them.
 */
import { CliError } from '../shared.ts';
import { normalizeRepositoryRelativePath } from './path-helpers.ts';

export function parseCanaryPercent(value: string) {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new CliError('ATM_UPGRADE_CANARY_PERCENT_INVALID', '--canary must be an integer percent from 1 to 100', { exitCode: 2, details: { value } });
  }
  return percent;
}

export function resolveCanarySelection(percent: number | null, willModify: readonly string[]) {
  const selectedUniverse = [...new Set(willModify.map((entry) => normalizeRepositoryRelativePath(entry)))].sort((left, right) => left.localeCompare(right));
  if (percent === null) {
    return {
      enabled: false,
      percent: null,
      selectedFiles: selectedUniverse,
      deferredFiles: []
    };
  }
  const selectedCount = selectedUniverse.length === 0 ? 0 : Math.max(1, Math.ceil(selectedUniverse.length * percent / 100));
  return {
    enabled: true,
    percent,
    selectedFiles: selectedUniverse.slice(0, selectedCount),
    deferredFiles: selectedUniverse.slice(selectedCount)
  };
}

export function shouldApplyUpgradeFile(canary: ReturnType<typeof resolveCanarySelection>, filePath: string) {
  if (!canary.enabled) return true;
  return canary.selectedFiles.includes(normalizeRepositoryRelativePath(filePath));
}
