import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export function formatTimestampTag(isoTimestamp: string): string {
  const parsedMs = Date.parse(isoTimestamp || '');
  const safeIso = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : new Date().toISOString();
  const compact = safeIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return compact.replace('T', '-');
}

export function listFiles(dir: string, extensions: string[] | null = null): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => {
      if (statSync(filePath).isDirectory()) {
        return false;
      }
      if (!extensions) {
        return true;
      }
      return extensions.includes(path.extname(filePath).toLowerCase());
    })
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs || left.localeCompare(right));
}

export function uniquePath(targetPath: string): string {
  if (!existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  for (let index = 2; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

export function sanitizeFileName(value: unknown): string {
  return String(value || 'item')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

export function escapeFrontMatterValue(value: unknown): string {
  return String(value).replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
}

export function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
