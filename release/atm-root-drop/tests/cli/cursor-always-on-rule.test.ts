import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atm = (cwd: string, args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'atm.dev.mjs'), ...args, '--cwd', cwd, '--json'], { cwd, encoding: 'utf8' });

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-cursor-rule-'));
try {
  assert.equal(atm(cwd, ['bootstrap']).status, 0);
  const add = atm(cwd, ['integration', 'add', 'cursor']);
  assert.equal(add.status, 0, add.stdout + add.stderr);

  const rulePath = path.join(cwd, '.cursor', 'rules', 'atm-governance.mdc');
  assert.ok(existsSync(rulePath), 'cursor integration installs an always-on rule');
  const rule = readFileSync(rulePath, 'utf8');
  assert.match(rule, /^---\n[\s\S]*alwaysApply: true[\s\S]*\n---\n/, 'the rule is always applied');
  assert.ok(rule.includes('read `.cursor/rules/skills/atm-governance-router/SKILL.md` and follow its first-run runtime/target inspection'), 'the always-on rule delegates to the canonical first-run entry');
  assert.ok(rule.includes('evidence.nextAction.playbook') && rule.includes('edit only inside the scope ATM returns'), 'first-run delegation retains playbook and scope authority');
  assert.ok(!rule.includes('Before user-requested work, run `node atm.mjs next'), 'the native bridge must not skip first-run inspection');
  assert.ok(existsSync(path.join(cwd, '.cursor', 'rules', 'skills', 'atm-governance-router', 'SKILL.md')), 'skills keep their install path');

  const verify = atm(cwd, ['integration', 'verify', 'cursor']);
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: cursor integration installs an always-on ATM rule');
