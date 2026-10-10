#!/usr/bin/env node
// A/B mechanics smoke: baseline arm only (real git clones + merge + test gate).
// Scripted agent patches, no LLM. Results are MECHANICS, not product evidence.
// The ATM arm and token/cost metrics are reported as null (unavailable).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]] : null).filter(Boolean));
const outDir = args.out ?? join(tmpdir(), 'ab-mechanics-smoke');
const keep = args.keep === 'true';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (cwd, ...a) => { try { git(cwd, ...a); return true; } catch { return false; } };
const runTests = (cwd) => {
  const files = readdirSync(join(cwd, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => join('test', f));
  try { execFileSync(process.execPath, ['--test', ...files], { cwd, stdio: 'ignore' }); return true; } catch { return false; }
};

const BASE_FILES = {
  'src/math.js': 'export function add(a, b) {\n  return a + b;\n}\n\nexport function mul(a, b) {\n  return a * b;\n}\n',
  'src/format.js': "import { add } from './math.js';\nexport function fmt(a, b) {\n  return `sum=${add(a, b)}`;\n}\n",
  'test/math.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add, mul } from '../src/math.js';\ntest('add', () => assert.equal(add(1, 2), 3));\ntest('mul', () => assert.equal(mul(2, 3), 6));\n",
  'test/format.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { fmt } from '../src/format.js';\ntest('fmt', () => assert.equal(fmt(1, 2), 'sum=3'));\n",
};

// Scripted "agents": each returns a map of file -> new content, or a patch function.
const SCENARIOS = [
  { id: 'S1-disjoint', agents: [
    { name: 'a1', edit: { 'src/extra.js': 'export const X = 1;\n' } },
    { name: 'a2', edit: { 'src/other.js': 'export const Y = 2;\n' } },
  ] },
  { id: 'S2-same-line', agents: [
    { name: 'a1', edit: { 'src/math.js': BASE_FILES['src/math.js'].replace('return a + b;', 'return Number(a) + Number(b);') } },
    { name: 'a2', edit: { 'src/math.js': BASE_FILES['src/math.js'].replace('return a + b;', 'return a + b + 0;') } },
  ] },
  { id: 'S3-semantic-break', agents: [
    // a1 renames mul -> multiply in src + its own test: passes alone and is textually clean.
    { name: 'a1', edit: {
      'src/math.js': BASE_FILES['src/math.js'].replace('export function mul', 'export function multiply'),
      'test/math.test.js': BASE_FILES['test/math.test.js'].replace(/mul/g, 'multiply'),
    } },
    // a2 adds a new file that still imports mul: passes alone, breaks on merged main.
    { name: 'a2', edit: { 'src/uses-mul.js': "import { mul } from './math.js';\nexport const z = mul(2, 2);\n", 'test/uses-mul.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { z } from '../src/uses-mul.js';\ntest('z', () => assert.equal(z, 4));\n" } },
  ] },
];

function makeRepo(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(BASE_FILES)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), c); }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'smoke@local'); git(dir, 'config', 'user.name', 'smoke');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function runBaseline(root, scenario) {
  const central = makeRepo(root, `${scenario.id}-central`);
  const metrics = { conflicts: 0, retries: 0, recoveryMs: [], missedBreaks: 0, agentGreen: 0, mergedGreen: null };
  const pendingMerges = [];
  for (const agent of scenario.agents) {
    const clone = join(root, `${scenario.id}-${agent.name}`);
    git(root, 'clone', '-q', central, clone);
    git(clone, 'config', 'user.email', 'smoke@local'); git(clone, 'config', 'user.name', 'smoke');
    for (const [f, c] of Object.entries(agent.edit)) { mkdirSync(join(clone, f, '..'), { recursive: true }); writeFileSync(join(clone, f), c); }
    git(clone, 'checkout', '-q', '-b', agent.name); git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', agent.name);
    if (runTests(clone)) metrics.agentGreen++;
    pendingMerges.push({ agent, clone });
  }
  // Sequential integration into central main, git-native: merge; on conflict abort, rebase, retry.
  for (const { agent, clone } of pendingMerges) {
    git(central, 'fetch', '-q', clone, agent.name);
    const t0 = Date.now();
    let merged = tryGit(central, 'merge', '--no-edit', '-q', 'FETCH_HEAD');
    if (!merged) {
      metrics.conflicts++;
      tryGit(central, 'merge', '--abort');
      metrics.retries++;
      // Retry: rebase the agent branch onto central main in its clone, then fast-forward.
      git(clone, 'fetch', '-q', central, 'main');
      merged = tryGit(clone, 'rebase', 'FETCH_HEAD');
      if (merged) {
        git(central, 'fetch', '-q', clone, agent.name);
        merged = tryGit(central, 'merge', '--ff-only', '-q', 'FETCH_HEAD');
      } else {
        tryGit(clone, 'rebase', '--abort');
      }
      metrics.recoveryMs.push(Date.now() - t0);
    }
    if (!merged) metrics.unresolvedAfterRetry = (metrics.unresolvedAfterRetry ?? 0) + 1;
  }
  // The CI gate: does merged main pass tests?
  const mainGreen = runTests(central);
  metrics.mergedGreen = mainGreen;
  // A "missed break" = every agent passed alone but merged main fails.
  if (!mainGreen && metrics.agentGreen === scenario.agents.length) metrics.missedBreaks = 1;
  return metrics;
}

const root = mkdtempSync(join(tmpdir(), 'ab-smoke-'));
const results = [];
for (const s of SCENARIOS) {
  const t0 = Date.now();
  const m = runBaseline(root, s);
  results.push({ scenario: s.id, arm: 'baseline-git', ...m, wallMs: Date.now() - t0,
    tokens: null, billedCost: null, notes: 'ATM arm and token/cost telemetry not measured here' });
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ schemaId: 'ab-mechanics-smoke.v0', kind: 'mechanics-only', results }, null, 2) + '\n');
console.log(JSON.stringify({ outDir, scenarios: results.length }));
if (!keep) rmSync(root, { recursive: true, force: true });
