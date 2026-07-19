import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'plan',
  summary: 'Manage registered planning families and create plan documents or task cards through the tool-first lane.',
  positional: [
    { name: 'area', summary: 'series | doc | card', required: true },
    { name: 'action', summary: 'register | create', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--planning-root', value: 'path', summary: 'Planning base directory. Defaults to ATM_PLANNING_ROOT, ATM_PLANNING_REPO_ROOT, or configured planning roots.' },
    { flag: '--series', value: 'key', summary: 'Short series key such as ERR, TMP, RFT, or GOV.' },
    { flag: '--prefix', value: 'task-prefix', summary: 'Task id prefix. Bare ERR becomes TASK-ERR; ATM-GOV is preserved.' },
    { flag: '--family-dir', value: 'dir', summary: 'Family directory under the planning root.' },
    { flag: '--plan', value: 'path', summary: 'Plan document path relative to the planning root.' },
    { flag: '--title', value: 'text', summary: 'Title for a new plan document or task card.' },
    { flag: '--doc-name', value: 'file.md', summary: 'File name for plan doc create. Defaults to a title slug.' },
    { flag: '--task-id', value: 'id', summary: 'Explicit task id for card create. Defaults to the next id in the registered family tasks directory.' },
    { flag: '--output', value: 'path', summary: 'Explicit task-card output path relative to the planning root.' },
    { flag: '--owner-approved', summary: 'Required for series register writes; records project-owner approval.' },
    { flag: '--approved-by', value: 'id', summary: 'Approval identity recorded in the series registry. Defaults to owner.' },
    { flag: '--status', value: 'active|reserved|archived', summary: 'Series registry status. Defaults to active.' },
    { flag: '--target-repo', value: 'repo', summary: 'Target repo recorded in generated task cards.' },
    { flag: '--closure-authority', value: 'mode', summary: 'Closure authority recorded in generated task cards.' },
    { flag: '--dry-run', summary: 'Preview the registry, plan, or card change without writing.' },
    { flag: '--write', summary: 'Write the registry, plan, or card artifact.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs plan doc create --planning-root C:/repo/docs/ai_atomic_framework --family-dir error-governance --title "ATM Error Governance" --doc-name error-governance-plan.md --write --json',
    'node atm.mjs plan series register --planning-root C:/repo/docs/ai_atomic_framework --series ERR --prefix TASK-ERR --family-dir error-governance --plan error-governance/error-governance-plan.md --owner-approved --write --json',
    'node atm.mjs plan card create --planning-root C:/repo/docs/ai_atomic_framework --series ERR --title "Error registry migration plan" --write --json'
  ],
  help: {
    audience: 'agent',
    requiredFlagSets: [
      { when: 'Registering a new family', flags: ['series register', '--prefix', '--family-dir', '--plan', '--owner-approved', '--write'] },
      { when: 'Creating a plan document before registration', flags: ['doc create', '--family-dir', '--title', '--write'] },
      { when: 'Creating a task card', flags: ['card create', '--series', '--title', '--write'] }
    ],
    relatedCommands: [
      'node atm.mjs tasks import --from <generated-card.task.md> --dry-run --json',
      'node atm.mjs integration add codex --json'
    ],
    commonMistakes: [
      'Writing a new docs/ai_atomic_framework/<family>/tasks/*.task.md file by hand instead of using plan card create.',
      'Registering a prefix before the owner-approved plan document exists.',
      'Inferring the next task id from target .atm/history instead of the planning family tasks directory.'
    ],
    playbookNotes: [
      'Skills should call this CLI for planning family and card creation, then report structured CLI errors instead of bypassing the tool.',
      'ErrorCode registry files remain under docs/governance until a governed ERR-family migration updates registry readers, generators, tests, and emitters together.'
    ]
  }
});
