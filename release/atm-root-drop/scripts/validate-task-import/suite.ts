import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertNoDuplicateAtmBacklogIds, findDuplicateAtmBacklogIds } from './backlog.ts';
import { fail, mode, root, type FixturePaths } from './context.ts';
import { runDryRunAndMetadataScenarios } from './dry-run-scenarios.ts';
import { runWriteAndRouteScenarios } from './write-route-scenarios.ts';

export async function main() {
  const samplePlan = path.join(root, 'fixtures/task-plan-import/sample-plan.md');
  const npcPlan = path.join(root, 'fixtures/task-plan-import/low-automation-plan.md');
  const singleCard = path.join(root, 'fixtures/task-plan-import/single-card.md');
  const duplicatePlan = path.join(root, 'fixtures/task-plan-import/duplicate-plan.md');
  const governanceTablePlan = path.join(root, 'fixtures/task-plan-import/governance-table-plan.md');
  const chineseBootstrapPlan = path.join(root, 'fixtures/task-plan-import/chinese-bootstrap-plan.md');
  const dispatchMetadataCard = path.join(root, 'fixtures/task-plan-import/dispatch-metadata-card.md');
  const canonicalAtmBacklog = path.join(root, 'docs/governance/atm-bug-and-optimization-backlog.md');

  for (const fixturePath of [samplePlan, npcPlan, singleCard, duplicatePlan, governanceTablePlan, chineseBootstrapPlan, dispatchMetadataCard, canonicalAtmBacklog]) {
    if (!existsSync(fixturePath)) {
      fail(`missing fixture: ${path.relative(root, fixturePath)}`);
      return;
    }
  }

  assertNoDuplicateAtmBacklogIds(readFileSync(canonicalAtmBacklog, 'utf8'), 'canonical ATM bug backlog');
  const duplicateBacklogFixture = [
    '| ID | Date | Repo | Type | Severity | Status | Area | Finding | Expected behavior | Evidence / Repro | Follow-up |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| ATM-BUG-2099-01-01-001 | 2099-01-01 | AI-Atomic-Framework | Bug | Medium | Open | Fixture | First | Expected | Evidence | Follow-up |',
    '| ATM-BUG-2099-01-01-001 | 2099-01-01 | AI-Atomic-Framework | Bug | Medium | Open | Fixture | Duplicate | Expected | Evidence | Follow-up |'
  ].join('\n');
  const duplicateFixtureIds = findDuplicateAtmBacklogIds(duplicateBacklogFixture);
  if (duplicateFixtureIds.join(',') !== 'ATM-BUG-2099-01-01-001') {
    fail(`duplicate backlog fixture must report its duplicate ID, got ${duplicateFixtureIds.join(',') || '<none>'}.`);
  }

  const fixturePaths: FixturePaths = {
    samplePlan,
    npcPlan,
    singleCard,
    duplicatePlan,
    governanceTablePlan,
    chineseBootstrapPlan,
    dispatchMetadataCard,
    canonicalAtmBacklog
  };
  await runDryRunAndMetadataScenarios(fixturePaths);
  await runWriteAndRouteScenarios(fixturePaths);

  if (!process.exitCode) {
    console.log(`[task-import:${mode}] ok (sample-plan + low-automation-plan + single-card + duplicate detection)`);
  }
}
