import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const task = getArg('--task');

if (task !== 'TASK-TEAM-0004' && task !== 'TASK-TEAM-0005' && task !== 'TASK-TEAM-0006') {
  fail(`unsupported or missing --task value: ${task ?? '<none>'}`);
}

type TemplateContract = {
  label: string;
  file: string;
  required: string[];
  requiredText?: string[];
  expectedTask: string;
};

const templates: TemplateContract[] = [
  {
    label: 'team-brief',
    file: 'docs/governance/team-agents/templates/team-brief-template.md',
    required: [
      '## Task',
      '## Captain',
      '## Team',
      '## Scope',
      '## Atomization Plan',
      '## Assignment',
      '## Validation Plan',
      '## Evidence Plan',
      '## Expected Report',
      '## Stop Conditions'
    ],
    requiredText: [
      'Allowed files',
      'Do-not-touch paths',
      'Forbidden repositories',
      'Assigned Work',
      'Expected Report',
      'Stop Conditions',
      'atm.team-agents-template-map'
    ],
    expectedTask: 'TASK-TEAM-0004'
  },
  {
    label: 'agent-report',
    file: 'docs/governance/team-agents/templates/agent-report-template.md',
    required: [
      '## Role',
      '## Status',
      '## Files Read',
      '## Files Changed',
      '## Commands Run',
      '## Findings',
      '## Blockers',
      '## Recommendation',
      '## Handoff'
    ],
    requiredText: [
      'Parent task',
      'Assigned work',
      'Scope drift',
      'Read-only roles should report `none`',
      '<close | continue | escalate>'
    ],
    expectedTask: 'TASK-TEAM-0004'
  },
  {
    label: 'team-summary',
    file: 'docs/governance/team-agents/templates/team-summary-template.md',
    required: ['## Decision', '## Implementation Summary', '## Validators', '## Evidence', '## Risk', '## Close-Ready'],
    requiredText: [
      'Decision time',
      'Scope drift',
      'Close command',
      'Close result',
      'Commit SHA',
      'validators pass',
      'close command succeeds'
    ],
    expectedTask: 'TASK-TEAM-0004'
  }
];

if (task === 'TASK-TEAM-0005') {
  templates.push(
    {
      label: 'captain-decision',
      file: 'docs/governance/team-agents/templates/captain-decision-template.md',
      required: [
        '## Task',
        '## Context',
        '## Decision',
        '## Preconditions',
        '## Allowed Files',
        '## Forbidden Scope',
        '## Acceptance',
        '## Exit Criteria',
        '## Handoff'
      ],
      expectedTask: 'TASK-TEAM-0005'
    },
    {
      label: 'team-memory-shard',
      file: 'docs/governance/team-agents/templates/team-memory-shard-template.md',
      required: [
        '## Task',
        '## Identity',
        '## Memory Payload',
        '## Allowed Files',
        '## Forbidden Scope',
        '## Validation',
        '## Retention'
      ],
      expectedTask: 'TASK-TEAM-0005'
    }
  );
}

if (task === 'TASK-TEAM-0006') {
  templates.push({
    label: 'patrol-report',
    file: 'docs/governance/team-agents/templates/patrol-report-template.md',
    required: [
      '## Task',
      '## Captain',
      '## Patrol Scope',
      '## Patrol Plan',
      '## Validation Plan',
      '## Evidence Plan',
      '## Stop Conditions',
      '## Worker Report'
    ],
    expectedTask: 'TASK-TEAM-0006'
  });
}

for (const template of templates) {
  const content = readText(template.file);
  for (const heading of template.required) {
    if (!content.includes(heading)) {
      fail(`${template.label} missing required section: ${heading}`);
    }
  }
  for (const snippet of template.requiredText ?? []) {
    if (!content.includes(snippet)) {
      fail(`${template.label} missing required text: ${snippet}`);
    }
  }
  if (!content.includes(template.expectedTask)) {
    fail(`${template.label} must explicitly reference ${template.expectedTask}`);
  }
}

console.log(`[validate-team-agents-templates] ok (${task})`);

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message: string): never {
  console.error(`[validate-team-agents-templates] ${message}`);
  process.exit(1);
}
