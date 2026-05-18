import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface MatrixPrChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface MatrixPrDiff {
  readonly schemaVersion: 'atm.matrixPrDiff.v0.1';
  readonly releaseVersion: string;
  readonly matrixPath: string;
  readonly hasChanges: boolean;
  readonly changes: MatrixPrChange[];
  readonly pullRequest: {
    readonly title: string;
    readonly body: string;
  };
}

const releaseVersion = readArg('--release-version') ?? process.env.RELEASE_VERSION ?? null;
const matrixPath = readArg('--matrix') ?? 'compatibility-matrix.json';
const diffOut = readArg('--diff-out');
const githubOutput = readArg('--github-output');
const shouldWrite = process.argv.includes('--write');

if (!releaseVersion || !parseSemver(releaseVersion)) {
  fail('MATRIX_PR_RELEASE_VERSION_INVALID', `--release-version must be semver, got ${releaseVersion ?? '<missing>'}`);
}

const absoluteMatrixPath = resolveRootPath(matrixPath);
if (!existsSync(absoluteMatrixPath)) {
  fail('MATRIX_PR_MATRIX_MISSING', `${matrixPath} must exist`);
}

const matrix = JSON.parse(readFileSync(absoluteMatrixPath, 'utf8'));
const diff = buildMatrixPrDiff(matrix, releaseVersion!, matrixPath);

if (shouldWrite) {
  writeFileSync(absoluteMatrixPath, `${JSON.stringify(applyMatrixRelease(matrix, releaseVersion!), null, 2)}\n`, 'utf8');
}

if (diffOut) {
  const absoluteDiffOut = resolveRootPath(diffOut);
  mkdirSync(path.dirname(absoluteDiffOut), { recursive: true });
  writeFileSync(absoluteDiffOut, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
}

if (githubOutput) {
  writeGitHubOutput(githubOutput, {
    has_changes: String(diff.hasChanges),
    release_version: releaseVersion!,
    pr_title: diff.pullRequest.title,
    pr_body: diff.pullRequest.body
  });
}

console.log(JSON.stringify(diff, null, 2));

export function buildMatrixPrDiff(inputMatrix: any, version: string, relativeMatrixPath = 'compatibility-matrix.json'): MatrixPrDiff {
  const nextMatrix = applyMatrixRelease(inputMatrix, version);
  const changes: MatrixPrChange[] = [];
  collectChange(changes, 'lastUpdated', inputMatrix.lastUpdated, nextMatrix.lastUpdated);
  collectChange(changes, 'releaseTrain.frameworkVersion', inputMatrix.releaseTrain?.frameworkVersion, nextMatrix.releaseTrain?.frameworkVersion);
  const diffBody = JSON.stringify({ schemaVersion: 'atm.matrixPrDiff.v0.1', releaseVersion: version, changes }, null, 2);
  return {
    schemaVersion: 'atm.matrixPrDiff.v0.1',
    releaseVersion: version,
    matrixPath: relativeMatrixPath,
    hasChanges: changes.length > 0,
    changes,
    pullRequest: {
      title: `chore(release): refresh compatibility matrix for ${version}`,
      body: [
        'This automated PR previews the compatibility matrix change for the release tag.',
        '',
        'Machine-readable diff:',
        '',
        '```json',
        diffBody,
        '```'
      ].join('\n')
    }
  };
}

function applyMatrixRelease(inputMatrix: any, version: string) {
  return {
    ...inputMatrix,
    lastUpdated: new Date().toISOString().slice(0, 10),
    releaseTrain: {
      ...(inputMatrix.releaseTrain ?? {}),
      frameworkVersion: version
    }
  };
}

function collectChange(changes: MatrixPrChange[], fieldPath: string, before: unknown, after: unknown) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    changes.push({ path: fieldPath, before, after });
  }
}

function parseSemver(value: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function resolveRootPath(relativePath: string) {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(root, relativePath);
}

function writeGitHubOutput(filePath: string, values: Record<string, string>) {
  const chunks: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const delimiter = `ATM_${key.toUpperCase()}_${Date.now()}`;
    chunks.push(`${key}<<${delimiter}\n${value}\n${delimiter}`);
  }
  writeFileSync(filePath, `${chunks.join('\n')}\n`, { encoding: 'utf8', flag: 'a' });
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(code: string, message: string): never {
  console.error(`[matrix-pr] FAIL code=${code} message=${message}`);
  process.exit(1);
}