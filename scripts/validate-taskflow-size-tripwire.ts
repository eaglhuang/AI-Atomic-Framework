import { readFileSync } from 'node:fs';
import path from 'node:path';

const LIMIT = 2200;
const taskflowPath = path.resolve('packages/cli/src/commands/taskflow.ts');
const lineCount = readFileSync(taskflowPath, 'utf8').split(/\r?\n/).length;

if (lineCount > LIMIT) {
  console.error(`ATM_TASKFLOW_SIZE_TRIPWIRE_FIRED taskflow.ts has ${lineCount}/${LIMIT} lines. Revisit TASK-RFT-0008 and open the next taskflow refactor card.`);
  process.exit(1);
}

console.log(`[taskflow-size-tripwire] ok (${lineCount}/${LIMIT})`);
