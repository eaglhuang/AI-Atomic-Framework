#!/usr/bin/env node
// BUG-ATM-0045 reproduction — planning-root canonical preference.
//
// Run:  node scripts/repro/bug-atm-0045-planning-root-preference.mjs
// Exit: 0 = bug fixed, 1 = bug still present.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { resolveCandidatePlanningRoots } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/cli/src/commands/next/planning-root-preference.ts')).href
);

function fakeReadDir(parentDir, names) {
  return (directoryPath) => {
    if (path.resolve(directoryPath) !== path.resolve(parentDir)) return [];
    return names.map((name) => ({
      name,
      isDirectory: () => true,
      isFile: () => false
    }));
  };
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'bug-atm-0045-'));
let failures = 0;
const log = (...args) => console.log('[BUG-ATM-0045]', ...args);

try {
  const aafRepo = path.join(sandbox, 'AI-Atomic-Framework');
  const canonical = path.join(sandbox, '3KLife');
  const stale = path.join(sandbox, '3KLife-captain-dispatch-push');

  for (const repo of [aafRepo, canonical, stale]) {
    const taskDir = path.join(repo, 'docs', 'ai_atomic_framework', 'team-agents', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, 'TASK-DEMO-0001.task.md'),
      `---\nworkItemId: TASK-DEMO-0001\n---\n# Demo\n`,
      'utf8'
    );
  }

  const parent = path.dirname(path.resolve(aafRepo));
  const resolution = resolveCandidatePlanningRoots(aafRepo, {
    readDir: fakeReadDir(parent, ['AI-Atomic-Framework', '3KLife', '3KLife-captain-dispatch-push']),
    exists: existsSync
  });
  const candidates = resolution.roots;

  log('candidate planning roots:');
  for (const c of candidates) log('  -', c);
  if (resolution.excludedDerivativeRoots.length > 0) {
    log('excluded derivative roots:');
    for (const c of resolution.excludedDerivativeRoots) log('  -', c);
  }

  const canonicalHit = candidates.find((p) => p.startsWith(canonical + path.sep));
  const staleHit = candidates.find((p) => p.startsWith(stale + path.sep));

  if (canonicalHit && staleHit) {
    failures++;
    log('FAIL: both canonical and stale sibling planning roots are equal candidates');
    log('      canonical:', canonicalHit);
    log('      stale:    ', staleHit);
  } else if (!canonicalHit) {
    failures++;
    log('FAIL: canonical planning root missing from candidates');
  } else {
    log('PASS: stale derivative sibling was excluded from discovery');
  }
} finally {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
}

if (failures > 0) {
  log(`reproduced BUG-ATM-0045 (${failures} assertion failed)`);
  process.exit(1);
}
log('BUG-ATM-0045 appears fixed');
process.exit(0);
