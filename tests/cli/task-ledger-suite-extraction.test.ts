import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assert,
  assertSandboxDiagnosticsAreActionable,
  validateTaskLedgerReadersAtomization
} from '../../scripts/validators/task-ledger/suite-impl.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function lineCount(relativePath: string): number {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8').split(/\r?\n/).length;
}

function assertBounded(relativePath: string) {
  assert(existsSync(path.join(repoRoot, relativePath)), `${relativePath} must exist`);
  assert(lineCount(relativePath) <= 600, `${relativePath} must stay at or below 600 lines`);
}

async function main() {
  const boundedFiles = [
    'scripts/validators/task-ledger/suite-impl.ts',
    'scripts/validators/task-ledger/suite-impl/implementation.ts',
    'scripts/validators/task-ledger/ledger-readers-atomization.ts',
    'scripts/validators/task-ledger/planning-only-audit-boundary.ts',
    'scripts/validators/task-ledger/residue-classification.ts',
    'scripts/validators/task-ledger/taskflow-close-orchestration.ts',
    'scripts/validators/task-ledger/task-import-refresh-claim-preservation.ts'
  ];
  for (const relativePath of boundedFiles) {
    assertBounded(relativePath);
  }

  const facade = readFileSync(path.join(repoRoot, 'scripts/validators/task-ledger/suite-impl.ts'), 'utf8');
  assert(facade.includes("export * from './suite-impl/implementation.ts';"), 'suite facade must re-export implementation');

  assertSandboxDiagnosticsAreActionable();
  assert(typeof validateTaskLedgerReadersAtomization === 'function', 'task-ledger reader validator must remain exported');
}

await main();
