import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdmissionBench } from './lib/admission-bench/runner.ts';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function parseArgs(argv: readonly string[]): { seed: number; mode: 'smoke' | 'export-blind'; out?: string } {
  let seed = 20260625;
  let mode: 'smoke' | 'export-blind' = 'smoke';
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--seed') { seed = Number(argv[++i]); }
    else if (arg.startsWith('--seed=')) { seed = Number(arg.slice('--seed='.length)); }
    else if (arg === '--mode') { mode = argv[++i] as 'smoke' | 'export-blind'; }
    else if (arg.startsWith('--mode=')) { mode = arg.slice('--mode='.length) as 'smoke' | 'export-blind'; }
    else if (arg === '--out') { out = argv[++i]; }
    else if (arg.startsWith('--out=')) { out = arg.slice('--out='.length); }
    else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log('Usage: run-atm-admission-bench.ts [--seed N] [--mode smoke|export-blind] [--out DIR]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid --seed: ${seed}`);
  if (mode !== 'smoke' && mode !== 'export-blind') throw new Error(`invalid --mode: ${mode}`);
  return { seed, mode, out };
}

const { seed, mode, out } = parseArgs(process.argv.slice(2));
const outDir = out
  ? path.resolve(root, out)
  : path.resolve(root, mode === 'smoke'
    ? `artifacts/generated/atm-admission-bench/${seed}`
    : `artifacts/blind-bench/${seed}`);

const summary = runAdmissionBench({ root, seed, mode, outDir });

// eslint-disable-next-line no-console
console.log(JSON.stringify({
  mode,
  seed,
  outDir: path.relative(root, outDir).replace(/\\/g, '/'),
  scenarioCount: summary.scenarioCount,
  modeComparisons: summary.modeComparisons,
  expectationFailures: summary.expectationFailures,
  falseSafeRegressions: summary.falseSafeRegressions,
  shipSafe: summary.shipSafe
}, null, 2));

if (!summary.shipSafe) {
  process.exit(1);
}
