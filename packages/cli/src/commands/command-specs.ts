import { defineCommandSpec } from './shared.ts';

const commonJsonOption = { flag: '--json', summary: 'Force machine-readable JSON output.' };
const commonPrettyOption = { flag: '--pretty', summary: 'Force human-readable pretty output.' };
const commonHelpOption = { flag: '--help', alias: '-h', summary: 'Show command help.' };
const commonCwdOption = { flag: '--cwd', value: 'path', summary: 'Run the command against a specific repository root.' };

export const commandSpecs = Object.freeze({
  bootstrap: defineCommandSpec({
    name: 'bootstrap',
    summary: 'Create or refresh the default ATM bootstrap pack.',
    positional: [],
    options: [
      commonCwdOption,
      { flag: '--task', value: 'text', summary: 'Override bootstrap task title (default: "Bootstrap ATM in this repository").' },
      { flag: '--force', summary: 'Overwrite existing bootstrap files.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs bootstrap --cwd .',
      'node atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"'
    ]
  }),
  budget: defineCommandSpec({
    name: 'budget',
    summary: 'Evaluate context budget policy for a governed task.',
    positional: [
      { name: 'action', summary: 'Currently supports: check', required: true }
    ],
    options: [
      commonCwdOption,
      { flag: '--task', value: 'id', summary: 'Work item id to evaluate.' },
      { flag: '--budget-id', value: 'id', summary: 'Custom budget report id.' },
      { flag: '--estimated-tokens', value: 'number', summary: 'Estimated token count for the pending turn.' },
      { flag: '--inline-artifacts', value: 'number', summary: 'Inline artifact count in the pending turn.' },
      { flag: '--requested-summary', value: 'text', summary: 'Requested summary guidance.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs budget check --task BOOTSTRAP-0001 --estimated-tokens 16000 --json'
    ]
  }),
  create: defineCommandSpec({
    name: 'create',
    summary: 'Create and register an atom through the provisioning facade.',
    options: [
      commonCwdOption,
      { flag: '--bucket', value: 'bucket', summary: 'Atom bucket segment (for example: CORE, FIXTURE).' },
      { flag: '--title', value: 'title', summary: 'Human-readable atom title.' },
      { flag: '--description', value: 'text', summary: 'Atom description.' },
      { flag: '--logical-name', value: 'name', summary: 'Optional logical name override.' },
      { flag: '--dry-run', summary: 'Preview generated paths and IDs without writing files.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs create --bucket CORE --title NormalizeCssColor --description "Canonicalize CSS color input." --dry-run'
    ]
  }),
  'create-map': defineCommandSpec({
    name: 'create-map',
    summary: 'Create and register an atomic map through the provisioning facade.',
    options: [
      commonCwdOption,
      { flag: '--map-version', value: 'semver', summary: 'Map version, defaults to 0.1.0.' },
      { flag: '--members', value: 'json', summary: 'JSON member list.' },
      { flag: '--edges', value: 'json', summary: 'JSON dependency edge list.' },
      { flag: '--entrypoints', value: 'json', summary: 'JSON entrypoint list.' },
      { flag: '--quality-targets', value: 'json', summary: 'JSON quality targets object.' },
      { flag: '--dry-run', summary: 'Preview generated paths and IDs without writing files.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs create-map --members "[{\\"atomId\\":\\"ATM-CORE-0001\\",\\"version\\":\\"1.0.0\\"}]" --entrypoints "[\\"ATM-CORE-0001\\"]" --quality-targets "{\\"latency\\":\\"p95<100ms\\"}" --dry-run'
    ]
  }),
  doctor: defineCommandSpec({
    name: 'doctor',
    summary: 'Inspect ATM engineering readiness and trust signals.',
    options: [
      commonCwdOption,
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs doctor --json'
    ]
  }),
  orient: defineCommandSpec({
    name: 'orient',
    summary: 'Inspect a repository and emit an ATM guidance orientation report.',
    options: [
      commonCwdOption,
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs orient --cwd . --json'
    ]
  }),
  start: defineCommandSpec({
    name: 'start',
    summary: 'Start an ATM guidance session for a concrete goal.',
    options: [
      commonCwdOption,
      { flag: '--goal', value: 'text', summary: 'Goal the agent is trying to accomplish.' },
      { flag: '--actor', value: 'name', summary: 'Optional actor label for session audit.' },
      { flag: '--target-file', value: 'path', summary: 'Path (relative to --cwd) to a legacy source file to analyze and build a LegacyRoutePlan from.' },
      { flag: '--release-blocker', value: 'symbols', summary: 'Comma-separated function names that are release blockers (used with --target-file or --legacy-flow).' },
      { flag: '--shadow', summary: 'Mark the session as shadow mode: dry-run only, no host legacy file writes.' },
      { flag: '--legacy-flow', summary: 'Force legacy route flow; build a LegacyRoutePlan from --target-file or the first config hotspot declared in .atm/config.json.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs start --cwd . --goal "Extract legacy helper" --json',
      'node atm.mjs start --cwd . --goal "Atomize leaf helper" --target-file src/utils.ts --release-blocker "processRequest" --legacy-flow --json'
    ]
  }),
  explain: defineCommandSpec({
    name: 'explain',
    summary: 'Explain guidance blocks and the evidence needed to proceed.',
    options: [
      commonCwdOption,
      { flag: '--why', value: 'reason', summary: 'Currently supports: blocked.' },
      { flag: '--session', value: 'id', summary: 'Guidance session id; defaults to the active session.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs explain --why blocked --json',
      'node atm.mjs explain --why blocked --session <session-id> --json'
    ]
  }),
  guard: defineCommandSpec({
    name: 'guard',
    summary: 'Run small governance guards such as encoding checks.',
    positional: [
      { name: 'guard-name', summary: 'Currently supports: encoding', required: true }
    ],
    options: [
      commonCwdOption,
      { flag: '--files', value: 'csv', summary: 'Comma-separated file paths for the guard.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs guard encoding --files README.md,package.json --json'
    ]
  }),
  guide: defineCommandSpec({
    name: 'guide',
    summary: 'Show guided ATM workflows and glossary/help references.',
    positional: [
      { name: 'intent', summary: 'overview | create-atom | create-map | bootstrap | glossary | help', required: false },
      { name: 'command', summary: 'Command name when intent is help.', required: false }
    ],
    options: [
      commonCwdOption,
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs guide overview --json',
      'node atm.mjs guide glossary --json',
      'node atm.mjs guide help next --json'
    ]
  }),
  handoff: defineCommandSpec({
    name: 'handoff',
    summary: 'Write continuation summaries for governed work.',
    positional: [
      { name: 'action', summary: 'Currently supports: summarize', required: true }
    ],
    options: [
      commonCwdOption,
      { flag: '--task', value: 'id', summary: 'Work item id to summarize.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs handoff summarize --task BOOTSTRAP-0001 --json'
    ]
  }),
  init: defineCommandSpec({
    name: 'init',
    summary: 'Adopt ATM in a repository.',
    options: [
      commonCwdOption,
      { flag: '--adopt', value: 'profile', summary: 'Adoption profile (default when flag is present without value: default).' },
      { flag: '--task', value: 'text', summary: 'Bootstrap task title override.' },
      { flag: '--dry-run', summary: 'Preview init/adopt changes without writing files.' },
      { flag: '--force', summary: 'Overwrite existing config and bootstrap files.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs init --adopt default --json'
    ]
  }),
  lock: defineCommandSpec({
    name: 'lock',
    summary: 'Check, acquire, or release a governed scope lock.',
    positional: [
      { name: 'action', summary: 'check | acquire | release', required: true }
    ],
    options: [
      commonCwdOption,
      { flag: '--task', value: 'id', summary: 'Task id for lock operation.' },
      { flag: '--owner', value: 'name', summary: 'Lock owner identity.' },
      { flag: '--files', value: 'csv', summary: 'Comma-separated locked files for acquire.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs lock acquire --task BOOTSTRAP-0001 --owner atm-agent --json'
    ]
  }),
  next: defineCommandSpec({
    name: 'next',
    summary: 'Recommend the next official ATM guidance action from current state.',
    options: [
      commonCwdOption,
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs next --json',
      'node atm.mjs next --cwd <host-repo> --json'
    ]
  }),
  'self-host-alpha': defineCommandSpec({
    name: 'self-host-alpha',
    summary: 'Verify deterministic self-hosting alpha criteria.',
    options: [
      commonCwdOption,
      { flag: '--verify', summary: 'Run the deterministic self-hosting alpha checklist.' },
      { flag: '--agent', value: 'profile', summary: 'Optional advisory confidence profile.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs self-host-alpha --verify --json',
      'node atm.mjs self-host-alpha --verify --agent claude-code --json'
    ]
  }),
  spec: defineCommandSpec({
    name: 'spec',
    summary: 'Validate an atomic spec or supported report against schema contracts.',
    options: [
      commonCwdOption,
      { flag: '--validate', value: 'path', summary: 'Spec file path to validate.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs spec --validate tests/schema-fixtures/positive/hello-world.atom.json --json',
      'node atm.mjs spec --validate tests/schema-fixtures/map-equivalence-report/positive.json --json'
    ]
  }),
  status: defineCommandSpec({
    name: 'status',
    summary: 'Inspect ATM status in framework or adopted repositories.',
    options: [
      commonCwdOption,
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs status --json'
    ]
  }),
  upgrade: defineCommandSpec({
    name: 'upgrade',
    summary: 'Propose upgrade evolution from report evidence inputs.',
    options: [
      commonCwdOption,
      { flag: '--propose', summary: 'Generate an upgrade proposal.' },
      { flag: '--scan', summary: 'Run the evidence-driven draft bridge from detector reports.' },
      { flag: '--dry-run', summary: 'Generate proposal without mutating persisted artifacts.' },
      { flag: '--atom', value: 'id', summary: 'Target atom id.' },
      { flag: '--from', value: 'version', summary: 'Source version.' },
      { flag: '--to', value: 'version', summary: 'Target version.' },
      { flag: '--target', value: 'kind', summary: 'Target kind: atom | map.' },
      { flag: '--map', value: 'id', summary: 'Target map id when target kind is map.' },
      { flag: '--behavior', value: 'id', summary: 'Behavior id to route proposal generation.' },
      { flag: '--decomposition-decision', value: 'decision', summary: 'Explicit decomposition decision override.' },
      { flag: '--fork-source', value: 'id', summary: 'Fork source atom id.' },
      { flag: '--new-atom-id', value: 'id', summary: 'Fork destination atom id.' },
      { flag: '--input', value: 'path', summary: 'Input report path (repeatable).' },
      { flag: '--proposal-id', value: 'id', summary: 'Override proposal id.' },
      { flag: '--proposed-by', value: 'name', summary: 'Proposal author label.' },
      { flag: '--proposed-at', value: 'timestamp', summary: 'Proposal timestamp override.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs upgrade --propose --atom ATM-CORE-0001 --to 1.1.0 --input fixtures/upgrade/hash-diff-report.json --json',
      'node atm.mjs upgrade --scan --input fixtures/evolution/evidence-patterns/recurring-failure-candidate.json --json'
    ]
  }),
  test: defineCommandSpec({
    name: 'test',
    summary: 'Run atom smoke, spec, map, or propagation tests.',
    options: [
      commonCwdOption,
      { flag: '--atom', value: 'name', summary: 'Run canned atom smoke (currently: hello-world).' },
      { flag: '--spec', value: 'path', summary: 'Run spec-based test runner flow.' },
      { flag: '--map', value: 'id', summary: 'Run map integration test for a map id.' },
      { flag: '--propagate', value: 'id', summary: 'Run downstream propagation checks for an atom id.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs test --atom hello-world --json',
      'node atm.mjs test --map ATM-MAP-0001 --json'
    ]
  }),
  validate: defineCommandSpec({
    name: 'validate',
    summary: 'Run repository or atomic spec validation checks.',
    options: [
      commonCwdOption,
      { flag: '--spec', value: 'path', summary: 'Validate a specific atomic spec path.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs validate --json',
      'node atm.mjs validate --spec tests/schema-fixtures/positive/hello-world.atom.json --json'
    ]
  }),
  verify: defineCommandSpec({
    name: 'verify',
    summary: 'Run verification checks for self hashes, neutrality, or AGENTS.md.',
    options: [
      commonCwdOption,
      { flag: '--self', summary: 'Verify seed self-verification hashes.' },
      { flag: '--neutrality', summary: 'Verify protected-surface neutrality.' },
      { flag: '--agents-md', summary: 'Verify AGENTS bootstrap guidance contracts.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs verify --self --json',
      'node atm.mjs verify --neutrality --json',
      'node atm.mjs verify --agents-md --json'
    ]
  }),
  'registry-diff': defineCommandSpec({
    name: 'registry-diff',
    summary: 'Generate version hash diff report for a registry atom.',
    positional: [
      { name: 'atom-id', summary: 'Atom id to compare.', required: true }
    ],
    options: [
      { flag: '--from', value: 'version', summary: 'Source version.' },
      { flag: '--to', value: 'version', summary: 'Target version.' },
      { flag: '--registry', value: 'path', summary: 'Optional registry document path.' },
      { flag: '--reason', value: 'text', summary: 'Optional drift reason annotation.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs registry-diff ATM-CORE-0001 --from 1.0.0 --to 1.1.0 --json'
    ]
  }),
  rollback: defineCommandSpec({
    name: 'rollback',
    summary: 'Plan or apply rollback for atom/map registry targets.',
    options: [
      commonCwdOption,
      { flag: '--plan', summary: 'Prepare rollback proof preview without applying.' },
      { flag: '--apply', summary: 'Apply rollback and persist proof artifacts.' },
      { flag: '--target', value: 'kind', summary: 'Target kind: atom | map.' },
      { flag: '--atom', value: 'id', summary: 'Target atom id.' },
      { flag: '--map', value: 'id', summary: 'Target map id.' },
      { flag: '--map-owner', value: 'id', summary: 'Map owner atom id override.' },
      { flag: '--to', value: 'version', summary: 'Rollback destination version.' },
      { flag: '--behavior', value: 'id', summary: 'Behavior id for rollback evidence.' },
      { flag: '--registry', value: 'path', summary: 'Registry file path.' },
      { flag: '--proof', value: 'path', summary: 'Success proof output path.' },
      { flag: '--failure-proof', value: 'path', summary: 'Failure proof output path.' },
      { flag: '--by', value: 'name', summary: 'Decision author label.' },
      { flag: '--at', value: 'timestamp', summary: 'Verification timestamp.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs rollback --plan --atom ATM-CORE-0001 --to 1.0.0 --json',
      'node atm.mjs rollback --apply --atom ATM-CORE-0001 --to 1.0.0 --json'
    ]
  }),
  review: defineCommandSpec({
    name: 'review',
    summary: 'List, inspect, approve, or reject upgrade proposals.',
    positional: [
      { name: 'action', summary: 'list | show | approve | reject', required: false },
      { name: 'proposal-id', summary: 'Proposal id for show/approve/reject.', required: false }
    ],
    options: [
      commonCwdOption,
      { flag: '--queue', value: 'path', summary: 'Human review queue JSON path.' },
      { flag: '--projection', value: 'path', summary: 'Rendered markdown projection path.' },
      { flag: '--decision-log', value: 'path', summary: 'Decision log JSON path.' },
      { flag: '--reason', value: 'text', summary: 'Decision reason for approve/reject.' },
      { flag: '--by', value: 'name', summary: 'Decision actor label.' },
      { flag: '--at', value: 'timestamp', summary: 'Decision timestamp override.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs review list --json',
      'node atm.mjs review approve <proposal-id> --reason "approved" --json'
    ]
  }),
  'review-advisory': defineCommandSpec({
    name: 'review-advisory',
    summary: 'Generate non-blocking semantic advisory findings.',
    options: [
      commonCwdOption,
      { flag: '--mode', value: 'mode', summary: 'stub | agent-bridge | external-cli' },
      { flag: '--stub-profile', value: 'profile', summary: 'pass | warn | unavailable' },
      { flag: '--out', value: 'path', summary: 'Advisory report output path.' },
      { flag: '--report-id', value: 'id', summary: 'Advisory report id override.' },
      { flag: '--target-kind', value: 'kind', summary: 'atom | map | proposal | diff | scope' },
      { flag: '--target-id', value: 'id', summary: 'Target identifier for advisory context.' },
      { flag: '--source-path', value: 'path', summary: 'Source path to annotate (repeatable).' },
      { flag: '--provider-response', value: 'path', summary: 'JSON provider response for agent-bridge mode.' },
      { flag: '--provider-cmd', value: 'command', summary: 'External provider command for external-cli mode.' },
      { flag: '--machine-findings', value: 'path', summary: 'Optional machine findings JSON file.' },
      { flag: '--queue', value: 'path', summary: 'Optional queue path for supplemental context.' },
      { flag: '--proposal-id', value: 'id', summary: 'Optional proposal id for supplemental context.' },
      commonJsonOption,
      commonPrettyOption,
      commonHelpOption
    ],
    examples: [
      'node atm.mjs review-advisory --mode stub --stub-profile pass --json'
    ]
  })
});

export function getCommandSpec(commandName: string) {
  return commandName in commandSpecs
    ? commandSpecs[commandName as keyof typeof commandSpecs]
    : null;
}

export function listCommandSpecs() {
  return Object.values(commandSpecs);
}
