import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
export const defaultRegistrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');

export function normalizeProjectPath(repositoryRoot: string, value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }
  return toProjectPath(repositoryRoot, resolveProjectPath(repositoryRoot, value));
}

export function normalizeSchemaPath(repositoryRoot: string, value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  const resolvedPath = resolveProjectPath(repositoryRoot, value);
  const repositoryRelative = toProjectPath(repositoryRoot, resolvedPath);
  if (repositoryRelative.startsWith('schemas/')) {
    return repositoryRelative;
  }

  const frameworkRelative = path.relative(repoRoot, resolvedPath).replace(/\\/g, '/');
  if (frameworkRelative && !frameworkRelative.startsWith('..') && frameworkRelative.startsWith('schemas/')) {
    return frameworkRelative;
  }

  return toPortablePath(resolvedPath);
}

export function resolveProjectPath(repositoryRoot: string, value: string): string {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(repositoryRoot, value);
}

export function toProjectPath(repositoryRoot: string, filePath: string): string {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relative;
}

export function normalizeStringArray(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

export function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/');
}
