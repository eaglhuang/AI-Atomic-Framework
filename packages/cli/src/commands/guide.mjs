import path from 'node:path';
import { getCommandSpec, listCommandSpecs } from './command-specs.mjs';
import { glossaryEntries } from './glossary-data.mjs';
import { CliError, makeResult, message } from './shared.mjs';

const supportedGuideIntents = ['overview', 'create-atom', 'create-map', 'bootstrap', 'glossary', 'help'];

const commandTemplates = Object.freeze({
  createAtom: [
    'node atm.mjs create --bucket <BUCKET> --title <Title> --description "<Description>" --logical-name <logical-name> --dry-run',
    'node atm.mjs create --bucket EXM --title NormalizeCssColor --description "Canonicalize CSS color input for reusable adapters." --logical-name atom.example.normalize-css-color --dry-run'
  ],
  createMap: [
    'node atm.mjs create-map --members <json> --edges <json> --entrypoints <json> --quality-targets <json> --dry-run'
  ],
  bootstrap: [
    'node atm.mjs bootstrap --cwd <host-repo>',
    'node atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"'
  ]
});

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `guide requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function parseGuideArgs(argv = []) {
  const state = {
    cwd: process.cwd(),
    intent: 'overview',
    topic: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `guide does not support option ${arg}`, { exitCode: 2 });
    }

    if (state.intent === 'overview') {
      state.intent = arg;
      continue;
    }
    if (state.intent === 'help' && !state.topic) {
      state.topic = arg;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', 'guide received too many positional arguments', { exitCode: 2 });
  }

  if (!supportedGuideIntents.includes(state.intent)) {
    throw new CliError('ATM_CLI_USAGE', `Unknown guide intent: ${state.intent}`, {
      exitCode: 2,
      details: { supportedIntents: supportedGuideIntents }
    });
  }

  if (state.intent === 'help' && !state.topic) {
    throw new CliError('ATM_CLI_USAGE', 'guide help requires <command>', {
      exitCode: 2,
      details: {
        supportedCommands: listCommandSpecs().map((spec) => spec.name)
      }
    });
  }

  return {
    cwd: path.resolve(state.cwd),
    intent: state.intent,
    topic: state.topic
  };
}

function buildOverviewGuide() {
  return {
    intent: 'overview',
    summary: 'Use guide create-atom when you need to birth an atom and do not have a host-specific task router or task card.',
    supportedIntents: supportedGuideIntents,
    channels: [
      {
        channel: 'host-task-router',
        when: 'A downstream host repo already has a task card or wrapper.',
        action: 'Prefer the host wrapper first so host scope, evidence, and guardrails stay in sync.'
      },
      {
        channel: 'framework-guide',
        when: 'You are in ATM itself, or the host has no task-card flow for the current job.',
        action: 'Run `node atm.mjs guide create-atom` to get the canonical create-atom path.'
      },
      {
        channel: 'bootstrap',
        when: 'ATM is not initialized yet in the target repository.',
        action: 'Run `node atm.mjs guide bootstrap` before attempting atom birth.'
      }
    ]
  };
}

function buildCreateAtomGuide() {
  return {
    intent: 'create-atom',
    summary: 'Canonical no-task-card discovery path for atom birth.',
    primaryAtom: {
      atomId: 'ATM-CORE-0004',
      logicalName: 'atom.core-atom-generator',
      role: 'The governed provisioning facade for atom birth.'
    },
    readFirst: ['README.md', 'docs/ATOM_GENERATOR.md', 'docs/SELF_HOSTING_ALPHA.md'],
    commandTemplates: commandTemplates.createAtom,
    channels: [
      {
        channel: 'task-driven',
        when: 'A host repo gives you a task card or host-local route command.',
        action: 'Use the host route first, but it should still terminate at `atm create` / `ATM-CORE-0004`.'
      },
      {
        channel: 'ad-hoc-no-task-card',
        when: 'You know a new atom is needed, but no task card exists yet.',
        action: 'Start here, fill bucket/title/description/logical-name, and keep `--dry-run` on until shape is correct.'
      },
      {
        channel: 'legacy-extraction',
        when: 'You are carving a new atom out of legacy code and only know the domain or source path.',
        action: 'Still start from `atm create`; capture legacy refs and lineage in downstream evidence.'
      }
    ],
    guardrails: [
      'Do not hand-roll atom IDs.',
      'Do not write registry entries before generator output exists.',
      'Use `--dry-run` first, then rerun without it only after logicalName and validation plan are stable.'
    ]
  };
}

function buildCreateMapGuide() {
  return {
    intent: 'create-map',
    summary: 'Canonical discovery path for governed Atomic Map birth.',
    primaryMap: {
      role: 'Map generation facade exposed through `atm create-map`.'
    },
    readFirst: ['README.md', 'docs/ATOM_GENERATOR.md'],
    commandTemplates: commandTemplates.createMap,
    guardrails: [
      'Use canonical `ATM-MAP-*` IDs only through the generator.',
      'Keep members/edges/entrypoints/quality-targets as explicit inputs.'
    ]
  };
}

function buildBootstrapGuide() {
  return {
    intent: 'bootstrap',
    summary: 'Initialize ATM in a repository before asking an agent to birth atoms or maps.',
    readFirst: ['README.md', 'docs/SELF_HOSTING_ALPHA.md'],
    commandTemplates: commandTemplates.bootstrap,
    guardrails: [
      'Bootstrap first when `.atm/config.json` does not exist.',
      'Do not assume the host repo is already ATM-aware.'
    ]
  };
}

function buildGlossaryGuide() {
  return {
    intent: 'glossary',
    summary: 'Core ATM terms and short definitions.',
    terms: glossaryEntries
  };
}

function buildCommandHelpGuide(commandName) {
  const spec = getCommandSpec(commandName);
  if (!spec) {
    throw new CliError('ATM_CLI_USAGE', `Unknown guide help command: ${commandName}`, {
      exitCode: 2,
      details: {
        supportedCommands: listCommandSpecs().map((entry) => entry.name)
      }
    });
  }
  return {
    intent: 'help',
    command: spec.name,
    usage: {
      command: spec.name,
      summary: spec.summary,
      positional: spec.positional ?? [],
      options: spec.options ?? [],
      examples: spec.examples ?? []
    }
  };
}

function buildGuide(intent, topic) {
  switch (intent) {
    case 'overview':
      return buildOverviewGuide();
    case 'create-atom':
      return buildCreateAtomGuide();
    case 'create-map':
      return buildCreateMapGuide();
    case 'bootstrap':
      return buildBootstrapGuide();
    case 'glossary':
      return buildGlossaryGuide();
    case 'help':
      return buildCommandHelpGuide(topic);
    default:
      throw new CliError('ATM_CLI_USAGE', `Unknown guide intent: ${intent}`, {
        exitCode: 2,
        details: { supportedIntents: supportedGuideIntents }
      });
  }
}

export function runGuide(argv) {
  const { cwd, intent, topic } = parseGuideArgs(argv);
  const guide = buildGuide(intent, topic);
  return makeResult({
    ok: true,
    command: 'guide',
    cwd,
    messages: [message('info', 'ATM_GUIDE_READY', `Guide for ${guide.intent} is ready.`, { intent: guide.intent })],
    evidence: guide
  });
}

