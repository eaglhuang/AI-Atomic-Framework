import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { type FixturePaths } from './context.ts';
import { runClaimGuardScenarios } from './claim-guard-scenarios.ts';
import { runRouteHygieneScenarios } from './route-hygiene-scenarios.ts';
import { runWriteScenarios } from './write-scenarios.ts';

export async function runWriteAndRouteScenarios(paths: FixturePaths): Promise<void> {
  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'atm-task-import-'));
  try {
    await runWriteScenarios(paths, tempWorkspace);
    await runRouteHygieneScenarios(paths, tempWorkspace);
    await runClaimGuardScenarios(paths, tempWorkspace);
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }
}
