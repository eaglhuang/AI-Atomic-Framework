import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const startMarker = '# ATM runtime state (managed by ATM bootstrap):start';
const endMarker = '# ATM runtime state (managed by ATM bootstrap):end';

// Same per-machine runtime and session outputs the ATM framework repository
// ignores. Without them an adopter's first `git status` lists locks,
// telemetry and session files as untracked work.
export const adopterRuntimeIgnorePatterns = [
  '.atm/runtime/telemetry/',
  '.atm/runtime/guidance/',
  '.atm/runtime/locks/',
  '.atm/runtime/emergency/',
  '.atm/runtime/current-task.json',
  '.atm/runtime/batch-run.json',
  '.atm/runtime/batch-runs/',
  '.atm/runtime/identity/',
  '.atm/runtime/sessions/',
  '.atm/runtime/task-intent.json',
  '.atm/runtime/task-queues/',
  '.atm/runtime/quickfix-lock.json',
  '.atm/runtime/validator-cache/',
  '.atm/runtime/validator-runs/',
  '.atm/runtime/validation-receipts/',
  '.atm/runtime/evidence-ledger/',
  '.atm/runtime/incidents/',
  '.atm/runtime/write-broker.registry.json',
  '.atm/runtime/git-commit-attempts/',
  '.atm/history/guidance/',
  '.atm/history/reports/',
  '.atm-temp/'
] as const;

export function ensureAdopterGitignore(cwd: string) {
  if (isFrameworkRepository(cwd)) return { status: 'framework-repository' as const };
  const gitignorePath = path.join(cwd, '.gitignore');
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (current.includes(startMarker)) return { status: 'existing' as const, path: '.gitignore' };
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const block = [startMarker, ...adopterRuntimeIgnorePatterns, endMarker].join(eol);
  const separator = current.length === 0 ? '' : current.endsWith('\n') ? eol : eol + eol;
  writeFileSync(gitignorePath, `${current}${separator}${block}${eol}`, 'utf8');
  return { status: current.length === 0 ? 'created' as const : 'appended' as const, path: '.gitignore' };
}

function isFrameworkRepository(cwd: string) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).name === 'ai-atomic-framework';
  } catch {
    return false;
  }
}
