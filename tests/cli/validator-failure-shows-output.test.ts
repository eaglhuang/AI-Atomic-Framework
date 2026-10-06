import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEvidenceRun } from '../../packages/cli/src/commands/evidence/verbs/run.ts';

// A failing validator must tell the agent why it failed: the refusal carries
// the tail of the command's output. Evidence files still keep only hashes.
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-validator-output-'));
try {
  writeFileSync(path.join(cwd, 'check.mjs'), "console.log('checked 2 cases');\nconsole.error('greeting is wrong: expected hello');\nprocess.exit(3);\n");
  let refusal: any = null;
  try {
    runEvidenceRun(['--cwd', cwd, '--task', 'TASK-OUT-0001', '--actor', 'validator', '--command', 'node check.mjs', '--validators', 'node check.mjs', '--json']);
  } catch (error) {
    refusal = error;
  }
  assert.equal(refusal?.code, 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND');
  assert.match(refusal.message, /Validator command failed.*node check\.mjs/);
  const failed = refusal.details.failedCommands[0];
  assert.match(failed.outputTail.stderr, /greeting is wrong: expected hello/);
  assert.match(failed.outputTail.stdout, /checked 2 cases/);

  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full); else files.push(full);
  });
  walk(path.join(cwd, '.atm'));
  assert.ok(files.every((file) => !readFileSync(file, 'utf8').includes('greeting is wrong')), 'raw output is never persisted');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: a failing validator shows its output tail without persisting it');
