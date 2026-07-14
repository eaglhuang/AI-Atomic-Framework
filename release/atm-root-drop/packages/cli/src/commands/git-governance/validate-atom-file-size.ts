import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAtomizationLinePolicy } from '../tasks/task-import-validators.ts';

interface ParsedArgs {
  readonly maxLinesOverride: number | null;
  readonly files: readonly string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let maxLinesOverride: number | null = null;
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--max-lines') {
      maxLinesOverride = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--files') {
      files.push(...String(argv[index + 1] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    files.push(value);
  }
  if (maxLinesOverride !== null && (!Number.isInteger(maxLinesOverride) || maxLinesOverride < 1)) {
    throw new Error('--max-lines must be a positive integer');
  }
  if (files.length === 0) {
    throw new Error('Provide files with --files a,b,c or positional paths');
  }
  return { maxLinesOverride, files };
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = resolveAtomizationLinePolicy({ config: readRepoConfig(process.cwd()), overrideMaxLines: args.maxLinesOverride });
  const failures = args.files
    .map((file) => ({ file: path.normalize(file), lines: countLines(file) }))
    .filter((entry) => entry.lines > policy.maxLines);
  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, maxLines: policy.maxLines, policy, failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, maxLines: policy.maxLines, policy, files: args.files.length }, null, 2));
}

main();
