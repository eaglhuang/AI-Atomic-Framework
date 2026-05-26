import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CliError,
  makeResult,
  message,
  parseArgsForCommand,
  readJsonFile
} from './shared.ts';
import { getCommandSpec } from './command-specs.ts';

type TeamPermissionMode = 'exclusive' | 'shareable';

type TeamPermissionDefinition = {
  id: string;
  mode: TeamPermissionMode;
  scopeRequired?: boolean;
};

type TeamRecipeAgent = {
  agentId: string;
  role: string;
  profile?: string;
  language?: string;
  permissions: string[];
};

type TeamRecipe = {
  schemaId: 'atm.teamRecipe.v1';
  recipeId: string;
  appliesTo?: string[];
  language?: string;
  agents: TeamRecipeAgent[];
};

type PermissionFinding = {
  level: 'error' | 'warning';
  code: string;
  detail: string;
  permission?: string;
  agentIds?: string[];
};

const teamPermissionCatalog: TeamPermissionDefinition[] = [
  { id: 'task.lifecycle', mode: 'exclusive' },
  { id: 'git.write', mode: 'exclusive' },
  { id: 'file.read', mode: 'shareable', scopeRequired: true },
  { id: 'file.write', mode: 'exclusive', scopeRequired: true },
  { id: 'web.query', mode: 'exclusive' },
  { id: 'web.download', mode: 'exclusive', scopeRequired: true },
  { id: 'exec.validator', mode: 'shareable', scopeRequired: true },
  { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true },
  { id: 'sandbox.write', mode: 'exclusive' },
  { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true },
  { id: 'database.write', mode: 'exclusive', scopeRequired: true },
  { id: 'ci.write', mode: 'exclusive', scopeRequired: true },
  { id: 'evidence.write', mode: 'exclusive' }
];

const builtInRecipes: TeamRecipe[] = [
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.fast',
    appliesTo: ['fast'],
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  },
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.normal.typescript',
    appliesTo: ['normal'],
    language: 'typescript',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  },
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.batch',
    appliesTo: ['batch'],
    agents: [
      { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'current-task-reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'current-task-scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'current-task-implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  }
];

export async function runTeam(argv: string[]) {
  const spec = getCommandSpec('team');
  const parsed = parseArgsForCommand(spec, argv);
  const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  if (action !== 'plan') {
    throw new CliError('ATM_CLI_USAGE', 'team currently supports only: plan', { exitCode: 2 });
  }

  const taskId = String(parsed.options.task ?? '').trim();
  if (!taskId) {
    throw new CliError('ATM_TEAM_TASK_REQUIRED', 'team plan requires --task <id>.', { exitCode: 2 });
  }

  const task = readTask(cwd, taskId);
  const recipes = loadTeamRecipes(cwd);
  const requestedRecipeId = String(parsed.options.recipe ?? '').trim();
  const recipe = selectRecipe({
    recipes,
    requestedRecipeId,
    task
  });
  const validation = validateTeamRecipe(recipe);
  const writePaths = deriveWritePaths(task);
  const teamPlan = buildTeamPlan({
    task,
    recipe,
    writePaths,
    validation
  });
  const ok = validation.findings.every((finding) => finding.level !== 'error');

  return makeResult({
    ok,
    command: 'team',
    cwd,
    messages: [
      message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_PLAN_READY' : 'ATM_TEAM_PLAN_INVALID', ok
        ? 'Team plan dry-run completed. No runtime state was written and no agents were spawned.'
        : 'Team plan found permission conflicts. No runtime state was written and no agents were spawned.', {
        taskId,
        recipeId: recipe.recipeId,
        findingCount: validation.findings.length
      })
    ],
    evidence: {
      action: 'plan',
      dryRun: true,
      runtimeWritten: false,
      agentsSpawned: false,
      task: {
        taskId,
        title: task.title ?? task.workItemId ?? taskId,
        status: task.status ?? null,
        targetRepo: task.targetRepo ?? null,
        sourcePlanPath: task.source?.planPath ?? task.sourcePlanPath ?? null
      },
      recipe,
      recipeSources: recipes.sources,
      permissionCatalog: teamPermissionCatalog,
      validation,
      teamPlan
    }
  });
}

function readTask(cwd: string, taskId: string) {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TEAM_TASK_NOT_FOUND', `Task not found for team plan: ${taskId}`, {
      exitCode: 2,
      details: { taskId, taskPath: path.relative(cwd, taskPath).replace(/\\/g, '/') }
    });
  }
  return readJsonFile(taskPath, 'ATM_TEAM_TASK_NOT_FOUND');
}

function loadTeamRecipes(cwd: string): { recipes: TeamRecipe[]; sources: unknown[] } {
  const recipeDir = path.join(cwd, '.atm', 'config', 'team-recipes');
  const repoRecipes = existsSync(recipeDir)
    ? readdirSync(recipeDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const filePath = path.join(recipeDir, entry);
        return {
          recipe: normalizeRecipe(JSON.parse(readFileSync(filePath, 'utf8'))),
          source: {
            kind: 'repo-json',
            path: path.relative(cwd, filePath).replace(/\\/g, '/')
          }
        };
      })
    : [];
  return {
    recipes: [
      ...builtInRecipes,
      ...repoRecipes.map((entry) => entry.recipe)
    ],
    sources: [
      { kind: 'built-in-json', recipeIds: builtInRecipes.map((entry) => entry.recipeId) },
      ...repoRecipes.map((entry) => entry.source)
    ]
  };
}

