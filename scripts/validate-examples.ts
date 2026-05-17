import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const examples = [
  {
    name: '@ai-atomic-framework/example-hello-world',
    directory: 'examples/hello-world',
    atomSpec: 'examples/hello-world/atoms/hello-world.atom.json',
    source: 'examples/hello-world/src/hello-world.atom.ts',
    expectedOutput: 'Hello, ATM!'
  },
  {
    name: '@ai-atomic-framework/example-legacy-strangler-minimal',
    directory: 'examples/legacy-strangler-minimal',
    atomSpec: 'examples/legacy-strangler-minimal/atoms/legacy-greeting.atom.json',
    source: 'examples/legacy-strangler-minimal/src/greeting.atom.ts',
    expectedOutput: 'Welcome back, team.'
  },
  {
    name: '@ai-atomic-framework/example-atom-evolution-loop',
    directory: 'examples/atom-evolution-loop',
    atomSpec: 'examples/atom-evolution-loop/atoms/evolution-target.atom.json',
    source: 'examples/atom-evolution-loop/src/evolution-target.atom.ts',
    expectedOutput: '[example:evolution-loop]'
  }
];

const conversationLearningLoopExample = {
  directory: 'examples/conversation-learning-loop',
  fixture: 'examples/conversation-learning-loop/fixtures/demo-transcript.json',
  runner: 'examples/conversation-learning-loop/run.ts',
  readme: 'examples/conversation-learning-loop/README.md',
  expectedOutput: '[example:conversation-learning-loop] ok'
};

const bannedProtectedSurfaceTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

function fail(message: any) {
  console.error(`[examples:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function run(command: any, args: any, options: any = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options
  });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runNpm(args: any) {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return run(process.execPath, [process.env.npm_execpath, ...args]);
  }
  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(bundledNpmCli)) {
    return run(process.execPath, [bundledNpmCli, ...args]);
  }
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
}

function parseCliJson(result: any, label: any) {
  const payload = (result.stdout || result.stderr || '').trim();
  try {
    return JSON.parse(payload);
  } catch (error: any) {
    fail(`${label} did not emit JSON: ${payload || error.message}`);
    return {};
  }
}

for (const example of examples) {
  for (const relativePath of [example.directory, example.atomSpec, example.source, `${example.directory}/package.json`, `${example.directory}/README.md`]) {
    assert(existsSync(path.join(root, relativePath)), `missing example file: ${relativePath}`);
  }

  const packageJson = JSON.parse(readFileSync(path.join(root, example.directory, 'package.json'), 'utf8'));
  assert(packageJson.name === example.name, `${example.directory}/package.json name mismatch`);
  for (const scriptName of ['test', 'typecheck', 'lint']) {
    assert(Boolean(packageJson.scripts?.[scriptName]), `${example.directory}/package.json missing script: ${scriptName}`);
  }

  const testResult = runNpm(['--workspace', example.name, 'test']);
  const testOutput = testResult.stdout || '';
  assert(testOutput.includes(example.expectedOutput) || testOutput.includes('[example:'), `${example.name} test output missing expected evidence`);

  const validateSpec = run(process.execPath, ['atm.mjs', 'validate', '--spec', example.atomSpec]);
  const validateSpecJson = parseCliJson(validateSpec, `${example.name} spec validation`);
  assert(validateSpecJson.ok === true, `${example.name} spec validation failed`);

  const spec = JSON.parse(readFileSync(path.join(root, example.atomSpec), 'utf8'));
  assert(spec.schemaId === 'atm.atomicSpec', `${example.atomSpec} schemaId mismatch`);
  assert(spec.compatibility?.languageAdapter === 'language-js', `${example.atomSpec} must use language-js compatibility`);
}

for (const relativePath of [
  conversationLearningLoopExample.directory,
  conversationLearningLoopExample.fixture,
  conversationLearningLoopExample.runner,
  conversationLearningLoopExample.readme
]) {
  assert(existsSync(path.join(root, relativePath)), `missing conversation learning loop example file: ${relativePath}`);
}

const conversationLearningResult = run(process.execPath, ['--experimental-strip-types', conversationLearningLoopExample.runner]);
assert(
  (conversationLearningResult.stdout || '').includes(conversationLearningLoopExample.expectedOutput),
  'conversation learning loop example output missing expected smoke marker'
);

const tempRoot = createTempWorkspace('atm-examples-');
try {
  const initResult = run(process.execPath, ['atm.mjs', 'init', '--cwd', tempRoot]);
  const initJson = parseCliJson(initResult, 'temp init');
  assert(initJson.ok === true, 'standalone init for examples must pass');
  assert(existsSync(path.join(tempRoot, '.atm', 'config.json')), 'standalone init must create .atm/config.json');

  const statusResult = run(process.execPath, ['atm.mjs', 'status', '--cwd', tempRoot]);
  const statusJson = parseCliJson(statusResult, 'temp status');
  assert(statusJson.ok === true, 'standalone status for examples must pass');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const quickStartPath = path.join(root, 'docs', 'QUICK_START.md');
const quickStart = readFileSync(quickStartPath, 'utf8');
for (const expectedCommand of [
  'npm install',
  'npm run packages:list',
  'npm run validate:examples',
  'npm --workspace @ai-atomic-framework/example-hello-world test',
  'npm --workspace @ai-atomic-framework/example-legacy-strangler-minimal test'
]) {
  assert(quickStart.includes(expectedCommand), `QUICK_START.md missing command: ${expectedCommand}`);
}

const protectedFiles = [
  'docs/QUICK_START.md',
  'scripts/validate-examples.ts',
  conversationLearningLoopExample.fixture,
  conversationLearningLoopExample.runner,
  conversationLearningLoopExample.readme,
  ...examples.flatMap((example) => [
    `${example.directory}/package.json`,
    `${example.directory}/README.md`,
    example.atomSpec,
    example.source
  ])
];

for (const relativePath of protectedFiles) {
  const content = readFileSync(path.join(root, relativePath), 'utf8');
  for (const term of bannedProtectedSurfaceTerms) {
    assert(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
  }
}

if (!process.exitCode) {
  console.log(`[examples:${mode}] ok (${examples.length} examples, quick start verified)`);
}
