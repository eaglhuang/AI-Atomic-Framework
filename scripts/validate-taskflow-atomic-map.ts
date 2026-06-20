import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('docs/reports/taskflow-command-atomic-map.md');
const requiredSnippets = [
  'packages/cli/src/commands/taskflow.ts',
  'packages/cli/src/commands/taskflow/close-preflight.ts',
  'packages/cli/src/commands/taskflow/write-readiness.ts',
  'packages/cli/src/commands/taskflow/broker-gate.ts',
  'packages/cli/src/commands/taskflow/branch-commit-queue-gate.ts',
  'packages/cli/src/commands/taskflow/closeback-orchestration.ts',
  'packages/cli/src/commands/taskflow/commit-bundle-assembly.ts'
];

if (!existsSync(reportPath)) {
  console.error(`ATM_TASKFLOW_ATOMIC_MAP_MISSING ${reportPath}`);
  process.exit(1);
}

const content = readFileSync(reportPath, 'utf8');
const missing = requiredSnippets.filter((snippet) => !content.includes(snippet));
if (missing.length > 0) {
  console.error(`ATM_TASKFLOW_ATOMIC_MAP_INCOMPLETE missing entries: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[taskflow-atomic-map] ok (${requiredSnippets.length} atoms documented)`);
