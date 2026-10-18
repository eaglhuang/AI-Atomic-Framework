import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A single-repository adopter opens its own task cards in docs/tasks through
// `taskflow open` with ATM's built-in opener; no planning repository or opener
// script is needed. An existing profile is never replaced.
export function ensureAdopterTaskflowProfile(cwd: string) {
  if (isFrameworkRepository(cwd)) return { status: 'framework-repository' as const };
  const profilePath = path.join(cwd, 'taskflow.profile.json');
  if (existsSync(profilePath)) return { status: 'existing' as const, path: 'taskflow.profile.json' };
  const repoName = path.basename(path.resolve(cwd));
  const prefix = `TASK-${taskFamily(repoName)}`;
  const format = `${prefix}-NNNN`;
  const profile = {
    schemaId: 'taskflow.profile.v1',
    id: `${repoName}-local-tasks`,
    name: `${repoName} task cards`,
    repoLabel: repoName,
    ownerRepo: repoName,
    taskIdPrefix: prefix,
    taskId: { format },
    template: { defaultMarkdown: '# ${taskId} ${title}' },
    capabilities: { supportsDryRun: true, supportsWrite: false },
    delegation: {
      hint: 'Task cards live in docs/tasks of this repository and are opened by ATM\'s built-in opener.',
      openerPath: 'atm:builtin',
      policy: {
        allocateTaskId: { mode: 'host-opener', prefix, format },
        resolveCanonicalOutputPath: { mode: 'host-opener', pattern: 'docs/tasks/${taskId}.task.md', directory: 'docs/tasks' },
        rosterSyncPolicy: 'none',
        fallbackBehavior: { mode: 'governed-fallback', reason: 'Single-repository adopter; task cards are opened in place.' }
      }
    }
  };
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return { status: 'created' as const, path: 'taskflow.profile.json', taskIdFormat: format };
}

function taskFamily(repoName: string) {
  const family = repoName.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8);
  return /^[A-Z]/.test(family) ? family : 'APP';
}

function isFrameworkRepository(cwd: string) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).name === 'ai-atomic-framework';
  } catch {
    return false;
  }
}
