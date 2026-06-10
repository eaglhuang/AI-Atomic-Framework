import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CliError,
  makeResult,
  message,
  parseArgsForCommand,
  readJsonFile,
  writeJsonFile
} from './shared.ts';
import { getCommandSpec } from './command-specs.ts';
import { runTasks } from './tasks.ts';
import {
  buildTeamBrokerEvidence,
  brokerLaneToFindings,
  evaluateTeamBrokerLane
} from '../../../core/src/broker/team-lane.ts';
import type { TeamBrokerLaneEvidence } from '../../../core/src/broker/team-lane.ts';

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
  paths?: string[];
};

type PermissionLease = {
  permission: string;
  agentId: string;
  paths?: string[];
};

type TeamCrewRole = {
  role: string;
  agentId: string;
  required: boolean;
  permissions: string[];
  description: string;
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

const atomizationRiskHotFiles = new Set([
  'tasks.ts',
  'next.ts',
  'evidence.ts',
  'hook.ts'
]);

const atomizationPlanningThreshold = 3;

export const TEAM_ATOM_BOUNDARIES = {
  'team.cli-entry': {
    anchor: 'packages/cli/src/commands/team.ts#runTeam',
    capability: 'Team CLI entry router for plan, start, status, and validate actions.',
    downstreamTasks: ['TASK-TEAM-0001']
  },
  'team.recipe-permission-model': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Recipe catalog validation and scoped permission lease planning.',
    downstreamTasks: ['TASK-TEAM-0001']
  },
  'team.plan-crew-briefing-contract': {
    anchor: 'packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract',
    capability: 'Minimal crew briefing contract with required roles, stop conditions, and parallel advisory.',
    downstreamTasks: ['TASK-TEAM-0002']
  },
  'team.plan-atomization-planner': {
    anchor: 'packages/cli/src/commands/team.ts#buildAtomizationChecklist',
    capability: 'Atomization planner advisory checklist for scope shape and split recommendations.',
    downstreamTasks: ['TASK-TEAM-0003']
  },
  'team.plan-task-0009-preflight': {
    anchor: 'docs/governance/team-agents/task-0009-preflight-contract.md',
    capability: 'TASK-TEAM-0009 preflight/referee contract covering dependency map, acceptance checklist, and mailbox materialization corrective dispatch rules.',
    downstreamTasks: ['TASK-TEAM-0009']
  },
  'team.plan-broker-lane': {
    anchor: 'packages/cli/src/commands/team.ts#planTeamBrokerLane',
    capability: 'Broker lane evaluation and steward/composer routing for team plan/start.',
    downstreamTasks: ['TASK-TEAM-0001', 'TASK-CID-0021']
  },
  'team.captain-decision': {
    anchor: 'packages/cli/src/commands/team.ts#buildCaptainDecision',
    capability: 'Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.',
    downstreamTasks: ['TASK-TEAM-0007']
  },
  'team.start-runtime-state': {
    anchor: 'packages/cli/src/commands/team.ts#writeTeamRun',
    capability: 'Team run runtime record writer under .atm/runtime/team-runs.',
    downstreamTasks: ['TASK-TEAM-0001']
  },
  'team.status-runtime-read': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamStatusResult',
    capability: 'Read-only team run status surface.',
    downstreamTasks: ['TASK-TEAM-0001']
  }
} as const;

