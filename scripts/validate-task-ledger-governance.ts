import { taskLedgerInvariantRegistry } from './lib/task-ledger-invariant-registry.ts';
import { runTaskLedgerIntegrationSuite } from './validators/task-ledger/suite-impl.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

if (taskLedgerInvariantRegistry.length !== 13) {
  console.error(`[task-ledger-governance:${mode}] expected 13 registry invariants, got ${taskLedgerInvariantRegistry.length}`);
  process.exitCode = 1;
} else {
  await runTaskLedgerIntegrationSuite();
  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] registry ok (${taskLedgerInvariantRegistry.length} invariants)`);
  }
}
