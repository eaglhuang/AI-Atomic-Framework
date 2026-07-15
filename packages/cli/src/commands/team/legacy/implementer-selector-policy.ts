import path from 'node:path';

import type {
  TeamImplementerSelector,
  TeamLevel,
  TeamRecipe,
  TeamRecipeAgent
} from './types.ts';

const teamRosterLevelRoles: Record<TeamLevel, string[]> = {
  L1: ['coordinator', 'atomizationPlanner', 'implementer', 'validator'],
  L2: ['coordinator', 'atomizationPlanner', 'reader', 'implementer', 'validator', 'evidenceCollector'],
  L3: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector'],
  L4: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant'],
  L5: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant', 'reviewAgent', 'knowledgeScout']
};

const teamRosterSyntheticAgents: Record<string, TeamRecipeAgent> = {
  lieutenant: { agentId: 'lieutenant', role: 'lieutenant', profile: 'atm.lieutenant.v1', permissions: ['file.read', 'exec.validator'] },
  reviewAgent: { agentId: 'review-agent', role: 'reviewAgent', profile: 'atm.reviewAgent.v1', permissions: ['file.read', 'exec.validator'] },
  knowledgeScout: { agentId: 'knowledge-scout', role: 'knowledgeScout', profile: 'atm.knowledgeScout.v1', permissions: ['file.read'] }
};

const catalogReadyRosterDeferredRoles = [
  'dataPipelineAgent',
  'dbContainerAgent',
  'ciAgent',
  'webResearchAgent',
  'qaLead',
  'closureSteward'
];

export function mapTeamSizeToLevel(value: unknown): TeamLevel {
  const normalized = String(value ?? '').trim();
  if (normalized === 'large') return 'L3';
  if (normalized === 'medium') return 'L2';
  return 'L1';
}

export function projectTeamRecipeForLevel(recipe: TeamRecipe, teamLevel: TeamLevel) {
  const targetRoles = teamRosterLevelRoles[teamLevel];
  const agentsByRole = new Map(recipe.agents.map((agent) => [agent.role, agent]));
  const agents = targetRoles
    .map((role) => agentsByRole.get(role) ?? teamRosterSyntheticAgents[role] ?? null)
    .filter((agent): agent is TeamRecipeAgent => agent !== null);
  const activeRoles = agents.map((agent) => agent.role);
  const deferredRoles = recipe.agents
    .map((agent) => agent.role)
    .filter((role) => !activeRoles.includes(role));
  const syntheticRoles = activeRoles.filter((role) => !recipe.agents.some((agent) => agent.role === role));
  return {
    recipe: {
      ...recipe,
      agents
    },
    projection: {
      schemaId: 'atm.teamRosterProjection.v1',
      teamLevel,
      teamSize: teamLevel === 'L1' ? 'small' : teamLevel === 'L2' ? 'medium' : 'large',
      activeRoles,
      syntheticRoles,
      deferredRoles,
      catalogReadyRosterDeferredRoles,
      roleRules: {
        L1: 'Core four: Coordinator, Atomization Planner, Implementer, Validator.',
        L2: 'Normal crew: L1 plus Reader and Evidence Collector.',
        L3: 'Large crew: L2 plus Scope Guardian.',
        L4: 'Escalated crew: L3 plus Lieutenant coordination boundary.',
        L5: 'Full advisory crew: L4 plus Review Agent and Knowledge Scout.'
      }
    }
  };
}

export function selectTeamImplementer(task: Record<string, unknown> | null | undefined, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector {
  const deterministicHints = collectImplementerHints(task, writePaths);
  const implementers = recipe.agents
    .filter((agent) => isImplementerAgent(agent))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  const pythonImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'python'));
  const typescriptImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'typescript'));
  const uiImplementers = implementers.filter((agent) => matchesUiImplementer(agent));

  const selected = pickImplementerCandidate({
    implementers,
    pythonImplementers,
    typescriptImplementers,
    uiImplementers,
    deterministicHints,
    recipeId: recipe.recipeId
  });

  return {
    schemaId: 'atm.teamImplementerSelector.v1',
    ...selected,
    deterministicHints
  };
}

