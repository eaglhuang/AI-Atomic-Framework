import path from 'node:path';
import { CliError, makeResult, message } from './shared.mjs';

const commandTemplates = Object.freeze({
  createAtom: [
    'node atm.mjs create --bucket <BUCKET> --title <Title> --description "<Description>" --logical-name <logical-name> --dry-run',
    'node atm.mjs create --bucket EXM --title NormalizeCssColor --description "Canonicalize CSS color input for reusable adapters." --logical-name atom.example.normalize-css-color --dry-run',
  ],
  createMap: [
    'node atm.mjs create-map --members <json> --edges <json> --entrypoints <json> --quality-targets <json> --dry-run',
  ],
  bootstrap: [
    'node atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"',
  ],
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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `guide does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.intent !== 'overview') {
      throw new CliError('ATM_CLI_USAGE', 'guide accepts at most one intent argument', { exitCode: 2 });
    }
    state.intent = arg;
  }

  return {
    cwd: path.resolve(state.cwd),
    intent: state.intent,
  };
}

function buildOverviewGuide() {
  return {
    intent: 'overview',
    summary: 'Use guide create-atom when you need to birth an atom and do not have a host-specific task router or task card.',
    supportedIntents: ['create-atom', 'create-map', 'bootstrap'],
    channels: [
      {
        channel: 'host-task-router',
        when: 'A downstream host repo already has a task card or wrapper.',
        action: 'Prefer the host wrapper first so the host-specific scope, evidence, and guardrails stay in sync.',
      },
      {
        channel: 'framework-guide',
        when: 'You are in ATM itself, or the host has no task-card flow for the current job.',
        action: 'Run `node atm.mjs guide create-atom` to get the canonical create-atom path.',
      },
      {
        channel: 'bootstrap',
        when: 'ATM is not initialized yet in the target repository.',
        action: 'Run `node atm.mjs guide bootstrap` before attempting atom birth.',
      },
    ],
  };
}

function buildCreateAtomGuide() {
  return {
    intent: 'create-atom',
    summary: 'Canonical no-task-card discovery path for atom birth.',
    primaryAtom: {
      atomId: 'ATM-CORE-0004',
      logicalName: 'atom.core-atom-generator',
      role: 'The governed provisioning facade for atom birth.',
    },
    readFirst: ['README.md', 'docs/ATOM_GENERATOR.md', 'docs/SELF_HOSTING_ALPHA.md'],
    commandTemplates: commandTemplates.createAtom,
    channels: [
      {
        channel: 'task-driven',
        when: 'A host repo gives you a task card or host-local route command.',
        action: 'Use the host route first, but it should still terminate at `atm create` / `ATM-CORE-0004`.',
      },
      {
        channel: 'ad-hoc-no-task-card',
        when: 'You only know that a new atom is needed, but no task card exists yet.',
        action: 'Start here, fill bucket/title/description/logical-name, and keep `--dry-run` on until the shape is correct.',
      },
      {
        channel: 'legacy-extraction',
        when: 'You are carving a new atom out of legacy code and only know the domain or source path.',
        action: 'Still start from `atm create`; capture legacy refs and lineage in downstream evidence rather than hand-rolling a registry entry.',
      },
    ],
    guardrails: [
      'Do not hand-roll atom IDs.',
      'Do not write registry entries before generator output exists.',
      'Use `--dry-run` first, then rerun without it only after the logicalName and validation plan are stable.',
      'If a host project provides a wrapper, the wrapper should point back to this same generator path instead of replacing it.',
    ],
    antiPatterns: [
      'Creating `ATM-*` directories manually before running the generator.',
      'Treating a legacy source path as permission to skip `ATM-CORE-0004`.',
      'Assuming a task card is the only valid discovery channel.',
    ],
  };
}

function buildCreateMapGuide() {
  return {
    intent: 'create-map',
    summary: 'Canonical discovery path for governed Atomic Map birth.',
    primaryMap: {
      role: 'Map generation facade exposed through `atm create-map`.',
    },
    readFirst: ['README.md', 'docs/ATOM_GENERATOR.md'],
    commandTemplates: commandTemplates.createMap,
    guardrails: [
      'Use canonical `ATM-MAP-*` IDs only through the generator.',
      'Keep members/edges/entrypoints/quality-targets as explicit inputs; do not infer them from partial registry state.',
    ],
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
      'Do not assume the host repo is already ATM-aware.',
    ],
  };
}

function buildGuide(intent) {
  switch (intent) {
    case 'overview':
      return buildOverviewGuide();
    case 'create-atom':
      return buildCreateAtomGuide();
    case 'create-map':
      return buildCreateMapGuide();
    case 'bootstrap':
      return buildBootstrapGuide();
    default:
      throw new CliError('ATM_CLI_USAGE', `Unknown guide intent: ${intent}`, {
        exitCode: 2,
        details: { supportedIntents: ['create-atom', 'create-map', 'bootstrap'] },
      });
  }
}

export function runGuide(argv) {
  const { cwd, intent } = parseGuideArgs(argv);
  const guide = buildGuide(intent);
  return makeResult({
    ok: true,
    command: 'guide',
    cwd,
    messages: [
      message('info', 'ATM_GUIDE_READY', `Guide for ${guide.intent} is ready.`, { intent: guide.intent }),
    ],
    evidence: guide,
  });
}
