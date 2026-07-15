import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace } from '../../temp-root.ts';
import { cleanupNewSourceTeamRunFiles, snapshotSourceTeamRunFiles } from './artifact-fixtures.ts';

export function runSourceRuntimeResidueCleanupValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'source-runtime-residue-cleanup') return false;

  const cleanupRoot = path.join(createTempWorkspace('atm-team-source-cleanup-'), 'source');
  try {
    const teamRunDir = path.join(cleanupRoot, '.atm', 'runtime', 'team-runs');
    mkdirSync(teamRunDir, { recursive: true });
    const existingPath = path.join(teamRunDir, 'team-existing.json');
    const residuePath = path.join(teamRunDir, 'team-validator-residue.json');
    writeFileSync(existingPath, '{}\n', 'utf8');
    const snapshot = snapshotSourceTeamRunFiles(cleanupRoot);
    writeFileSync(residuePath, '{}\n', 'utf8');

    cleanupNewSourceTeamRunFiles(cleanupRoot, snapshot);

    assert.equal(existsSync(existingPath), true, 'cleanup must preserve pre-existing team runtime files');
    assert.equal(existsSync(residuePath), false, 'cleanup must remove validator-created source runtime residue');
  } finally {
    rmSync(path.dirname(cleanupRoot), { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (source-runtime-residue-cleanup)');
  return true;
}
