import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const task = getArg('--task');
const fixturesFlag = process.argv.includes('--fixtures');
const fixturesDir = getArg('--fixtures');

type TemplateContract = {
  label: string;
  file: string;
  schema: string;
  required: string[];
  requiredText?: string[];
  expectedTask: string;
};

const baseTemplates: TemplateContract[] = [
  {
    label: 'team-brief',
    file: 'docs/governance/team-agents/templates/team-brief-template.md',
    schema: 'schemas/team-agents/team-brief.schema.json',
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
      'Primary atom',
      'Related atoms',
      'Capability touched',
      'Command surface',
      'Large-script risk',
      'Map update needed',
      'Recommended implementation slice',
      'Do-not-cross boundary',
      'Split recommendation',
      'atm.team-agents-template-map'
    ],
    expectedTask: 'TASK-TEAM-0004'
  },
  {
    label: 'agent-report',
    file: 'docs/governance/team-agents/templates/agent-report-template.md',
    schema: 'schemas/team-agents/agent-report.schema.json',
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
    schema: 'schemas/team-agents/team-summary.schema.json',
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
  },
  {
    label: 'captain-decision',
    file: 'docs/governance/team-agents/templates/captain-decision-template.md',
    schema: 'schemas/team-agents/captain-decision.schema.json',
    required: [
      '## Decision',
      '## Options Considered',
      '## Chosen Option',
      '## Reason',
      '## Risk',
      '## Lieutenant Need',
      '## Next Team Shape'
    ],
    requiredText: [
      'Advisory-only',
      'no ATM gate authority',
      'no evidence authority',
      'no task status authority',
      'TASK-TEAM-0005'
    ],
    expectedTask: 'TASK-TEAM-0005'
  },
  {
    label: 'team-memory-shard',
    file: 'docs/governance/team-agents/templates/team-memory-shard-template.md',
    schema: 'schemas/team-agents/team-memory-shard.schema.json',
    required: [
      '## Knowledge Scope',
      '## Retrieval / Path Hints',
      '## Related Atoms',
      '## Related Validators',
      '## Task Type',
      '## Symptom',
      '## Lesson',
      '## Reuse Conditions',
      '## Avoid Conditions',
      '## Freshness / Retention Hints',
      '## Related Commands',
      '## Related Files'
    ],
    requiredText: [
      'Advisory-only',
      'does not replace closure evidence',
      'task ledgers',
      'ATM task status records',
      'TASK-TEAM-0005',
      'AI-Atomic-Framework'
    ],
    expectedTask: 'TASK-TEAM-0005'
  },
  {
    label: 'patrol-report',
    file: 'docs/governance/team-agents/templates/patrol-report-template.md',
    schema: 'schemas/team-agents/patrol-report.schema.json',
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
    requiredText: [
      'Run ID',
      'Team',
      'Severity',
      'Findings',
      'Safe-to-proceed',
      'Suggested command',
      'Follow-up',
      'patrols are read-only unless a separate task card grants write permission',
      'daily',
      'claim-preflight',
      'close-preflight',
      'big-script patrol report'
    ],
    expectedTask: 'TASK-TEAM-0006'
  }
];

if (!fixturesFlag && task !== 'TASK-TEAM-0004' && task !== 'TASK-TEAM-0005' && task !== 'TASK-TEAM-0006' && task !== 'TASK-TEAM-0017') {
  fail(`unsupported or missing --task value: ${task ?? '<none>'}`);
}

validateSchemas();

const selectedTemplates = fixturesFlag || task === 'TASK-TEAM-0017'
  ? baseTemplates
  : baseTemplates.filter((template) => template.expectedTask === task);

for (const template of selectedTemplates) {
  validateTemplate(template);
}

if (fixturesFlag) {
  validateFixtures(fixturesDir);
}

console.log(`[validate-team-agents-templates] ok (${task ?? 'fixtures'})`);

function validateSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const template of baseTemplates) {
    const schema = readJson(template.schema);
    if (ajv.validateSchema(schema) !== true) {
      fail(`${template.label} schema is invalid: ${formatAjvErrors(ajv.errors)}`);
    }
    ajv.compile(schema);
  }
}

function validateTemplate(template: TemplateContract) {
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

function validateFixtures(dirArg: string | undefined) {
  const fixtureRoot = dirArg ? path.resolve(root, dirArg) : path.join(root, 'docs/governance/team-agents/templates');
  if (!existsSync(fixtureRoot)) {
    return;
  }
  if (!statSync(fixtureRoot).isDirectory()) {
    fail(`--fixtures path is not a directory: ${fixtureRoot}`);
  }
  const fixtureFiles = readdirSync(fixtureRoot)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => path.join(fixtureRoot, entry));

  for (const file of fixtureFiles) {
    const contract = inferContractForFixture(file);
    if (!contract) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    for (const heading of contract.required) {
      if (!content.includes(heading)) {
        fail(`${path.relative(root, file)} missing required section: ${heading}`);
      }
    }
    for (const snippet of contract.requiredText ?? []) {
      if (!content.includes(snippet)) {
        fail(`${path.relative(root, file)} missing required text: ${snippet}`);
      }
    }
  }
}

function inferContractForFixture(file: string): TemplateContract | null {
  const name = path.basename(file).replace(/-template\.md$/, '').replace(/\.md$/, '');
  return baseTemplates.find((template) => name.includes(template.label)) ?? null;
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readText(relativePath)) as Record<string, unknown>;
}

function formatAjvErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return '<unknown>';
  return errors.map((error: any) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

function fail(message: string): never {
  console.error(`[validate-team-agents-templates] ${message}`);
  process.exit(1);
}
