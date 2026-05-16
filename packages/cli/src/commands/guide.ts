import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyGuidanceIntent,
  loadHostIntentLexicon,
  probeProject,
  recordGuidanceIntentPhrase,
  type GuidanceIntent,
  type GuidanceIntentStatus
} from '../../../core/src/guidance/index.ts';
import { getCommandSpec, listCommandSpecs } from './command-specs.ts';
import { glossaryEntries } from './glossary-data.ts';
import { CliError, makeResult, message } from './shared.ts';

const supportedGuideIntents = ['overview', 'create-atom', 'create-map', 'bootstrap', 'glossary', 'help', 'learn', 'install-skill'];
const supportedLearnIntents: readonly GuidanceIntent[] = ['legacy-atomization'];
const supportedLearnStatuses: readonly GuidanceIntentStatus[] = ['suggested', 'active-host', 'promoted-framework'];
const supportedSkillInstallTargets = ['host', 'codex'] as const;
const legacySkillName = 'atm-legacy-atomization-guidance';

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

function requireOptionValue(argv: any, optionIndex: any, optionName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `guide requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function parseGuideArgs(argv: string[] = []) {
  const state = {
    cwd: process.cwd(),
    intent: 'overview' as string,
    topic: null as string | null,
    goal: null as string | null,
    phrase: null as string | null,
    learnedIntent: null as GuidanceIntent | null,
    reason: null as string | null,
    status: 'suggested' as GuidanceIntentStatus,
    target: 'host' as 'host' | 'codex',
    skillsRoot: null as string | null,
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--goal') {
      state.goal = requireOptionValue(argv, index, '--goal');
      index += 1;
      continue;
    }
    if (arg === '--phrase') {
      state.phrase = requireOptionValue(argv, index, '--phrase');
      index += 1;
      continue;
    }
    if (arg === '--intent') {
      const learnedIntent = requireOptionValue(argv, index, '--intent') as GuidanceIntent;
      if (!supportedLearnIntents.includes(learnedIntent)) {
        throw new CliError('ATM_CLI_USAGE', `guide learn does not support intent ${learnedIntent}`, {
          exitCode: 2,
          details: { supportedIntents: supportedLearnIntents }
        });
      }
      state.learnedIntent = learnedIntent;
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      state.reason = requireOptionValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--status') {
      const status = requireOptionValue(argv, index, '--status') as GuidanceIntentStatus;
      if (!supportedLearnStatuses.includes(status)) {
        throw new CliError('ATM_CLI_USAGE', `guide learn does not support status ${status}`, {
          exitCode: 2,
          details: { supportedStatuses: supportedLearnStatuses }
        });
      }
      state.status = status;
      index += 1;
      continue;
    }
    if (arg === '--target') {
      const target = requireOptionValue(argv, index, '--target') as 'host' | 'codex';
      if (!supportedSkillInstallTargets.includes(target)) {
        throw new CliError('ATM_CLI_USAGE', `guide install-skill does not support target ${target}`, {
          exitCode: 2,
          details: { supportedTargets: supportedSkillInstallTargets }
        });
      }
      state.target = target;
      index += 1;
      continue;
    }
    if (arg === '--skills-root') {
      state.skillsRoot = requireOptionValue(argv, index, '--skills-root');
      index += 1;
      continue;
    }
    if (arg === '--force') {
      state.force = true;
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

  if (state.goal && state.intent !== 'overview') {
    throw new CliError('ATM_CLI_USAGE', 'guide --goal cannot be combined with a positional guide intent', { exitCode: 2 });
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

  if (state.intent === 'learn') {
    if (!state.phrase || !state.learnedIntent || !state.reason) {
      throw new CliError('ATM_CLI_USAGE', 'guide learn requires --phrase, --intent, and --reason', {
        exitCode: 2,
        details: { supportedIntents: supportedLearnIntents, supportedStatuses: supportedLearnStatuses }
      });
    }
  }

  return {
    cwd: path.resolve(state.cwd),
    intent: state.goal ? 'goal' : state.intent,
    topic: state.topic,
    goal: state.goal,
    phrase: state.phrase,
    learnedIntent: state.learnedIntent,
    reason: state.reason,
    status: state.status,
    target: state.target,
    skillsRoot: state.skillsRoot,
    force: state.force
  };
}

function buildOverviewGuide() {
  return {
    intent: 'overview',
    summary: 'Start with guidance: orient the repository, start a goal-bound session, then follow the single next action.',
    supportedIntents: supportedGuideIntents,
    channels: [
      {
        channel: 'free-text-intent',
        when: 'An agent receives a natural-language goal that may involve legacy atomization, infection, transformation, or split.',
        action: 'Run `node atm.mjs guide --goal "<goal>" --cwd . --json` before searching host docs or choosing a behavior manually.'
      },
      {
        channel: 'guidance-first',
        when: 'An agent is entering an unfamiliar repository or goal.',
        action: 'Run `node atm.mjs orient --cwd . --json`, then `node atm.mjs start --cwd . --goal "<goal>" --json`.'
      },
      {
        channel: 'single-next-action',
        when: 'A guidance session exists.',
        action: 'Run `node atm.mjs next --cwd . --json` and execute exactly the returned command.'
      },
      {
        channel: 'blocked-path',
        when: 'A mutation or apply step is blocked by missing gates or evidence.',
        action: 'Run `node atm.mjs explain --why blocked --cwd . --json` and satisfy the listed evidence before retrying.'
      }
    ]
  };
}

function buildGoalGuide(cwd: string, goal: string) {
  const orientation = probeProject(cwd);
  const hostLexicon = loadHostIntentLexicon(cwd);
  const classification = classifyGuidanceIntent(goal, {
    repositoryRoot: cwd,
    adapterStatus: orientation.adapterStatus.status
  });
  const legacyIntent = classification.matchedIntent === 'legacy-atomization'
    || classification.matchedIntent === 'adapter-bootstrap';
  const routeIntent = legacyIntent && orientation.adapterStatus.status === 'missing'
    ? 'adapter-bootstrap'
    : classification.matchedIntent;
  const hasConfigHotspot = orientation.configLegacyHotspots.length > 0;
  const legacyStartCommand = hasConfigHotspot
    ? `node atm.mjs start --cwd . --goal ${quoteCliValue(goal)} --legacy-flow --json`
    : `node atm.mjs start --cwd . --goal ${quoteCliValue(goal)} --target-file <legacy-file> --release-blocker <trunk-symbols> --legacy-flow --json`;
  const nextCommand = routeIntent === 'legacy-atomization'
    ? legacyStartCommand
    : classification.nextCommand.replace('"<goal>"', quoteCliValue(goal));

  return {
    intent: 'goal',
    summary: 'Free-text ATM intent guidance is ready.',
    goal,
    matchedIntent: classification.matchedIntent,
    routeIntent,
    confidence: classification.confidence,
    matchedTerms: classification.matchedTerms,
    requiredFlow: classification.requiredFlow,
    prerequisiteCommands: routeIntent === 'legacy-atomization'
      ? ['node atm.mjs orient --cwd . --json']
      : [],
    nextCommand,
    readFirst: routeIntent === 'legacy-atomization'
      ? ['README.md', 'docs/ATOM_GENERATOR.md', 'docs/LIFECYCLE.md']
      : ['README.md'],
    targetSelectionHint: routeIntent === 'legacy-atomization' && !hasConfigHotspot
      ? 'No config legacy hotspot was found; add --target-file and --release-blocker before running start --legacy-flow.'
      : null,
    blockedAntiPatterns: classification.blockedAntiPatterns,
    lexiconSources: classification.lexiconSources,
    hostLearning: {
      lexiconPath: '.atm/guidance/intent-lexicon.json',
      activeEntryCount: hostLexicon.entries.filter((entry) => entry.status === 'active-host').length
    },
    orientationSummary: {
      adapterStatus: orientation.adapterStatus.status,
      configLegacyHotspotCount: orientation.configLegacyHotspots.length,
      detectedLanguages: orientation.detectedLanguages
    }
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
        action: 'Run `atm guide --goal "<legacy extraction goal>"` first; legacy extraction must route through LegacyRoutePlan before `atm create` evidence is used.'
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

function buildLearnGuide(cwd: string, phrase: string, learnedIntent: GuidanceIntent, reason: string, status: GuidanceIntentStatus) {
  const recorded = recordGuidanceIntentPhrase({
    repositoryRoot: cwd,
    phrase,
    intent: learnedIntent,
    reason,
    status
  });
  return {
    intent: 'learn',
    summary: 'Host-local guidance intent phrase recorded.',
    phrase: recorded.entry.phrase,
    learnedIntent: recorded.entry.intent,
    status: recorded.entry.status,
    duplicate: recorded.duplicate,
    lexiconPath: path.relative(cwd, recorded.lexiconPath).replace(/\\/g, '/'),
    entryCount: recorded.document.entries.length,
    activationRule: 'Only active-host and promoted-framework entries influence future guide --goal classification.',
    promotionRule: 'Framework-default promotion requires neutral, adopter-free language and validator review.'
  };
}

function buildInstallSkillGuide(cwd: string, target: 'host' | 'codex', skillsRoot: string | null, force: boolean) {
  const frameworkRoot = resolveFrameworkRoot();
  const sourcePath = path.join(frameworkRoot, 'integrations', 'codex-skills', legacySkillName);
  if (!existsSync(path.join(sourcePath, 'SKILL.md'))) {
    throw new CliError('ATM_GUIDE_SKILL_NOT_FOUND', `Bundled skill was not found: ${sourcePath}`, {
      exitCode: 2,
      details: { sourcePath }
    });
  }

  const targetRoot = target === 'host'
    ? path.join(cwd, '.agents', 'skills')
    : path.resolve(skillsRoot ?? defaultCodexSkillsRoot());
  const targetPath = path.join(targetRoot, legacySkillName);
  const existed = existsSync(targetPath);
  if (existed && !force) {
    return {
      intent: 'install-skill',
      summary: 'ATM legacy atomization skill is already installed.',
      skillName: legacySkillName,
      target,
      installed: false,
      overwritten: false,
      sourcePath,
      targetPath,
      activationHint: target === 'host'
        ? 'Host agents can load the skill from .agents/skills when their environment supports repo-local skills.'
        : 'Codex can load the skill from the configured skills root on the next session.'
    };
  }

  if (existed && force) {
    rmSync(targetPath, { recursive: true, force: true });
  }
  mkdirSync(targetRoot, { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
  return {
    intent: 'install-skill',
    summary: 'ATM legacy atomization skill installed.',
    skillName: legacySkillName,
    target,
    installed: true,
    overwritten: existed && force,
    sourcePath,
    targetPath,
    activationHint: target === 'host'
      ? 'Host agents can load the skill from .agents/skills when their environment supports repo-local skills.'
      : 'Codex can load the skill from the configured skills root on the next session.'
  };
}

function buildCommandHelpGuide(commandName: any) {
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

function buildGuide(parsed: ReturnType<typeof parseGuideArgs>) {
  switch (parsed.intent) {
    case 'goal':
      return buildGoalGuide(parsed.cwd, parsed.goal ?? '');
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
    case 'learn':
      return buildLearnGuide(parsed.cwd, parsed.phrase ?? '', parsed.learnedIntent!, parsed.reason ?? '', parsed.status);
    case 'install-skill':
      return buildInstallSkillGuide(parsed.cwd, parsed.target, parsed.skillsRoot, parsed.force);
    case 'help':
      return buildCommandHelpGuide(parsed.topic);
    default:
      throw new CliError('ATM_CLI_USAGE', `Unknown guide intent: ${parsed.intent}`, {
        exitCode: 2,
        details: { supportedIntents: supportedGuideIntents }
      });
  }
}

export function runGuide(argv: any) {
  const parsed = parseGuideArgs(argv);
  const guide = buildGuide(parsed);
  return makeResult({
    ok: true,
    command: 'guide',
    cwd: parsed.cwd,
    messages: [message('info', 'ATM_GUIDE_READY', `Guide for ${guide.intent} is ready.`, { intent: guide.intent })],
    evidence: guide
  });
}

function quoteCliValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function resolveFrameworkRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

function defaultCodexSkillsRoot(): string {
  const codexHome = process.env.CODEX_HOME;
  return codexHome
    ? path.join(codexHome, 'skills')
    : path.join(os.homedir(), '.codex', 'skills');
}
