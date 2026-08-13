import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function writeJsonWithRetry(input: {
  readonly filePath: string;
  readonly value: unknown;
  readonly retries?: number;
}): void {
  const retries = input.retries ?? 3;
  const payload = `${JSON.stringify(input.value, null, 2)}\n`;
  const tempPath = `${input.filePath}.tmp-${process.pid}-${Date.now()}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      writeFileSync(tempPath, payload, 'utf8');
      renameSync(tempPath, input.filePath);
      return;
    } catch (error) {
      lastError = error;
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
    }
  }
  throw lastError;
}

export function syncDirectoryHashChanged(source: string, target: string, options?: { readonly preserveRelativePaths?: readonly string[] }): void {
  if (!existsSync(source)) return;
  const preserved = new Set((options?.preserveRelativePaths ?? []).map((entry) => entry.replace(/\\/g, '/')));
  mkdirSync(target, { recursive: true });
  const expected = new Set<string>();
  for (const sourceFile of walkFiles(source)) {
    const relative = path.relative(source, sourceFile);
    const normalizedRelative = relative.replace(/\\/g, '/');
    expected.add(normalizedRelative);
    if (preserved.has(normalizedRelative)) continue;
    const targetFile = path.join(target, relative);
    mkdirSync(path.dirname(targetFile), { recursive: true });
    if (existsSync(targetFile) && fileDigest(targetFile) === fileDigest(sourceFile)) continue;
    cpSync(sourceFile, targetFile);
  }
  for (const targetFile of walkFiles(target)) {
    const relative = path.relative(target, targetFile).replace(/\\/g, '/');
    if (!expected.has(relative) && !preserved.has(relative)) unlinkSync(targetFile);
  }
}

export function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex')}`;
}
