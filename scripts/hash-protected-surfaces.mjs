import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSourceHashSnapshot } from '../packages/core/src/hash-lock/hash-lock.mjs';

export function syncProtectedSurfaceDigests(root) {
  const registryPath = path.join(root, 'atomic-registry.json');
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : null;
  const touched = [];
  const specPaths = new Set([
    ...listJsonFiles(path.join(root, 'specs')),
    ...listExampleAtomSpecs(path.join(root, 'examples'))
  ]);

  for (const entry of registry?.entries ?? []) {
    const relativeSpecPath = typeof entry?.specPath === 'string' ? entry.specPath : null;
    if (!relativeSpecPath) {
      continue;
    }
    const absoluteSpecPath = path.join(root, relativeSpecPath);
    if (existsSync(absoluteSpecPath)) {
      specPaths.add(absoluteSpecPath);
    }
  }

  const digestsBySpecPath = new Map();
  for (const filePath of [...specPaths]) {
    const digest = rewriteJsonDigest(filePath);
    if (digest) {
      digestsBySpecPath.set(relative(root, filePath), digest);
      touched.push(relative(root, filePath));
    }
  }

  if (registry) {
    let registryChanged = false;
    for (const entry of registry.entries ?? []) {
      const relativeSpecPath = typeof entry?.specPath === 'string' ? entry.specPath.replace(/\\/g, '/') : null;
      const digest = relativeSpecPath ? digestsBySpecPath.get(relativeSpecPath) : null;
      if (!digest) {
        continue;
      }
      if (entry.hashLock?.digest !== digest) {
        entry.hashLock = {
          ...(entry.hashLock ?? {}),
          algorithm: 'sha256',
          canonicalization: 'json-stable-v1',
          digest
        };
        registryChanged = true;
      }
      if (entry.selfVerification?.specHash !== undefined && entry.selfVerification.specHash !== digest) {
        entry.selfVerification = {
          ...entry.selfVerification,
          specHash: digest
        };
        registryChanged = true;
      }
      if (entry.selfVerification?.sourcePaths?.spec) {
        const current = createSourceHashSnapshot({
          repositoryRoot: root,
          specPath: entry.selfVerification.sourcePaths.spec,
          codePaths: entry.selfVerification.sourcePaths.code,
          testPaths: entry.selfVerification.sourcePaths.tests,
          legacyPlanningId: entry.selfVerification.legacyPlanningId ?? null
        });
        if (
          entry.selfVerification.specHash !== current.specHash
          || entry.selfVerification.codeHash !== current.codeHash
          || entry.selfVerification.testHash !== current.testHash
        ) {
          entry.selfVerification = {
            ...entry.selfVerification,
            specHash: current.specHash,
            codeHash: current.codeHash,
            testHash: current.testHash
          };
          registryChanged = true;
        }
      }
    }
    if (registryChanged) {
      writeJsonFile(registryPath, registry);
      touched.push(relative(root, registryPath));
    }
  }

  return {
    touched: [...new Set(touched)].sort((left, right) => left.localeCompare(right))
  };
}

export function computeCanonicalJsonDigestFromFile(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  return computeCanonicalJsonDigest(parsed);
}

export function computeCanonicalJsonDigest(value) {
  const normalized = normalizeForHash(value);
  const content = `${stableStringify(normalized)}\n`;
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function rewriteJsonDigest(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!parsed?.hashLock || typeof parsed.hashLock !== 'object') {
    return null;
  }
  const digest = computeCanonicalJsonDigest(parsed);
  if (parsed.hashLock.digest === digest && parsed.hashLock.algorithm === 'sha256' && parsed.hashLock.canonicalization === 'json-stable-v1') {
    return digest;
  }
  parsed.hashLock = {
    ...parsed.hashLock,
    algorithm: 'sha256',
    canonicalization: 'json-stable-v1',
    digest
  };
  writeJsonFile(filePath, parsed);
  return digest;
}

function normalizeForHash(value, pathParts = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeForHash(entry, [...pathParts, String(index)]));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      if (key === 'digest' && pathParts[pathParts.length - 1] === 'hashLock') {
        continue;
      }
      normalized[key] = normalizeForHash(value[key], [...pathParts, key]);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function listJsonFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

function listExampleAtomSpecs(examplesRoot) {
  if (!existsSync(examplesRoot)) {
    return [];
  }
  const files = [];
  for (const exampleEntry of readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!exampleEntry.isDirectory()) {
      continue;
    }
    const atomsDirectory = path.join(examplesRoot, exampleEntry.name, 'atoms');
    if (existsSync(atomsDirectory)) {
      files.push(...listJsonFiles(atomsDirectory));
    }
  }
  return files;
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}
