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
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json'
];

const requiredReadmePhrases = [
  'is not just an atom runner',
  'root-drop, zero-install agent bootstrap',
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

const bannedProtectedSurfaceTerms = [
  '3KLife',
  'Cocos',
  'cocos-creator',
  'html-to-ucuf',
  'gacha',
  'UCUF',
  'draft-builder',
  'task-lock',
  'compute-gate',
  'doc-id-registry',
  'tools_node/',
  'assets/scripts/',
  'docs/agent-briefs/'
];

function readRelative(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
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
  for (const scriptName of ['test', 'typecheck', 'lint']) {
    if (!packageJson.scripts?.[scriptName]) {
      fail(`package.json missing script: ${scriptName}`);
    }
  }
}

const protectedFiles = [
  'README.md',
  'CONTRIBUTING.md',
  ...readdirSync(path.join(root, 'docs'))
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `docs/${entry}`)
];

for (const relativePath of protectedFiles) {
  const content = readRelative(relativePath);
  for (const term of bannedProtectedSurfaceTerms) {
    if (content.includes(term)) {
      fail(`${relativePath} contains downstream-only term: ${term}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[product-charter:${mode}] ok`);
}