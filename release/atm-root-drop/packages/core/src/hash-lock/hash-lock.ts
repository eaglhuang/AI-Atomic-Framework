import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface SourceHashSnapshotOptions {
  repositoryRoot?: string;
  legacyPlanningId?: string | null;
  specPath?: string;
  codePaths?: string[] | string;
  testPaths?: string[] | string;
}

export function computeSha256ForContent(content: string | Buffer) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function computeSha256ForFile(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  ensureFileExists(resolvedPath);
  return computeSha256ForContent(readHashBytes(resolvedPath));
}

export function computeSha256ForFiles(filePaths: string[] | string) {
  const normalizedPaths = normalizeInputPaths(process.cwd(), filePaths);
  if (normalizedPaths.length === 0) {
    throw new Error('At least one file path is required to compute a composite sha256 hash.');
  }

  const hash = createHash('sha256');
  for (const filePath of normalizedPaths) {
    ensureFileExists(filePath);
    hash.update(readHashBytes(filePath));
  }
  return `sha256:${hash.digest('hex')}`;
}

export function createSourceHashSnapshot(options: SourceHashSnapshotOptions) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const specPath = resolveInputPath(repositoryRoot, options.specPath);
  const codePaths = normalizeInputPaths(repositoryRoot, options.codePaths);
  const testPaths = normalizeInputPaths(repositoryRoot, options.testPaths);

  if (codePaths.length === 0) {
    throw new Error('At least one code path is required for registry self-verification.');
  }
  if (testPaths.length === 0) {
    throw new Error('At least one test path is required for registry self-verification.');
  }

  return {
    legacyPlanningId: options.legacyPlanningId ?? null,
    specHash: computeSha256ForFile(specPath),
    codeHash: computeSha256ForFiles(codePaths),
    testHash: computeSha256ForFiles(testPaths),
    sourcePaths: {
      spec: toProjectPath(repositoryRoot, specPath),
      code: codePaths.map((filePath) => toProjectPath(repositoryRoot, filePath)),
      tests: testPaths.map((filePath) => toProjectPath(repositoryRoot, filePath))
    }
  };
}

export function normalizeSourcePathList(value: string[] | string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function ensureFileExists(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Hash source file was not found: ${toPortablePath(filePath)}`);
  }
}

function resolveInputPath(repositoryRoot: string, value: string | undefined) {
  if (!value) {
    throw new Error('A required hash source path was not provided.');
  }
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(repositoryRoot, value);
}

function normalizeInputPaths(repositoryRoot: string, values: string[] | string | null | undefined): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list.map((value) => resolveInputPath(repositoryRoot, value));
}

function toProjectPath(repositoryRoot: string, filePath: string) {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relative;
}

function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}

function readHashBytes(filePath: string) {
  const raw = readFileSync(filePath);
  if (isLikelyText(raw)) {
    return Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  }
  return raw;
}

function isLikelyText(content: Buffer) {
  return !content.includes(0);
}
