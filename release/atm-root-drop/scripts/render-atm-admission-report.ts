import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFromArtifactDir } from './lib/admission-bench/report.ts';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');

interface Args { seed: number; dir?: string }

function parseArgs(argv: readonly string[]): Args {
  let seed = 20260625;
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg.startsWith('--seed=')) seed = Number(arg.slice('--seed='.length));
    else if (arg === '--dir') dir = argv[++i];
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: render-atm-admission-report.ts [--seed N] [--dir DIR]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid --seed: ${seed}`);
  return { seed, dir };
}

const args = parseArgs(process.argv.slice(2));
const targetDir = args.dir
  ? path.resolve(root, args.dir)
  : path.resolve(root, `artifacts/generated/atm-admission-bench/${args.seed}-paper`);
renderFromArtifactDir(targetDir);
console.log(JSON.stringify({ rendered: path.relative(root, path.join(targetDir, 'paper-tables.md')).replace(/\\/g, '/') }, null, 2));
