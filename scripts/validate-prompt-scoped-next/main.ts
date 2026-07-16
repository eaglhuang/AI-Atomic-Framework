import { cleanupPromptScopedFixture, setupPromptScopedFixture } from './fixture.ts';
import { runRouteScenarios } from './route-scenarios.ts';
import { runBatchScenarios } from './batch-scenarios.ts';
import { runClaimScenarios } from './claim-scenarios.ts';
import { runImportScenarios } from './import-scenarios.ts';
import { runWorktreeTeamScenarios } from './worktree-team-scenarios.ts';

export async function main() {
  const ctx = setupPromptScopedFixture();
  try {
    await runRouteScenarios(ctx);
    await runBatchScenarios(ctx);
    await runClaimScenarios(ctx);
    await runImportScenarios(ctx);
    await runWorktreeTeamScenarios(ctx);
  } finally {
    cleanupPromptScopedFixture(ctx);
  }
}
