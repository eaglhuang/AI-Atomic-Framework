import { readFileSync } from 'node:fs';
import path from 'node:path';

interface ParsedArgs {
  readonly maxLines: number;
  readonly files: readonly string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let maxLines = 600;
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--max-lines') {
      maxLines = Number(argv[index + 1]);
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
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }
  if (files.length === 0) {
    throw new Error('Provide files with --files a,b,c or positional paths');
  }
  return { maxLines, files };
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = args.files
    .map((file) => ({ file: path.normalize(file), lines: countLines(file) }))
    .filter((entry) => entry.lines > args.maxLines);
  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, maxLines: args.maxLines, failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, maxLines: args.maxLines, files: args.files.length }, null, 2));
}

main();
