import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { fail, root, type FixturePaths } from './context.ts';
import { createImportWriteLease, expectOk } from './tasks.ts';

export async function runRouteHygieneScenarios(paths: FixturePaths, tempWorkspace: string): Promise<void> {
  const { npcPlan } = paths;
    // TASK-AAO-0128: 驗證 TASK-TEAM-0026 類型的 route pollution guard
    const pollutionTestPlanPath = path.join(tempWorkspace, 'pollution-test-plan.md');
    writeFileSync(pollutionTestPlanPath, `---
task_id: TASK-TEAM-0026
title: TEAM safe mirror/import ledger reconciliation lane
status: planned
scopePaths:
  - "packages/cli/src/commands/next.ts"
  - "packages/cli/src/commands/tasks.ts"
outOfScope:
  - "packages/cli/src/commands/team.ts"
  - "scripts/validate-team-agents.ts"
  - "docs/tasks/**"
---

## Goal
Avoid route scope pollution from prose text.
Here are some forbidden paths in text:
- packages/cli/src/commands/team.ts
- scripts/validate-team-agents.ts
- docs/tasks/tasks-team.json
`, 'utf8');

    await expectOk('import', ['--from', pollutionTestPlanPath, '--write', '--cwd', tempWorkspace]);

    const pollutionNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-TEAM-0026']);
    const pollutionQueue = (pollutionNextResult.evidence as {
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
          scopePaths: readonly string[];
        } | null
      }
    }).importedTaskQueue;

    const selectedTask = pollutionQueue?.selectedTask;
    if (!selectedTask || selectedTask.workItemId !== 'TASK-TEAM-0026') {
      fail(`TASK-AAO-0128 regression: failed to route TASK-TEAM-0026`);
    }

    const allowed = selectedTask?.targetAllowedFiles ?? [];
    const forbiddenPatterns = [
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts',
      'docs/tasks',
      'packages/cli/src/commands'
    ];

    for (const pat of forbiddenPatterns) {
      if (allowed.some((f) => f === pat || f.startsWith(pat + '/'))) {
        // packages/cli/src/commands/next.ts and tasks.ts are explicitly allowed, so bypass them
        if (pat === 'packages/cli/src/commands' && (allowed.every((f) => f === 'packages/cli/src/commands/next.ts' || f === 'packages/cli/src/commands/tasks.ts' || f.startsWith('.atm/')))) {
          continue;
        }
        fail(`TASK-AAO-0128 regression: TASK-TEAM-0026 targetAllowedFiles contains polluted path: ${pat}. Allowed files: ${JSON.stringify(allowed)}`);
      }
    }

    // TASK-AAO-0131: TEAM-0026 must keep planning/prose artifacts out of target work.
    const routeHygieneTeamPlanPath = path.join(tempWorkspace, 'route-hygiene-team-0026.md');
    writeFileSync(routeHygieneTeamPlanPath, `---
task_id: TASK-TEAM-0026
title: TEAM safe mirror/import ledger reconciliation lane
status: planned
planning_repo: 3KLife
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - ".atm/history/tasks/TASK-TEAM-000[1-9].json"
  - ".atm/history/tasks/TASK-TEAM-001[0-9].json"
  - ".atm/history/tasks/TASK-TEAM-0025.json"
  - ".atm/history/task-events/TASK-TEAM-000[1-9]/**"
  - ".atm/history/task-events/TASK-TEAM-001[0-9]/**"
  - ".atm/history/task-events/TASK-TEAM-0025/**"
outOfScope:
  - "docs/tasks/**"
  - "packages/cli/src/commands/**"
---

## Goal
Use TEAM-0026 as a safe mirror/import lane.

## Planning notes that must stay out of targetAllowedFiles
- docs/tasks/tasks-team.json
- packages/cli/src/commands/tasks.ts
- packages/cli/src/commands/next.ts
`, 'utf8');

    const teamHygieneLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies TEAM-0026 route hygiene force import behavior');
    await expectOk('import', ['--from', routeHygieneTeamPlanPath, '--write', '--force', '--emergency-approval', teamHygieneLeaseId, '--cwd', tempWorkspace]);
    const teamHygieneNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-TEAM-0026']);
    const teamHygieneTask = (teamHygieneNextResult.evidence as {
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
        } | null
      }
    }).importedTaskQueue?.selectedTask;

    if (!teamHygieneTask || teamHygieneTask.workItemId !== 'TASK-TEAM-0026') {
      fail(`TASK-AAO-0131 regression: failed to route TEAM-0026 hygiene fixture, got ${JSON.stringify(teamHygieneTask)}.`);
    }
    const teamAllowed = teamHygieneTask?.targetAllowedFiles ?? [];
    if (teamAllowed.some((file) => file === 'docs/tasks' || file.startsWith('docs/tasks/'))) {
      fail(`TASK-AAO-0131 regression: TEAM-0026 targetAllowedFiles must not contain docs/tasks artifacts, got ${JSON.stringify(teamAllowed)}.`);
    }
    if (teamAllowed.some((file) => file === 'packages/cli/src/commands' || file.startsWith('packages/cli/src/commands/'))) {
      fail(`TASK-AAO-0131 regression: TEAM-0026 targetAllowedFiles must not contain command surfaces, got ${JSON.stringify(teamAllowed)}.`);
    }

    // TASK-AAO-0131: planning_repo-only CID cards must remain mirror-sync only.
    const routeHygieneCidPlanPath = path.join(tempWorkspace, 'route-hygiene-cid-0005.md');
    writeFileSync(routeHygieneCidPlanPath, `---
task_id: TASK-CID-0005
title: P0 CID-first parallel conflict advisor CLI contract
status: planned
planning_repo: 3KLife
target_repo: 3KLife
closure_authority: planning_repo
scopePaths:
  - "docs/ai_atomic_framework/cid-hardening/CID-hardening-plan.md"
  - "docs/ai_atomic_framework/cid-hardening/tasks/TASK-CID-0005.task.md"
---

## Goal
This is a planning-repo contract. The CID word here must not synthesize a target alias.
`, 'utf8');

    const cidHygieneLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies planning_repo-only CID route hygiene force import behavior');
    await expectOk('import', ['--from', routeHygieneCidPlanPath, '--write', '--force', '--emergency-approval', cidHygieneLeaseId, '--cwd', tempWorkspace]);
    const cidHygieneNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-CID-0005']);
    const cidEvidence = cidHygieneNextResult.evidence as {
      nextAction?: { status?: string; recommendedChannel?: string };
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
          planningReadOnlyPaths: readonly string[];
        } | null
      }
    };
    const cidTask = cidEvidence.importedTaskQueue?.selectedTask;
    if (cidEvidence.nextAction?.status !== 'task-mirror-sync-required' || cidEvidence.nextAction?.recommendedChannel !== 'mirror-sync') {
      fail(`TASK-AAO-0131 regression: CID-0005 must route as mirror-sync-only, got ${JSON.stringify(cidEvidence.nextAction)}.`);
    }
    if (!cidTask || cidTask.workItemId !== 'TASK-CID-0005') {
      fail(`TASK-AAO-0131 regression: failed to route CID-0005 hygiene fixture, got ${JSON.stringify(cidTask)}.`);
    }
    if ((cidTask?.targetAllowedFiles ?? []).length > 0) {
      fail(`TASK-AAO-0131 regression: planning_repo-only CID-0005 must not expose targetAllowedFiles, got ${JSON.stringify(cidTask?.targetAllowedFiles)}.`);
    }
    if ((cidTask?.targetAllowedFiles ?? []).some((file) => file.includes('/CID') || file.includes('\\CID'))) {
      fail(`TASK-AAO-0131 regression: CID-0005 targetAllowedFiles must not contain synthetic CID aliases, got ${JSON.stringify(cidTask?.targetAllowedFiles)}.`);
    }

}
