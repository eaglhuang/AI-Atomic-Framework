import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRepositoryPhysicalLineBudget } from './validate-physical-line-budget.ts';
import { runAtm } from './validate-cli/context.ts';
import { inspectHelpSnapshots } from './validate-cli/help-snapshots.ts';
import { formatAtmResultLine } from './lib/atm-result-line.ts';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--log-file');
  const log = index >= 0 ? argv[index + 1] : `/tmp/atm-preclose-${process.pid}.log`;
  let code = 'PRECLOSE_OK';
  let hint = '';
  try {
    if (!log || log.startsWith('--')) throw new Error('--log-file requires a path');
    mkdirSync(path.dirname(log), { recursive: true });
    const writeLog = (message: string) => appendFileSync(log, `${message}\n`);
    const budget = inspectRepositoryPhysicalLineBudget(process.cwd());
    writeLog(JSON.stringify(budget));
    const drift = await inspectHelpSnapshots(process.cwd(), runAtm, writeLog);
    if (!budget.ok) {
      code = 'LINE_BUDGET_EXCEEDED';
      const entry = budget.hardViolations[0];
      hint = `${entry.file} has ${entry.lines} lines > ${budget.maxLines}; split it`;
    } else if (drift.length) {
      code = 'HELP_SNAPSHOT_DRIFT';
      hint = `help snapshot drift: ${drift.join(', ')}; run npm run help-snapshots:update`;
    }
  } catch (error) {
    code = 'PRECLOSE_FAILED';
    hint = (error as Error).message;
    if (log) {
      try { appendFileSync(log, `${hint}\n`); } catch {}
    }
  }
  const ok = code === 'PRECLOSE_OK';
  const result = { step: 'preclose-check', status: ok ? 'ok' as const : 'fail' as const, code, log: log || '-', hint };
  console.log(argv.includes('--json') ? JSON.stringify({ ok, ...result }) : formatAtmResultLine(result));
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
