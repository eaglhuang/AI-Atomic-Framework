import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOperationalBench } from './lib/admission-bench/operational-runner.ts';
import type { OperationalBenchProfileName } from './lib/admission-bench/operational-types.ts';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

interface Args {
  readonly profile: OperationalBenchProfileName;
  readonly seed: number;
  readonly out?: string;
}

function parseArgs(argv: readonly string[]): Args {
  let profile: OperationalBenchProfileName = 'paper';
  let seed = 20260627;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => argv[++i];
    if (arg === '--profile' || arg === '--mode') profile = take() as OperationalBenchProfileName;
    else if (arg.startsWith('--profile=')) profile = arg.slice('--profile='.length) as OperationalBenchProfileName;
    else if (arg.startsWith('--mode=')) profile = arg.slice('--mode='.length) as OperationalBenchProfileName;
    else if (arg === '--seed') seed = Number(take());
    else if (arg.startsWith('--seed=')) seed = Number(arg.slice('--seed='.length));
    else if (arg === '--out') out = take();
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: run-atm-operational-bench.ts [--profile smoke|paper|extended] [--seed N] [--out DIR]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!(['smoke', 'paper', 'extended'] as OperationalBenchProfileName[]).includes(profile)) {
    throw new Error(`invalid --profile: ${profile}`);
  }
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`invalid --seed: ${seed}`);
  }
  return { profile, seed, out };
}

function defaultOutDir(profile: OperationalBenchProfileName, seed: number): string {
  if (profile === 'paper' && seed === 20260627) {
    return path.join(root, 'artifacts', 'generated', 'atm-operational-bench', '20260627');
  }
  return path.join(root, 'artifacts', 'generated', 'atm-operational-bench', `${profile}-${seed}`);
}

const args = parseArgs(process.argv.slice(2));
const outDir = args.out ? path.resolve(root, args.out) : defaultOutDir(args.profile, args.seed);
const summary = runOperationalBench({ root, seed: args.seed, profile: args.profile, outDir });

console.log(JSON.stringify({
  bench: summary.benchName,
  profile: summary.profile,
  seed: summary.seed,
  outDir: path.relative(root, outDir).replace(/\\/g, '/'),
  scenarioCount: summary.scenarioCount,
  resultRows: summary.resultRows,
  recoveryMetrics: summary.recoveryMetrics
}, null, 2));