function pickImplementerCandidate(input: {
  implementers: TeamRecipeAgent[];
  pythonImplementers: TeamRecipeAgent[];
  typescriptImplementers: TeamRecipeAgent[];
  uiImplementers: TeamRecipeAgent[];
  deterministicHints: TeamImplementerSelector['deterministicHints'] & {
    pythonHeavy: boolean;
    typescriptHeavy: boolean;
    uiPaths: boolean;
  };
  recipeId: string;
}) {
  const { deterministicHints, recipeId } = input;
  const genericImplementer = input.implementers.find((agent) => agent.language === 'generic') ?? {
    agentId: 'implementer-generic',
    role: 'implementer',
    profile: 'atm.implementer.generic.v1',
    language: 'generic',
    permissions: ['file.write']
  };

  if (deterministicHints.pythonHeavy && input.pythonImplementers.length > 0) {
    return buildSelectorResult(input.pythonImplementers[0], recipeId, 'python', 'python-implementer', 'No fallback needed; Python-heavy paths matched a Python implementer.', 'high');
  }

  if (deterministicHints.uiPaths && input.uiImplementers.length > 0) {
    return buildSelectorResult(input.uiImplementers[0], recipeId, inferSelectorLanguage(input.uiImplementers[0]), 'ui-implementer', 'No fallback needed; adopter UI path hints matched a UI-oriented implementer.', input.uiImplementers[0].language ? 'high' : 'medium');
  }

  if (deterministicHints.typescriptHeavy && input.typescriptImplementers.length > 0) {
    return buildSelectorResult(input.typescriptImplementers[0], recipeId, 'typescript', 'typescript-implementer', 'No fallback needed; TypeScript-heavy paths matched a TypeScript implementer.', 'high');
  }

  const fallbackRoleMatch = deterministicHints.uiPaths
    ? 'ui-implementer'
    : deterministicHints.pythonHeavy
      ? 'python-implementer'
      : deterministicHints.typescriptHeavy
        ? 'typescript-implementer'
        : 'generic-implementer';

  const fallbackReason = deterministicHints.pythonHeavy
    ? `Python-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
    : deterministicHints.uiPaths
      ? `Adopter UI path hints were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
      : deterministicHints.typescriptHeavy
        ? `TypeScript-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
        : `No specific language or UI hint dominated, so ${genericImplementer.agentId} was selected as the generic implementer.`;

  return buildSelectorResult(
    genericImplementer,
    recipeId,
    inferSelectorLanguage(genericImplementer),
    fallbackRoleMatch,
    fallbackReason,
    deterministicHints.pythonHeavy || deterministicHints.typescriptHeavy || deterministicHints.uiPaths ? 'medium' : 'low'
  );
}

function buildSelectorResult(
  agent: TeamRecipeAgent,
  recipeId: string,
  languageMatch: TeamImplementerSelector['languageMatch'],
  roleMatch: TeamImplementerSelector['roleMatch'],
  fallbackReason: string,
  confidence: TeamImplementerSelector['confidence']
) {
  return {
    selectedImplementer: {
      agentId: agent.agentId,
      role: agent.role,
      profile: agent.profile,
      language: agent.language,
      recipeId
    },
    languageMatch,
    roleMatch,
    fallbackReason,
    confidence
  };
}

function collectImplementerHints(task: Record<string, unknown> | null | undefined, writePaths: string[]) {
  const scopePaths = uniqueStrings([
    ...normalizeTaskPathArray(task?.scopePaths),
    ...normalizeTaskPathArray(task?.targetAllowedFiles),
    ...writePaths
  ]);
  const deliverables = uniqueStrings(normalizeTaskPathArray(task?.deliverables));
  const allPaths = uniqueStrings([...scopePaths, ...deliverables]);
  const fileExtensions = uniqueStrings(
    allPaths
      .map((entry) => path.posix.extname(entry.replace(/\\/g, '/')).toLowerCase())
      .filter(Boolean)
  );
  const pathHints = uniqueStrings([
    ...(allPaths.some((entry) => /\.pyi?$/i.test(entry)) ? ['python-heavy'] : []),
    ...(allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)) ? ['typescript-heavy'] : []),
    ...(allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry)) ? ['adopter-ui'] : []),
    ...pathHintsFromPaths(allPaths)
  ]);
  return {
    scopePaths,
    deliverables,
    fileExtensions,
    pathHints,
    pythonHeavy: allPaths.some((entry) => /\.pyi?$/i.test(entry)),
    typescriptHeavy: allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)),
    uiPaths: allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry))
  };
}

function pathHintsFromPaths(paths: string[]) {
  const hints: string[] = [];
  for (const entry of paths) {
    const normalized = entry.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/packages/cli/src/commands/')) hints.push('cli-command-surface');
    if (normalized.includes('/scripts/')) hints.push('script-surface');
    if (normalized.includes('/assets/')) hints.push('asset-surface');
    if (normalized.includes('/ui/') || normalized.includes('/editor/')) hints.push('adopter-ui');
    if (normalized.endsWith('.py') || normalized.endsWith('.pyi')) hints.push('python-file');
    if (normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.mts') || normalized.endsWith('.cts')) hints.push('typescript-file');
  }
  return hints;
}

function isImplementerAgent(agent: TeamRecipeAgent) {
  return /implementer/i.test(agent.role)
    || /implementer/i.test(agent.agentId)
    || /implementer/i.test(agent.profile ?? '')
    || agent.permissions.includes('file.write');
}

function matchesImplementerLanguage(agent: TeamRecipeAgent, language: 'typescript' | 'python') {
  const value = [agent.language, agent.profile, agent.agentId, agent.role].filter(Boolean).join(' ').toLowerCase();
  return value.includes(language);
}

function matchesUiImplementer(agent: TeamRecipeAgent) {
  const value = [agent.role, agent.profile, agent.agentId].filter(Boolean).join(' ').toLowerCase();
  return value.includes('ui') || value.includes('editor');
}

function inferSelectorLanguage(agent: TeamRecipeAgent) {
  if (matchesImplementerLanguage(agent, 'python')) return 'python' as const;
  if (matchesImplementerLanguage(agent, 'typescript')) return 'typescript' as const;
  return 'unknown' as const;
}

function normalizeTaskPathArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
