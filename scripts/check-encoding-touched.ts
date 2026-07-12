import { spawnSync } from 'node:child_process';
import path from 'node:path';

type Mode = 'touched' | 'staged';

const cwd = process.cwd();
const args = process.argv.slice(2);
const mode = readOption('--mode') === 'staged' ? 'staged' : 'touched';
const explicitFiles = readFilesOption(args);
const files = resolveFiles(explicitFiles, mode);

if (files.length === 0) {
  console.log(`[check-encoding-${mode}] ok (no text files to check)`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ['atm.mjs', 'guard', 'encoding', '--files', files.join(','), '--json'], {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'inherit']
});

process.exit(typeof result.status === 'number' ? result.status : 1);

function resolveFiles(explicitFileArgs: string[], currentMode: Mode): string[] {
  const hasExplicitFiles = explicitFileArgs.length > 0;
  const candidates = hasExplicitFiles ? explicitFileArgs : gitChangedFiles(currentMode);
  return uniqueStrings(candidates.map(normalizePath).filter(isTextFile));
}

function readFilesOption(argv: string[]): string[] {
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--files') {
      let cursor = index + 1;
      while (cursor < argv.length && !(argv[cursor] ?? '').startsWith('--')) {
        files.push(...splitFileList(argv[cursor] ?? ''));
        cursor += 1;
      }
      index = cursor - 1;
      continue;
    }
    if (arg.startsWith('--files=')) {
      files.push(...splitFileList(arg.slice('--files='.length)));
    }
  }
  return files;
}

function readOption(flag: string): string | null {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1] ?? null;
  const prefix = `${flag}=`;
  const inline = args.find((entry) => entry.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

function gitChangedFiles(currentMode: Mode): string[] {
  const gitArgs = currentMode === 'staged'
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMRT']
    : ['diff', '--name-only', '--diff-filter=ACMRT'];
  const tracked = runGit(gitArgs);
  if (currentMode === 'staged') return tracked;
  return uniqueStrings([
    ...tracked,
    ...runGit(['ls-files', '--others', '--exclude-standard'])
  ]).filter((file) => !isDiagnosticArtifact(file));
}

function runGit(gitArgs: string[]): string[] {
  const result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    throw new Error(`git ${gitArgs.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return splitFileList(result.stdout);
}

function splitFileList(value: string): string[] {
  return String(value)
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePath(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isDiagnosticArtifact(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('tmp/')
    || normalized.startsWith('.atm/runtime/');
}

function isTextFile(filePath: string): boolean {
  return /\.(?:md|json|ts|tsx|js|jsx|mjs|cjs|yml|yaml|toml|ps1|sh|txt|html|css)$/i.test(filePath);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
