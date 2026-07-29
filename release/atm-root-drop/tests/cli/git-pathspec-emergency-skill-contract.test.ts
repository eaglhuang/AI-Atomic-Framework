import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const templatePath = path.join(root, 'templates/skills/atm-git-pathspec-emergency-commit.skill.md');
const installedPath = path.join(root, '.agents/skills/atm-git-pathspec-emergency-commit/SKILL.md');

assert.equal(existsSync(templatePath), true, 'skill template must exist');
assert.equal(existsSync(installedPath), true, 'installed skill copy must exist');

const template = readFileSync(templatePath, 'utf8');
const installed = readFileSync(installedPath, 'utf8');

assert.match(template, /^schemaId:\s*atm\.skillTemplate$/m, 'template must declare atm.skillTemplate schema');
assert.match(template, /^id:\s*atm-git-pathspec-emergency-commit$/m, 'template id must match skill id');

assert.match(template, /emergency-only/i, 'template must state emergency-only usage');
assert.match(
  template,
  /excluded from\s+(?:autonomous\s+)?Plan 3\.1 success metrics/i,
  'template must exclude pathspec/native commit from Plan 3.1 success metrics'
);
assert.match(template, /Exact staged-set verification/i, 'template must require exact staged-set verification');
assert.match(template, /git diff --cached --name-only/, 'template must compare staged set via git diff --cached --name-only');
assert.match(template, /GIT_AUTHOR_NAME/, 'template must require GIT_AUTHOR_NAME continuity');
assert.match(template, /GIT_COMMITTER_NAME/, 'template must require GIT_COMMITTER_NAME continuity');
assert.match(template, /Author continuity/i, 'template must name author continuity');

for (const trailer of ['ATM-Actor:', 'ATM-Task:', 'ATM-WIP:', 'ATM-Delivery:', 'ATM-Emergency-Reason:'] as const) {
  assert.ok(template.includes(trailer), `template must require trailer ${trailer}`);
}

for (const forbidden of ['git restore', 'git stash', 'git clean', 'git reset', 'git checkout', 'git add -A'] as const) {
  assert.ok(template.includes(forbidden), `template must forbid ${forbidden}`);
}

assert.match(template, /backlog\/follow-up/i, 'template must require backlog/follow-up recording');
assert.match(
  template,
  /(?:must\s+)?(?:\*\*)?not(?:\*\*)?\s+close the underlying task as normal delivery/i,
  'template must forbid treating emergency commit as normal delivery close'
);

assert.match(installed, /^name:\s*atm-git-pathspec-emergency-commit$/m, 'installed skill must use Claude-format name');
assert.match(installed, /emergency-only/i, 'installed skill must retain emergency-only language');
assert.match(
  installed,
  /excluded from\s+(?:autonomous\s+)?Plan 3\.1 success metrics/i,
  'installed skill must retain Plan 3.1 exclusion'
);
assert.match(installed, /Exact staged-set verification/i, 'installed skill must retain staged-set verification');
assert.ok(installed.includes('ATM-Emergency-Reason:'), 'installed skill must retain emergency trailer');
assert.ok(installed.includes('GIT_AUTHOR_NAME'), 'installed skill must retain author continuity');

// Keep the contract test itself under the physical line budget so pre-close
// admission can scan it without treating the skill card as an oversized edit.
const contractTestPath = path.join(root, 'tests/cli/git-pathspec-emergency-skill-contract.test.ts');
const contractTestLines = readFileSync(contractTestPath, 'utf8').split(/\r?\n/).length;
assert.ok(
  contractTestLines <= 600,
  `contract test must stay within physical line budget (got ${contractTestLines})`
);

console.log('git-pathspec-emergency-skill-contract.test passed');
