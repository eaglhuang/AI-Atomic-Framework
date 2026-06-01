import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertLocalTaskLedgerEnabled,
  buildTaskTransitionCommand,
  createClosureTransitionMetadata,
  inspectTaskVerifyStatus,
  normalizeWorkItemStatus,
} from '../../../packages/cli/src/commands/tasks/task-transition-helpers.ts';
import {
  listCommittedFilesSinceClaim,
  readGitScalar,
} from '../../../packages/cli/src/commands/tasks/task-git-helpers.ts';
import {
  collectKeyValue,
  collectKeyValueFromLines,
  createTaskFromTableMetadata,
  type HeadingSection,
} from '../../../packages/cli/src/commands/tasks/task-markdown-helpers.ts';

const spec = JSON.parse(readFileSync(new URL('./map.spec.json', import.meta.url), 'utf8'));

assert.equal(spec.schemaId, 'atm.atomicMap');
assert.equal(spec.mapId, 'ATM-MAP-0003');
assert.equal(spec.mapHash, 'sha256:c9ae8dfdc1b1f141cf334b7613a15c42e74d08de772a91190ca7f1d4d3fc1998');
assert.equal(spec.semanticFingerprint, 'sf:sha256:63016ee99867dea3577c8cb0485e60160cefca6f855170c5100a68b7e8b292a8');
assert.deepEqual(spec.entrypoints, ['ATM-TASK-0010']);
assert.equal(spec.members.length, 10);
assert.deepEqual(spec.qualityTargets, { promoteGateRequired: true, requiredChecks: 6 });

assert.equal(typeof assertLocalTaskLedgerEnabled, 'function');
assert.equal(typeof buildTaskTransitionCommand, 'function');
assert.equal(typeof createClosureTransitionMetadata, 'function');
assert.equal(typeof normalizeWorkItemStatus, 'function');
assert.equal(typeof inspectTaskVerifyStatus, 'function');
assert.equal(typeof readGitScalar, 'function');
assert.equal(typeof listCommittedFilesSinceClaim, 'function');
assert.equal(typeof collectKeyValue, 'function');
assert.equal(typeof collectKeyValueFromLines, 'function');
assert.equal(typeof createTaskFromTableMetadata, 'function');

assert.equal(normalizeWorkItemStatus('open'), 'ready');
assert.equal(normalizeWorkItemStatus('in_progress'), 'ready');
assert.deepEqual(inspectTaskVerifyStatus('closed'), {
  ok: true,
  normalizedStatus: 'done',
  warningCode: 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS',
});
assert.equal(buildTaskTransitionCommand({
  action: 'close',
  taskId: 'TASK-AAO-0102',
  actorId: 'codex-gpt-5',
  status: 'done',
}), 'node atm.mjs tasks close --task TASK-AAO-0102 --actor codex-gpt-5 --status done');
assert.equal(createClosureTransitionMetadata(null, null), null);
assert.equal(readGitScalar(process.cwd(), ['rev-parse', '--is-inside-work-tree']), 'true');
assert.deepEqual(listCommittedFilesSinceClaim(process.cwd(), null), {
  files: [],
  gitAvailable: false,
});

const headingSections: readonly HeadingSection[] = [
  {
    heading: 'TASK-AAO-0102',
    lines: [
      'Title: Map formation retry — ATM-MAP-0003 + integration test stub',
      'Status: open',
      'Deliverables: plan | map | report',
    ],
  },
];
assert.equal(collectKeyValue(headingSections, 'Status'), 'open');
assert.equal(collectKeyValueFromLines(headingSections[0].lines, 'Title'), 'Map formation retry — ATM-MAP-0003 + integration test stub');

const taskRecord = createTaskFromTableMetadata({
  metadata: {
    workItemId: 'TASK-AAO-0102',
    title: 'Map formation retry — ATM-MAP-0003 + integration test stub',
    status: 'open',
    milestone: null,
    dependencies: ['TASK-AAO-0100', 'TASK-AAO-0101'],
    deliverables: [
      'plans/TASK-AAO-0102-tasks-helpers-batch10.plan.json',
      'atomic_workbench/maps/ATM-MAP-0003/map.spec.json',
    ],
    rowText: 'TASK-AAO-0102 | Map formation retry — ATM-MAP-0003 + integration test stub',
    headingLine: 1,
  },
  planRelativePath: 'plans/TASK-AAO-0102-tasks-helpers-batch10.plan.json',
  importedAt: '2026-05-31T12:00:00.000Z',
  hashSection: (text: string) => `sha256:${text.length.toString(16)}`,
});

assert.equal(taskRecord.schemaVersion, 'atm.workItem.v0.2');
assert.equal(taskRecord.workItemId, 'TASK-AAO-0102');
assert.equal(taskRecord.source.planPath, 'plans/TASK-AAO-0102-tasks-helpers-batch10.plan.json');
assert.equal(taskRecord.source.sectionTitle, 'Map formation retry — ATM-MAP-0003 + integration test stub');
assert.equal(taskRecord.source.headingLine, 1);
assert.match(taskRecord.source.hash, /^sha256:/);

console.log('ATM-MAP-0003 map integration self-check ok');