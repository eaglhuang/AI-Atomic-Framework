import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const content = readText('docs/governance/team-agents/task-0009-preflight-contract.md');
const requiredSections = [
  '# TASK-TEAM-0009 Preflight Contract',
  '## Task',
  '## Dependency Map',
  '## Acceptance Checklist',
  '## Mailbox Materialization Note',
  '## Corrective Dispatch Rules',
  '## Captain Handoff',
  '## Worker Report'
];

for (const heading of requiredSections) {
  if (!content.includes(heading)) {
    fail(`missing required section: ${heading}`);
  }
}

for (const token of ['TASK-TEAM-0009', 'TASK-TEAM-0007', 'TASK-TEAM-0008', 'captain-corrective-thread-dispatch-used: yes']) {
  if (!content.includes(token)) {
    fail(`missing required token: ${token}`);
  }
}

if (!content.includes('agents/<id>/inbox/*.dispatch.md')) {
  fail('mailbox materialization rule missing inbox path rule');
}

console.log('[validate-team-plan-preflight] ok (TASK-TEAM-0009)');

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message: string): never {
  console.error(`[validate-team-plan-preflight] ${message}`);
  process.exit(1);
}