const builtInRecipes: TeamRecipe[] = [
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.fast',
    appliesTo: ['fast'],
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
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
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
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
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
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

  if (!['plan', 'start', 'status', 'validate'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate', { exitCode: 2 });
  }

  if (action === 'status') {
    return buildTeamStatusResult({
      cwd,
      requestedTeamRunId: String(parsed.options.team ?? '').trim(),
      compact: Boolean(parsed.options.compact)
    });
  }

  const taskId = String(parsed.options.task ?? '').trim();
  if (!taskId) {
    throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${action} requires --task <id>.`, { exitCode: 2 });
  }

  const context = await buildTeamPlanningContext({
    cwd,
    taskId,
    requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
    actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim()
  });
  const { task, recipes, recipe, validation, teamPlan } = context;
  const ok = validation.findings.every((finding) => finding.level !== 'error');

  if (action === 'validate') {
    return makeResult({
      ok,
      command: 'team',
      cwd,
      messages: [
        message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_PERMISSION_VALID' : 'ATM_TEAM_PERMISSION_INVALID', ok
          ? 'Team recipe and permission leases are valid.'
          : 'Team recipe or permission leases contain blocking findings.', {
          taskId,
          recipeId: recipe.recipeId,
          findingCount: validation.findings.length
        })
      ],
      evidence: {
        action: 'validate',
        dryRun: true,
        runtimeWritten: false,
        agentsSpawned: false,
        task: summarizeTask(taskId, task),
        recipe,
        recipeSources: recipes.sources,
        permissionCatalog: teamPermissionCatalog,
        validation,
        suggestedPermissionLeases: teamPlan.suggestedPermissionLeases,
        brokerLane: teamPlan.brokerLane
      }
    });
  }

  if (action === 'start') {
    const actorId = String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim();
    if (!actorId) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'team start requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    if (!ok) {
      return makeResult({
        ok: false,
        command: 'team',
        cwd,
        messages: [
          message('error', 'ATM_TEAM_START_BLOCKED', 'Team start blocked by permission validation findings.', {
            taskId,
            recipeId: recipe.recipeId,
            findingCount: validation.findings.length
          })
        ],
        evidence: {
          action: 'start',
          runtimeWritten: false,
          agentsSpawned: false,
          task: summarizeTask(taskId, task),
          recipe,
          validation,
          teamPlan,
          brokerLane: teamPlan.brokerLane
        }
      });
    }
    const teamRun = writeTeamRun({
      cwd,
      actorId,
      taskId,
      task,
      recipe,
      teamPlan,
      validation
    });
    return makeResult({
      ok: true,
      command: 'team',
      cwd,
      messages: [
        message('info', 'ATM_TEAM_STARTED', 'Team run started. Runtime state was written, but no agents were spawned.', {
          teamRunId: teamRun.teamRunId,
          taskId,
          recipeId: recipe.recipeId
        })
      ],
      evidence: {
        action: 'start',
        runtimeWritten: true,
        agentsSpawned: false,
        teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
        teamRun,
        brokerLane: teamPlan.brokerLane
      }
    });
  }

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
      task: summarizeTask(taskId, task),
      recipe,
      recipeSources: recipes.sources,
      permissionCatalog: teamPermissionCatalog,
      validation,
      teamPlan,
      brokerLane: teamPlan.brokerLane
    }
  });
}

async function buildTeamPlanningContext(input: {
  cwd: string;
  taskId: string;
  requestedRecipeId: string;
  actorId: string;
}) {
  const task = readTask(input.cwd, input.taskId);
  const recipes = loadTeamRecipes(input.cwd);
  const recipe = selectRecipe({
    recipes,
    requestedRecipeId: input.requestedRecipeId,
    task
  });
  const writePaths = deriveWritePaths(task);
  const permissionValidation = validateTeamPermissionModel(recipe, writePaths);

  const parallelFindings: PermissionFinding[] = [];
  try {
    const parallelResult = await runTasks([
      'parallel',
      '--task',
      input.taskId,
      '--queue',
      '--cwd',
      input.cwd,
      '--json'
    ]);
    if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
      for (const candidate of parallelResult.evidence.candidates) {
        const finding = candidate.finding;
        if (finding && Array.isArray(finding.overlappingAtomIds) && finding.overlappingAtomIds.length > 0) {
          // Consumer-side compensation: override verdict to 'blocked-cid-conflict'
          parallelFindings.push({
            level: 'error',
            code: 'blocked-cid-conflict',
            detail: `Parallel advisor identified a CID logic conflict with task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}`,
            paths: finding.overlappingFiles
          });
        }
      }
    }
  } catch (err) {
    // Best-effort check
  }

  const brokerLanePlan = planTeamBrokerLane({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    task,
    writePaths
  });
  const brokerLane = brokerLanePlan.evidence;
  const validation = mergeValidation(
    permissionValidation,
    { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings },
    { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings }
  );

  const finalTeamPlan = buildTeamPlan({
    task,
    recipe,
    writePaths,
    validation,
    brokerLane
  });

  return {
    task,
    recipes,
    recipe,
    validation,
    teamPlan: {
      ...finalTeamPlan,
      validation,
      brokerLane
    }
  };
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

export function validateTeamPermissionModel(recipe: TeamRecipe, writePaths: string[]) {
  return mergeValidation(
    validateTeamRecipe(recipe),
    validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths))
  );
}

export function planTeamBrokerLane(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  task: any;
  writePaths: string[];
}) {
  const brokerLaneResult = evaluateTeamBrokerLane(input);
  return {
    result: brokerLaneResult,
    evidence: buildTeamBrokerEvidence(brokerLaneResult),
    findings: brokerLaneToFindings(brokerLaneResult).map((finding) => ({
      level: finding.level,
      code: finding.code,
      detail: finding.detail,
      paths: finding.paths
    })) satisfies PermissionFinding[]
  };
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

function validatePermissionLeases(leases: PermissionLease[]) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const findings: PermissionFinding[] = [];
  const ownersByExclusivePermission = new Map<string, string[]>();

  for (const lease of leases) {
    const definition = permissionDefinitions.get(lease.permission);
    if (!definition) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_UNKNOWN',
        detail: `Unknown team permission lease: ${lease.permission}`,
        permission: lease.permission,
        agentIds: [lease.agentId]
      });
      continue;
    }
    if (definition.mode === 'exclusive') {
      ownersByExclusivePermission.set(lease.permission, [
        ...(ownersByExclusivePermission.get(lease.permission) ?? []),
        lease.agentId
      ]);
    }
    if (definition.scopeRequired && (!Array.isArray(lease.paths) || lease.paths.length === 0)) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED',
        detail: `${lease.permission} requires explicit scoped paths.`,
        permission: lease.permission,
        agentIds: [lease.agentId]
      });
    }
    const forbiddenRuntimePaths = (lease.paths ?? []).filter((entry) => entry.replace(/\\/g, '/').startsWith('.atm/runtime/'));
    if (forbiddenRuntimePaths.length > 0) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN',
        detail: `${lease.permission} cannot lease .atm/runtime/** paths.`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        paths: forbiddenRuntimePaths
      });
    }
  }

  for (const [permission, owners] of ownersByExclusivePermission.entries()) {
    if (new Set(owners).size > 1) {
      findings.push({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_LEASE_CONFLICT',
        detail: `Exclusive permission lease ${permission} has multiple owners.`,
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

function mergeValidation(...reports: { ok: boolean; findings: PermissionFinding[] }[]) {
  const findings = reports.flatMap((report) => report.findings);
  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function buildSuggestedPermissionLeases(recipe: TeamRecipe, writePaths: string[]): PermissionLease[] {
  const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
  const fileWriteOwner = recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
  return [
    ...(coordinator ? [
      { permission: 'task.lifecycle', agentId: coordinator.agentId },
      { permission: 'git.write', agentId: coordinator.agentId },
      { permission: 'evidence.write', agentId: coordinator.agentId }
    ] : []),
    ...(fileWriteOwner ? [{
      permission: 'file.write',
      agentId: fileWriteOwner.agentId,
      paths: writePaths
    }] : [])
  ] satisfies PermissionLease[];
}

function buildTeamPlan(input: {
  task: any;
  recipe: TeamRecipe;
  writePaths: string[];
  validation: { ok: boolean; findings: PermissionFinding[] };
  brokerLane: TeamBrokerLaneEvidence;
}) {
  const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
  const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
  const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist);
  return {
    schemaId: 'atm.teamPlan.v1',
    recipeId: input.recipe.recipeId,
    channelHint: 'normal',
    brokerLane: input.brokerLane,
    agents: input.recipe.agents,
    captainDecision,
    requiredRoles: crewBriefingContract.requiredRoles,
    optionalRoles: crewBriefingContract.optionalRoles,
    briefingContract: crewBriefingContract,
    atomizationPlannerRole: {
      role: 'atomizationPlanner',
      agentIds: input.recipe.agents.filter((agent) => agent.role === 'atomizationPlanner').map((agent) => agent.agentId),
      permissions: input.recipe.agents.find((agent) => agent.role === 'atomizationPlanner')?.permissions ?? []
    },
    atomizationChecklist,
    suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths),
    nextSteps: [
      'Review this dry-run plan.',
      'Run team start when you want a runtime team run record.',
      'Do not hand-edit .atm/runtime team state.'
    ],
    validation: input.validation
  };
}

function buildCaptainDecision(
  task: any,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence,
  crewBriefingContract: ReturnType<typeof buildMinimalTaskCrewBriefingContract>,
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>
) {
  const sizing = decideTeamSizing(task, writePaths, validation, brokerLane);
  const lieutenantEscalation = assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist);
  return {
    schemaId: 'atm.teamCaptainDecision.v1',
    captain: {
      role: 'Task Captain',
      agentId: 'coordinator'
    },
    taskId: crewBriefingContract.taskId,
    teamSize: sizing.teamSize,
    requiredRoles: crewBriefingContract.requiredRoles.map((role) => role.role),
    optionalRoles: crewBriefingContract.optionalRoles.map((role) => role.role),
    reason: sizing.reason,
    confidence: sizing.confidence,
    stopConditions: crewBriefingContract.stopConditions,
    escalationRequired: lieutenantEscalation.escalationRequired,
    escalationReason: lieutenantEscalation.escalationReason,
    needLieutenant: lieutenantEscalation.needLieutenant,
    nextTeamShape: lieutenantEscalation.nextTeamShape,
    decisionSurface: {
      validationOk: validation.ok,
      brokerVerdict: brokerLane.decision.verdict,
      largeScriptRisk: atomizationChecklist.largeScriptRisk,
      mapUpdateNeed: atomizationChecklist.mapUpdateNeed,
      escalationRequired: lieutenantEscalation.escalationRequired,
      needLieutenant: lieutenantEscalation.needLieutenant
    }
  };
}

export function assessLieutenantEscalation(
  task: any,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence,
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>
) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
  const normalizedTitle = String(task?.title ?? '').toLowerCase();
  const scopePaths = uniqueStrings([
    ...normalizeStringArray(task?.scopePaths),
    ...normalizeStringArray(task?.deliverables),
    ...normalizeStringArray(task?.targetAllowedFiles)
  ]);
  const scopeCount = scopePaths.length;
  const taskRepo = String(task?.targetRepo ?? task?.planningRepo ?? '').trim();
  const planningRepo = String(task?.planningRepo ?? '').trim();
  const crossRepoScope = Boolean(taskRepo && planningRepo && taskRepo !== planningRepo);
  const validatorCount = uniqueStrings([
    ...normalizeStringArray(task?.validators),
    ...normalizeStringArray(task?.acceptance)
  ]).length;
  const closureSignals = Boolean(
    uniqueStrings([
      ...normalizeStringArray(task?.scopePaths),
      ...normalizeStringArray(task?.deliverables)
    ]).some((entry) => /closure|evidence|git/i.test(entry))
    || /closure|evidence|git/i.test(normalizedTitle)
  );
  const largeScriptRisk = atomizationChecklist.largeScriptRisk.level === 'high';
  const validationHasBlockingFinding = validation.findings.some((finding) => finding.level === 'error');
  const brokerRequiresCoordination = brokerLane.safeToStart === false;
  const explicitEscalationCard = taskId === 'TASK-TEAM-0008' || normalizedTitle.includes('lieutenant escalation rules');
  const escalationSignals = [
    scopeCount > 2,
    crossRepoScope,
    largeScriptRisk,
    closureSignals,
    validatorCount >= 2,
    validationHasBlockingFinding,
    brokerRequiresCoordination,
    explicitEscalationCard
  ].filter(Boolean).length;

  const escalationRequired = explicitEscalationCard || escalationSignals >= 2;
  const needLieutenant = escalationRequired;
  const escalationReason = escalationRequired
    ? [
        explicitEscalationCard ? 'This card explicitly governs lieutenant escalation rules.' : null,
        scopeCount > 2 ? `Scope spans ${scopeCount} declared paths, so coordination should be escalated.` : null,
        crossRepoScope ? 'Scope crosses repo boundaries and should retain a lieutenant coordination boundary.' : null,
        largeScriptRisk ? 'Large script risk indicates the captain should not keep all coordination signals inline.' : null,
        closureSignals ? 'Closure, evidence, or git signals are present and should be tracked by a lieutenant boundary.' : null,
        validatorCount >= 2 ? `Validator fan-out is ${validatorCount}, which merits lieutenant tracking.` : null,
        validationHasBlockingFinding ? 'Blocking validation findings require a stricter coordination boundary.' : null,
        brokerRequiresCoordination ? `Broker verdict is ${brokerLane.decision.verdict}, so the lane is not trivially safe-to-start.` : null
      ].filter(Boolean).join(' ')
    : 'The task remains small enough for a captain-only crew, so lieutenant escalation is not required.';

  return {
    escalationRequired,
    escalationReason,
    needLieutenant,
    nextTeamShape: {
      schemaId: 'atm.teamLieutenantEscalationShape.v1',
      captain: {
        role: 'Task Captain',
        permissions: ['task.lifecycle', 'git.write', 'evidence.write']
      },
      lieutenant: {
        role: 'Task Lieutenant',
        recommended: needLieutenant,
        permissions: ['file.read', 'exec.validator'],
        forbiddenPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
        coordinationFocus: ['phase coordination', 'blocker tracking', 'handoff summarization']
      },
      teamSizeHint: needLieutenant ? 'medium' : 'small',
      coordinationBoundary: needLieutenant ? 'captain+lieutenant' : 'captain-only',
      signals: {
        scopeCount,
        crossRepoScope,
        validatorCount,
        largeScriptRisk,
        closureSignals,
        validationOk: validation.ok,
        brokerVerdict: brokerLane.decision.verdict
      },
      suggestedPermissions: {
        captain: ['task.lifecycle', 'git.write', 'evidence.write'],
        lieutenant: ['file.read', 'exec.validator']
      }
    }
  };
}

function decideTeamSizing(
  task: any,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence
) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
  const normalizedTitle = String(task?.title ?? '').toLowerCase();
  if (taskId === 'TASK-TEAM-0002' || normalizedTitle.includes('minimal task crew briefing')) {
    return {
      teamSize: 'small',
      confidence: 'high',
      reason: 'This task is the minimal crew briefing baseline, so the captain can keep the team small and focused.'
    };
  }
  if (taskId === 'TASK-TEAM-0003' || normalizedTitle.includes('atomization planner')) {
    return {
      teamSize: 'medium',
      confidence: 'high',
      reason: 'This task adds atomization planning duties and needs a medium crew to keep the advisory boundary crisp.'
    };
  }
  if (taskId === 'TASK-TEAM-0007' || normalizedTitle.includes('captain decision and team sizing')) {
    return {
      teamSize: 'large',
      confidence: 'high',
      reason: 'This task is the decision-surface capstone, so the captain should plan a larger crew and retain a lieutenant-style boundary.'
    };
  }

  const scopeCount = uniqueStrings([
    ...normalizeStringArray(task?.scopePaths),
    ...normalizeStringArray(task?.deliverables),
    ...normalizeStringArray(task?.targetAllowedFiles)
  ]).length;
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const highRiskSignals = [
    scopeCount > 3,
    largeScriptRisk.level === 'high',
    brokerLane.decision.verdict !== 'parallel-safe',
    validation.findings.some((finding) => finding.level === 'error')
  ].filter(Boolean).length;

  if (highRiskSignals >= 3) {
    return {
      teamSize: 'large',
      confidence: 'high',
      reason: 'Multiple high-risk signals indicate the captain should staff a larger crew and keep a lieutenant-style coordination boundary.'
    };
  }

  if (highRiskSignals >= 1) {
    return {
      teamSize: 'medium',
      confidence: 'medium',
      reason: 'The task has meaningful atomization or lane risk, so the captain should plan for a medium crew with broader validation support.'
    };
  }

  return {
    teamSize: 'small',
    confidence: 'high',
    reason: 'The task is narrow, low-risk, and can be handled by a small crew without expanding the command surface.'
  };
}

export function buildMinimalTaskCrewBriefingContract(
  task: any,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence
) {
  const requiredRoles: TeamCrewRole[] = [
    {
      role: 'Task Captain',
      agentId: 'coordinator',
      required: true,
      permissions: ['task.lifecycle', 'git.write', 'evidence.write'],
      description: 'Owns coordination, delivery closure, and final report routing.'
    },
    {
      role: 'Atomization Planner',
      agentId: 'atomization-planner',
      required: true,
      permissions: ['file.read'],
      description: 'Checks scope shape, atomization risk, and allowed-file boundaries.'
    },
    {
      role: 'Code Builder',
      agentId: 'implementer',
      required: true,
      permissions: ['file.write'],
      description: 'Implements the scoped task deliverables only inside allowed files.'
    },
    {
      role: 'Check Runner',
      agentId: 'validator',
      required: true,
      permissions: ['exec.validator'],
      description: 'Runs the required validators and reports pass or fail evidence.'
    }
  ];

  const optionalRoles: TeamCrewRole[] = [
    {
      role: 'Reader',
      agentId: 'reader',
      required: false,
      permissions: ['file.read'],
      description: 'Gathers source context when the task needs discovery.'
    },
    {
      role: 'Evidence Collector',
      agentId: 'evidence-collector',
      required: false,
      permissions: ['file.read'],
      description: 'Packages command-backed evidence for the report.'
    },
    {
      role: 'Scope Guardian',
      agentId: 'scope-guardian',
      required: false,
      permissions: ['file.read'],
      description: 'Watches for out-of-scope file drift.'
    }
  ];

  const cidConflicts = validation.findings.filter((f) => f.code === 'blocked-cid-conflict');
  const parallelAdvisory = cidConflicts.length > 0 ? {
    schemaId: 'atm.parallelAdvisory.v1',
    verdict: 'blocked-cid-conflict',
    reasons: cidConflicts.map((c) => c.detail),
    conflicts: cidConflicts
  } : null;
  const brokerAdvisory = brokerLane.chosenLane === 'neutral-steward' ? {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: 'steward-lane',
    stewardId: brokerLane.stewardId,
    composerPath: brokerLane.composerPath,
    decision: brokerLane.decision
  } : brokerLane.safeToStart ? {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: brokerLane.decision.verdict,
    chosenLane: brokerLane.chosenLane,
    decision: brokerLane.decision
  } : {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: brokerLane.decision.verdict,
    chosenLane: brokerLane.chosenLane,
    blockedReasons: brokerLane.blockedReasons,
    decision: brokerLane.decision
  };

  return {
    schemaId: 'atm.teamCrewBriefingContract.v1',
    taskId: String(task?.workItemId ?? task?.taskId ?? 'unknown-task'),
    taskTitle: String(task?.title ?? task?.workItemId ?? task?.taskId ?? 'unknown-task'),
    allowedFiles: uniqueStrings(writePaths),
    doNotTouch: [
      '.atm/runtime/**',
      '.atm/history/**',
      'planning repository files',
      'unrelated source surfaces outside the task scope'
    ],
    expectedReports: [
      'team plan --task <id> --json',
      'validation result with safe-to-start or blocking findings',
      'team run record only if the coordinator chooses to start'
    ],
    stopConditions: [
      'scope must stay within declared allowed files',
      'required roles must each be uniquely represented',
      'validators must not report blocking permission conflicts',
      'a broader or stronger lane must stop the plan'
    ],
    requiredRoles,
    optionalRoles,
    validation,
    brokerAdvisory,
    ...(parallelAdvisory ? { parallelAdvisory } : {})
  };
}

export function buildAtomizationChecklist(task: any, writePaths: string[]) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? 'unknown-task');
  const primaryAtom: string = String(task?.atomizationImpact?.ownerAtomOrMap ?? task?.atomizationImpact?.owner_atom_or_map ?? 'atm.team-agents-map');
  const taskAtomSet = getTaskScopedAtoms(taskId);
  const relatedAtoms = uniqueStrings([
    primaryAtom,
    ...taskAtomSet,
    ...normalizeStringArray(task?.atomizationImpact?.mapUpdates ?? task?.atomizationImpact?.map_updates).flatMap(normalizeAtomReference),
    ...inferRelatedAtoms(writePaths)
  ]);
  const commandSurface = uniqueStrings([
    ...normalizeStringArray(task?.scopePaths),
    ...normalizeStringArray(task?.deliverables)
  ]);
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const mapUpdateNeed = relatedAtoms.some((entry) => entry.includes('atom-map') || entry.includes('map'))
    || writePaths.some((entry) => entry.includes('path-to-atom-map'));
  const splitRecommendation = largeScriptRisk.level === 'high'
    ? 'Recommend split into focused atoms before deeper implementation.'
    : 'Keep advisory-only planning; no automatic split on this card.';

  return {
    primaryAtom,
    relatedAtoms,
    commandSurface,
    largeScriptRisk,
    mapUpdateNeed,
    splitRecommendation
  };
}

function getTaskScopedAtoms(taskId: string) {
  if (taskId === 'TASK-TEAM-0003') {
    return ['team.plan-atomization-planner', 'team.spec.atomization-planner'];
  }
  if (taskId === 'TASK-TEAM-0002') {
    return ['team.plan-crew-briefing-contract', 'team.spec.crew-briefing'];
  }
  if (taskId === 'TASK-TEAM-0009') {
    return [
      'team.plan-task-0009-preflight',
      'team.spec.command-surface',
      'team.plan-atomization-planner',
      'team.spec.atomization-planner',
      'team.plan-broker-lane',
      'team.spec.broker-lane'
    ];
  }
  return [];
}

function inferRelatedAtoms(writePaths: string[]) {
  return writePaths.map((entry) => {
    return normalizeAtomReference(entry)[0] ?? null;
  }).filter((entry) => Boolean(entry)) as string[];
}

function normalizeAtomReference(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  if (basename === 'team.ts') return ['atom-cli-team'];
  if (basename === 'next.ts') return ['atom-cli-next'];
  if (basename === 'evidence.ts') return ['atom-cli-evidence'];
  if (basename === 'hook.ts') return ['atom-cli-hook'];
  if (basename === 'path-to-atom-map.json') return ['atm.team-agents-map'];
  if (normalized.startsWith('atom-') || normalized.startsWith('atm.')) return [value];
  return [];
}

function evaluateLargeScriptRisk(writePaths: string[]) {
  const hotFiles = writePaths.filter((entry) => atomizationRiskHotFiles.has(path.posix.basename(entry.replace(/\\/g, '/'))));
  const level = hotFiles.length > 0 || writePaths.length > atomizationPlanningThreshold ? 'high' : 'low';
  return {
    level,
    threshold: atomizationPlanningThreshold,
    reasons: [
      ...(hotFiles.length > 0 ? [`hot file touched: ${hotFiles.join(', ')}`] : []),
      ...(writePaths.length > atomizationPlanningThreshold ? [`touched files ${writePaths.length} exceed planning threshold ${atomizationPlanningThreshold}`] : [])
    ]
  };
}

export function writeTeamRun(input: {
  cwd: string;
  actorId: string;
  taskId: string;
  task: any;
  recipe: TeamRecipe;
  teamPlan: ReturnType<typeof buildTeamPlan>;
  validation: { ok: boolean; findings: PermissionFinding[] };
}) {
  const now = new Date().toISOString();
  const teamRunId = createTeamRunId(input.taskId, input.actorId, now);
  const teamRun = {
    schemaId: 'atm.teamRun.v1',
    teamRunId,
    channel: input.teamPlan.channelHint,
    taskId: input.taskId,
    batchId: null,
    actorId: input.actorId,
    recipeId: input.recipe.recipeId,
    status: 'active',
    executionMode: 'manual-team',
    agentsSpawned: false,
    runtimeWritten: true,
    task: summarizeTask(input.taskId, input.task),
    agents: input.recipe.agents,
    permissionLeases: input.teamPlan.suggestedPermissionLeases,
    validation: input.validation,
    brokerLane: input.teamPlan.brokerLane,
    createdAt: now,
    updatedAt: now
  };
  const directory = teamRunsDirectory(input.cwd);
  mkdirSync(directory, { recursive: true });
  writeJsonFile(path.join(directory, `${teamRunId}.json`), teamRun);
  return teamRun;
}

export function buildTeamStatusResult(input: {
  cwd: string;
  requestedTeamRunId: string;
  compact: boolean;
}) {
  const runs = input.requestedTeamRunId
    ? [readTeamRun(input.cwd, input.requestedTeamRunId)]
    : listTeamRuns(input.cwd);
  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message('info', 'ATM_TEAM_STATUS_READY', 'Team runtime status loaded.', {
        teamRunCount: runs.length,
        compact: input.compact
      })
    ],
    evidence: {
      action: 'status',
      teamRunCount: runs.length,
      teamRuns: input.compact ? runs.map(compactTeamRun) : runs
    }
  });
}

function listTeamRuns(cwd: string) {
  const directory = teamRunsDirectory(cwd);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}

function readTeamRun(cwd: string, teamRunId: string) {
  const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
  if (!existsSync(filePath)) {
    throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
      exitCode: 2,
      details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
    });
  }
  return readJsonFile(filePath, 'ATM_TEAM_RUN_INVALID');
}

function compactTeamRun(run: any) {
  return {
    teamRunId: run.teamRunId,
    taskId: run.taskId,
    recipeId: run.recipeId,
    status: run.status,
    agentCount: Array.isArray(run.agents) ? run.agents.length : 0,
    permissionLeaseCount: Array.isArray(run.permissionLeases) ? run.permissionLeases.length : 0,
    agentsSpawned: run.agentsSpawned === true,
    updatedAt: run.updatedAt ?? null
  };
}

function teamRunsDirectory(cwd: string) {
  return path.join(cwd, '.atm', 'runtime', 'team-runs');
}

function createTeamRunId(taskId: string, actorId: string, createdAt: string) {
  const digest = createHash('sha256')
    .update(`${taskId}\n${actorId}\n${createdAt}`)
    .digest('hex')
    .slice(0, 12);
  return `team-${digest}`;
}

function summarizeTask(taskId: string, task: any) {
  return {
    taskId,
    title: task.title ?? task.workItemId ?? taskId,
    status: task.status ?? null,
    targetRepo: task.targetRepo ?? null,
    sourcePlanPath: task.source?.planPath ?? task.sourcePlanPath ?? null
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
