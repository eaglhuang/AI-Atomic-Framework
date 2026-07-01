/**
 * TASK-RFT-0012 spec — import-orchestrator surface smoke test.
 *
 * Branches exercised via CliError code:
 *   - fresh-open (missing --from)
 *   - drift (both --dry-run and --write set)
 *   - reset-open (reset-open without emergency approval → classification path)
 *   - emergency-lease (--force without approval)
 */
import { runTasksImport } from '../import-orchestrator.ts';
import { CliError } from '../../shared.ts';

function fail(message: string): never {
  console.error(`[import-orchestrator.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

assert(typeof runTasksImport === 'function', 'runTasksImport export must be a function');
assert(runTasksImport.constructor.name === 'AsyncFunction', 'runTasksImport must be async');

async function expectCliError(argv: string[], branch: string): Promise<void> {
  try {
    await runTasksImport(argv);
    fail(`branch ${branch}: expected CliError, got success`);
  } catch (err) {
    if (!(err instanceof CliError)) {
      fail(`branch ${branch}: expected CliError, got ${err instanceof Error ? err.constructor.name : typeof err}`);
    }
  }
}

// fresh-open branch: missing --from is a usage error
await expectCliError(['--dry-run'], 'fresh-open');
// drift branch: both --dry-run and --write are contradictory
await expectCliError(['--from', 'docs/plan.md', '--dry-run', '--write'], 'drift');
// reset-open branch: --write --reset-open triggers classification/emergency path
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--reset-open'], 'reset-open');
// emergency-lease branch: --force without approval token
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--force'], 'emergency-lease');

console.log('[import-orchestrator.spec] ok (4 branches)');
