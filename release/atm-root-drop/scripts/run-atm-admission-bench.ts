import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdmissionBench } from './lib/admission-bench/runner.ts';
import { runPaperProfile, type PaperTrack } from './lib/admission-bench/profile.ts';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

type Mode = 'smoke' | 'export-blind';
type Profile = 'smoke' | 'paper';

interface Args {
  seed: number;
  profile: Profile;
  track: PaperTrack;
  mode: Mode;
  out?: string;
}

function parseArgs(argv: readonly string[]): Args {
  let seed = 20260625;
  let profile: Profile = 'smoke';
  let track: PaperTrack = 'all';
  let mode: Mode = 'smoke';
  let out: string | undefined;
  let profileExplicit = false;
  let modeExplicit = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => argv[++i];
    if (arg === '--seed') seed = Number(take());
    else if (arg.startsWith('--seed=')) seed = Number(arg.slice('--seed='.length));
    else if (arg === '--profile') { profile = take() as Profile; profileExplicit = true; }
    else if (arg.startsWith('--profile=')) { profile = arg.slice('--profile='.length) as Profile; profileExplicit = true; }
    else if (arg === '--track') track = take() as PaperTrack;
    else if (arg.startsWith('--track=')) track = arg.slice('--track='.length) as PaperTrack;
    else if (arg === '--mode') { mode = take() as Mode; modeExplicit = true; }
    else if (arg.startsWith('--mode=')) { mode = arg.slice('--mode='.length) as Mode; modeExplicit = true; }
    else if (arg === '--out') out = take();
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: run-atm-admission-bench.ts [--profile smoke|paper] [--track all|policy|ablation|adversarial|forwarding|field|report] [--mode smoke|export-blind] [--seed N] [--out DIR]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid --seed: ${seed}`);
  if (profile !== 'smoke' && profile !== 'paper') throw new Error(`invalid --profile: ${profile}`);
  if (!(['all', 'policy', 'ablation', 'adversarial', 'forwarding', 'field', 'report'] as PaperTrack[]).includes(track)) {
    throw new Error(`invalid --track: ${track}`);
  }
  if (mode !== 'smoke' && mode !== 'export-blind') throw new Error(`invalid --mode: ${mode}`);
  if (modeExplicit && !profileExplicit) profile = 'smoke';
  return { seed, profile, track, mode, out };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.profile === 'paper') {
    const outDir = args.out
      ? path.resolve(root, args.out)
      : path.resolve(root, `artifacts/generated/atm-admission-bench/${args.seed}-paper`);
    const summary = runPaperProfile({ root, seed: args.seed, track: args.track, outDir });
    console.log(JSON.stringify({
      profile: 'paper',
      track: args.track,
      seed: args.seed,
      outDir: path.relative(root, outDir).replace(/\\/g, '/'),
      scenarioCount: summary.scenarioCount,
      modeComparisons: summary.modeComparisons,
      policyRows: summary.policyRows,
      ablationRows: summary.ablationRows,
      adversarialRows: summary.adversarialRows,
      unresolvedCount: summary.unresolvedCount,
      atmFullFalseSafeCount: summary.atmFullFalseSafeCount,
      unresolvedExcludedFromPrimary: summary.unresolvedExcludedFromPrimary
    }, null, 2));
    return;
  }

  const outDir = args.out
    ? path.resolve(root, args.out)
    : path.resolve(root, args.mode === 'smoke'
      ? `artifacts/generated/atm-admission-bench/${args.seed}`
      : `artifacts/blind-bench/${args.seed}`);
  const summary = runAdmissionBench({ root, seed: args.seed, mode: args.mode, outDir });
  console.log(JSON.stringify({
    profile: 'smoke',
    mode: args.mode,
    seed: args.seed,
    outDir: path.relative(root, outDir).replace(/\\/g, '/'),
    scenarioCount: summary.scenarioCount,
    modeComparisons: summary.modeComparisons,
    expectationFailures: summary.expectationFailures,
    falseSafeRegressions: summary.falseSafeRegressions,
    shipSafe: summary.shipSafe
  }, null, 2));
  if (!summary.shipSafe) process.exit(1);
}

main();
