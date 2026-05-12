import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';

const requiredFiles = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md',
  'docs/ECOSYSTEM_POSITIONING.md',
  'docs/governance/DOCS_NEUTRALITY_AUDIT.md',
  'docs/governance/docs-neutrality-policy.json',
  'package.json',
  'package-lock.json',
  'turbo.json'
];

const requiredReadmePhrases = [
  'is not just an atom runner',
  'release-bundle root-drop bootstrap workflow',
  'Default Governance Bundle is the official default experience',
  'not a `packages/core` hard dependency',
  'toolchain is a recommendation, not a semantic requirement',
  'Core Contracts',
  'Agent Operating Layer',
  'Plugins',
  'Adapters'
];

const requiredPositioningPhrases = [
  'Atomic Agents',
  'Specification-Driven Development',
  'Harness Engineering',
  'LangGraph',
  'Core vs Adapter vs Plugin'
];

const docsNeutralityPolicyPath = 'docs/governance/docs-neutrality-policy.json';

function readRelative(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function normalizeRelative(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function listRelativeFiles(relativeDir) {
  const fullDir = path.join(root, relativeDir);
  if (!existsSync(fullDir)) {
    return [];
  }
  const results = [];
  for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
    const relativeEntry = normalizeRelative(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      results.push(...listRelativeFiles(relativeEntry));
      continue;
    }
    results.push(relativeEntry);
  }
  return results;
}

function basename(relativePath) {
  return normalizeRelative(relativePath).split('/').pop();
}

function pathMatchesScope(relativePath, scope) {
  const normalizedPath = normalizeRelative(relativePath);
  if (scope.pathPrefix) {
    if (!normalizedPath.startsWith(normalizeRelative(scope.pathPrefix))) {
      return false;
    }
  } else {
    const normalizedRoot = normalizeRelative(scope.path);
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return false;
    }
  }
  if (Array.isArray(scope.excludePrefixes) && scope.excludePrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    return false;
  }
  if (Array.isArray(scope.extensions) && scope.extensions.length > 0 && !scope.extensions.some((extension) => normalizedPath.endsWith(extension))) {
    return false;
  }
  if (Array.isArray(scope.fileNames) && scope.fileNames.length > 0 && !scope.fileNames.includes(basename(normalizedPath))) {
    return false;
  }
  return true;
}

function scopeEnumerationRoot(scope) {
  if (scope.path) {
    return scope.path;
  }
  if (scope.pathPrefix) {
    const normalizedPrefix = normalizeRelative(scope.pathPrefix).replace(/\/$/, '');
    const slashIndex = normalizedPrefix.lastIndexOf('/');
    return slashIndex >= 0 ? normalizedPrefix.slice(0, slashIndex) : '.';
  }
  return '.';
}

function fail(message) {
  console.error(`[product-charter:${mode}] ${message}`);
  process.exitCode = 1;
}

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(root, relativePath))) {
    fail(`missing required file: ${relativePath}`);
  }
}

if (!process.exitCode) {
  const readme = readRelative('README.md');
  for (const phrase of requiredReadmePhrases) {
    if (!readme.includes(phrase)) {
      fail(`README.md missing required phrase: ${phrase}`);
    }
  }

  const positioning = readRelative('docs/ECOSYSTEM_POSITIONING.md');
  for (const phrase of requiredPositioningPhrases) {
    if (!positioning.includes(phrase)) {
      fail(`docs/ECOSYSTEM_POSITIONING.md missing required phrase: ${phrase}`);
    }
  }

  const packageJson = JSON.parse(readRelative('package.json'));
  for (const scriptName of ['build', 'test', 'typecheck', 'lint', 'validate:quick', 'validate:standard', 'validate:full']) {
    if (!packageJson.scripts?.[scriptName]) {
      fail(`package.json missing script: ${scriptName}`);
    }
  }

  const docsNeutralityPolicy = JSON.parse(readRelative(docsNeutralityPolicyPath));
  const auditDoc = readRelative(docsNeutralityPolicy.auditDocPath);
  for (const section of docsNeutralityPolicy.requiredAuditSections ?? []) {
    if (!auditDoc.includes(section)) {
      fail(`${docsNeutralityPolicy.auditDocPath} missing required section: ${section}`);
    }
  }

  const protectedFiles = new Set(docsNeutralityPolicy.protectedFiles ?? []);
  for (const scope of docsNeutralityPolicy.protectedScopes ?? []) {
    for (const relativePath of listRelativeFiles(scopeEnumerationRoot(scope))) {
      if (pathMatchesScope(relativePath, scope)) {
        protectedFiles.add(relativePath);
      }
    }
  }

  for (const relativePath of protectedFiles) {
    const content = readRelative(relativePath);
    for (const term of docsNeutralityPolicy.bannedTerms ?? []) {
      if (content.includes(term)) {
        fail(`${relativePath} contains downstream-only term: ${term}`);
      }
    }
  }
}

if (!process.exitCode) {
  console.log(`[product-charter:${mode}] ok`);
}