function normalizeRecipe(value: any): TeamRecipe {
  if (value?.schemaId !== 'atm.teamRecipe.v1') {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON must use schemaId atm.teamRecipe.v1.', { exitCode: 2 });
  }
  const recipeId = String(value.recipeId ?? '').trim();
  if (!recipeId) {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON requires recipeId.', { exitCode: 2 });
  }
  const agents: TeamRecipeAgent[] = Array.isArray(value.agents) ? value.agents.map((entry: any) => ({
    agentId: String(entry?.agentId ?? '').trim(),
    role: String(entry?.role ?? '').trim(),
    profile: entry?.profile ? String(entry.profile).trim() : undefined,
    language: entry?.language ? String(entry.language).trim() : undefined,
    permissions: Array.isArray(entry?.permissions) ? entry.permissions.map((permission: unknown) => String(permission).trim()).filter(Boolean) : []
  })) : [];
  if (agents.length === 0 || agents.some((agent: TeamRecipeAgent) => !agent.agentId || !agent.role)) {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', `Team recipe ${recipeId} requires agents with agentId and role.`, { exitCode: 2 });
  }
  return {
    schemaId: 'atm.teamRecipe.v1',
    recipeId,
    appliesTo: Array.isArray(value.appliesTo) ? value.appliesTo.map(String) : undefined,
    language: value.language ? String(value.language) : undefined,
    agents
  };
}

function selectRecipe(input: {
  recipes: { recipes: TeamRecipe[]; sources: unknown[] };
  requestedRecipeId: string;
  task: any;
}) {
  if (input.requestedRecipeId) {
    const recipe = input.recipes.recipes.find((entry) => entry.recipeId === input.requestedRecipeId);
    if (!recipe) {
      throw new CliError('ATM_TEAM_RECIPE_NOT_FOUND', `Team recipe not found: ${input.requestedRecipeId}`, {
        exitCode: 2,
        details: { availableRecipeIds: input.recipes.recipes.map((entry) => entry.recipeId) }
      });
    }
    return recipe;
  }
  const language = inferTaskLanguage(input.task);
  return input.recipes.recipes.find((entry) => entry.language === language)
    ?? input.recipes.recipes.find((entry) => entry.recipeId === 'atm.default.normal.typescript')
    ?? input.recipes.recipes[0];
}

function inferTaskLanguage(task: any) {
  const paths = [
    ...normalizeStringArray(task.targetAllowedFiles),
    ...normalizeStringArray(task.deliverables),
    ...normalizeStringArray(task.scopePaths)
  ];
  if (paths.some((entry) => entry.endsWith('.py') || entry.includes('pipelines/'))) return 'python';
  if (paths.some((entry) => entry.endsWith('.cs'))) return 'csharp';
  return 'typescript';
}

function validateTeamRecipe(recipe: TeamRecipe) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const ownersByPermission = new Map<string, string[]>();
  const findings: PermissionFinding[] = [];

  for (const agent of recipe.agents) {
    for (const permission of agent.permissions) {
      if (!permissionDefinitions.has(permission)) {
        findings.push({
          level: 'error',
          code: 'ATM_TEAM_PERMISSION_UNKNOWN',
          detail: `Unknown team permission: ${permission}`,
          permission,
          agentIds: [agent.agentId]
        });
      }
      ownersByPermission.set(permission, [...(ownersByPermission.get(permission) ?? []), agent.agentId]);
    }
  }

  for (const permission of teamPermissionCatalog.filter((entry) => entry.mode === 'exclusive')) {
    const owners = ownersByPermission.get(permission.id) ?? [];
    if (owners.length > 1) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_CONFLICT',
        detail: `Exclusive permission ${permission.id} has multiple owners.`,
        permission: permission.id,
        agentIds: owners
      });
    }
  }

  const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator');
  for (const permission of ['task.lifecycle', 'git.write']) {
    const owners = ownersByPermission.get(permission) ?? [];
    if (owners.length !== 1 || owners[0] !== coordinator?.agentId) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_UNIQUE_OWNER_REQUIRED',
        detail: `${permission} must have exactly one owner and it must be the coordinator.`,
        permission,
        agentIds: owners
      });
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function buildTeamPlan(input: {
  task: any;
  recipe: TeamRecipe;
  writePaths: string[];
  validation: { ok: boolean; findings: PermissionFinding[] };
}) {
  const coordinator = input.recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
  const fileWriteOwner = input.recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
  return {
    schemaId: 'atm.teamPlan.v1',
    recipeId: input.recipe.recipeId,
    channelHint: 'normal',
    agents: input.recipe.agents,
    suggestedPermissionLeases: [
      ...(coordinator ? [
        { permission: 'task.lifecycle', agentId: coordinator.agentId },
        { permission: 'git.write', agentId: coordinator.agentId },
        { permission: 'evidence.write', agentId: coordinator.agentId }
      ] : []),
      ...(fileWriteOwner ? [{
        permission: 'file.write',
        agentId: fileWriteOwner.agentId,
        paths: input.writePaths
      }] : [])
    ],
    nextSteps: [
      'Review this dry-run plan.',
      'If accepted, implement a future team start runtime command.',
      'Do not write .atm/runtime team state from team plan.'
    ],
    validation: input.validation
  };
}

function deriveWritePaths(task: any) {
  const candidates = [
    ...normalizeStringArray(task.targetAllowedFiles),
    ...normalizeStringArray(task.deliverables),
    ...normalizeStringArray(task.scopePaths)
  ];
  return uniqueStrings(candidates.filter((entry) => {
    const normalized = entry.replace(/\\/g, '/');
    return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/task-events/');
  }));
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
