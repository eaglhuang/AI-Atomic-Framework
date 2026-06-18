import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CliError,
  makeResult,
  message,
  parseArgsForCommand,
  quoteCliValue,
  readJsonFile,
  writeJsonFile
} from './shared.ts';
import { getCommandSpec } from './command-specs.ts';
import { runTasks } from './tasks.ts';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.ts';
import { buildTeamKnowledgeSummary, runTeamKnowledge, type TeamKnowledgeSummary } from './team-knowledge.ts';
import { runTeamWave } from './team-wave.ts';
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
  summary: string;
  detail: string;
  role?: string;
  permission?: string;
  agentIds?: string[];
  paths?: string[];
  suggestedFix: string;
};

type PermissionLease = {
  permission: string;
  agentId: string;
  paths?: string[];
};

type TeamPermissionValidationOptions = {
  allowedWritePaths?: string[];
  repoRoot?: string;
};

type TeamCrewRole = {
  role: string;
  agentId: string;
  required: boolean;
  permissions: string[];
  description: string;
};

type TeamImplementerSelector = {
  schemaId: 'atm.teamImplementerSelector.v1';
  selectedImplementer: {
    agentId: string;
    role: string;
    profile?: string;
    language?: string;
    recipeId: string;
  };
  languageMatch: 'typescript' | 'python' | 'unknown';
  roleMatch: 'typescript-implementer' | 'python-implementer' | 'ui-implementer' | 'generic-implementer';
  fallbackReason: string;
  confidence: 'low' | 'medium' | 'high';
  deterministicHints: {
    scopePaths: string[];
    deliverables: string[];
    fileExtensions: string[];
    pathHints: string[];
    pythonHeavy: boolean;
    typescriptHeavy: boolean;
    uiPaths: boolean;
  };
};

type TeamPatrolMode = 'claim-preflight' | 'close-preflight' | 'big-script' | 'daily-noon';

type TeamPatrolFindingLevel = 'info' | 'warning' | 'blocker';

type TeamPatrolFinding = {
  level: TeamPatrolFindingLevel;
  code: string;
  category: 'runtime-mode' | 'artifact-gap' | 'retry-budget' | 'rework-state' | 'scope' | 'evidence';
  summary: string;
  suggestedCommand: string | null;
  details?: Record<string, unknown>;
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

const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'] as const;

const readOnlyTeamRoles = new Set([
  'atomizationPlanner',
  'scopeGuardian',
  'reader',
  'evidenceCollector',
  'validator'
]);

const writeTeamPermissions = new Set([
  'task.lifecycle',
  'git.write',
  'file.write',
  'evidence.write',
  'web.query',
  'web.download',
  'exec.mutating',
  'sandbox.write',
  'pipeline.write',
  'database.write',
  'ci.write'
]);

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
  'team.start-claim-gate-parity': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamClaimAdmissionFindings',
    capability: 'Team plan/start claim admission parity against normal task dependency gates.',
    downstreamTasks: ['TASK-TEAM-0029']
  },
  'team.captain-decision': {
    anchor: 'packages/cli/src/commands/team.ts#buildCaptainDecision',
    capability: 'Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.',
    downstreamTasks: ['TASK-TEAM-0007']
  },
  'team.implementer-selector': {
    anchor: 'packages/cli/src/commands/team.ts#selectTeamImplementer',
    capability: 'Deterministic implementer selector for Team Agents based on task paths, deliverables, language hints, and safe generic fallback.',
    downstreamTasks: ['TASK-TEAM-0010']
  },
  'team.start-runtime-state': {
    anchor: 'packages/cli/src/commands/team.ts#writeTeamRun',
    capability: 'Team run runtime record writer under .atm/runtime/team-runs.',
    downstreamTasks: ['TASK-TEAM-0011']
  },
  'team.status-runtime-read': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamStatusResult',
    capability: 'Read-only team run status surface.',
    downstreamTasks: ['TASK-TEAM-0011']
  },
  'team.patrol-report': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamPatrolReport',
    capability: 'Read-only patrol report for runtime mode, rework readiness, missing artifacts, and retry-budget risk.',
    downstreamTasks: ['TASK-TEAM-0014']
  },
  'team.permission-lease-validator': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Deterministic permission lease validation before team runtime start.',
    downstreamTasks: ['TASK-TEAM-0012']
  },
  'team.file-write-scope-validator': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Deterministic file.write lease scope validation against task allowed files before team runtime start.',
    downstreamTasks: ['TASK-TEAM-0013']
  },
  'team.next-recommendation': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamRecommendation',
    capability: 'Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands.',
    downstreamTasks: ['TASK-TEAM-0015']
  },
  'team.knowledge-build-query': {
    anchor: 'packages/cli/src/commands/team-knowledge.ts#runTeamKnowledge',
    capability: 'Advisory Team Agents knowledge build/query dry-run surface with metadata filtering and lexical ranking.',
    downstreamTasks: ['TASK-TEAM-0021']
  }
} as const;

export type TeamRecommendationChannel = 'fast' | 'normal' | 'batch';

export type TeamRecommendation = {
  readonly schemaId: 'atm.teamRecommendation.v1';
  readonly enabled: boolean;
  readonly required: false;
  readonly channel: TeamRecommendationChannel;
  readonly taskId: string;
  readonly recipeId: string;
  readonly reason: string;
  readonly plan: string;
  readonly start: string;
  readonly status: string;
  readonly validate: string;
  readonly constraints: readonly string[];
  readonly knowledgeSummary?: TeamKnowledgeSummary;
  readonly parallelAdvisory?: unknown;
};

export function resolveTeamRecipeIdForChannel(channel: TeamRecommendationChannel): string {
  if (channel === 'batch') {
    return 'atm.default.batch';
  }
  if (channel === 'fast') {
    return 'atm.default.fast';
  }
  return 'atm.default.normal.typescript';
}

export function defaultTeamRecommendationReason(channel: TeamRecommendationChannel): string {
  if (channel === 'batch') {
    return 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.';
  }
  if (channel === 'fast') {
    return 'Fast quickfix work usually stays single-actor; a team run is optional and advisory only.';
  }
  return 'This task can use an optional team run for role and permission coordination.';
}

export function buildTeamRecommendation(input: {
  readonly taskId: string | null | undefined;
  readonly actorId?: string;
  readonly channel: TeamRecommendationChannel;
  readonly reason?: string;
  readonly enabled?: boolean;
  readonly knowledgeSummary?: TeamKnowledgeSummary;
  readonly parallelAdvisory?: unknown;
}): TeamRecommendation | null {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  if (!taskId || input.enabled === false) {
    return null;
  }
  const actorId = input.actorId?.trim() || '<id>';
  const recipeId = resolveTeamRecipeIdForChannel(input.channel);
  const quotedTask = quoteCliValue(taskId);
  const reason = input.reason?.trim() || defaultTeamRecommendationReason(input.channel);
  return {
    schemaId: 'atm.teamRecommendation.v1',
    enabled: true,
    required: false,
    channel: input.channel,
    taskId,
    recipeId,
    reason,
    plan: `node atm.mjs team plan --task ${quotedTask} --recipe ${recipeId} --json`,
    validate: `node atm.mjs team validate --task ${quotedTask} --recipe ${recipeId} --json`,
    start: `node atm.mjs team start --task ${quotedTask} --actor ${actorId} --recipe ${recipeId} --json`,
    status: 'node atm.mjs team status --compact --json',
    ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
    ...(input.parallelAdvisory ? { parallelAdvisory: input.parallelAdvisory } : {}),
    constraints: [
      'Team start writes only .atm/runtime/team-runs/<teamRunId>.json.',
      'Team agents are not spawned by this recommendation.',
      'Coordinator remains the only task.lifecycle and git.write owner.'
    ]
  };
}

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
  if (String(argv[0] ?? '').toLowerCase() === 'knowledge') {
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
    return runTeamKnowledge(argv.slice(1), cwd);
  }

  const spec = getCommandSpec('team');
  const parsed = parseArgsForCommand(spec, argv);
  const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  if (action === 'wave') {
    // TASK-MAO-0024: Team Agents Wave Mode planning surface.
    return runTeamWave(parsed.positional.slice(1).map(String), cwd);
  }

  if (action === 'knowledge') {
    const knowledgeArgv = argv[0]?.toLowerCase() === 'knowledge' ? argv.slice(1) : parsed.positional.slice(1).map(String);
    return runTeamKnowledge(knowledgeArgv, cwd);
  }

  if (!['plan', 'start', 'status', 'validate', 'patrol'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate, patrol, wave, knowledge', { exitCode: 2 });
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

  if (action === 'patrol') {
    return buildTeamPatrolResult({
      cwd,
      taskId,
      mode: normalizeTeamPatrolMode(parsed.options.mode),
      requestedTeamRunId: String(parsed.options.team ?? '').trim()
    });
  }

  const context = await buildTeamPlanningContext({
    cwd,
    taskId,
    requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
    actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim()
  });
  const { task, recipes, recipe, validation, permissionValidation, teamPlan } = context;
  const ok = validation.findings.every((finding) => finding.level !== 'error');

  if (action === 'validate') {
    const permissionOk = permissionValidation.ok;
    const nonPermissionFindings = validation.findings.filter(
      (finding) => !permissionValidation.findings.includes(finding)
    );
    const safeToStart = validation.findings.every((finding) => finding.level !== 'error');
    return makeResult({
      ok: permissionOk,
      command: 'team',
      cwd,
      messages: [
        message(permissionOk ? 'info' : 'error', permissionOk ? 'ATM_TEAM_PERMISSION_VALID' : 'ATM_TEAM_PERMISSION_INVALID', permissionOk
          ? 'Team recipe and permission leases are valid.'
          : 'Team recipe or permission leases contain blocking findings.', {
          taskId,
          recipeId: recipe.recipeId,
          findingCount: permissionValidation.findings.length
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
        validation: permissionValidation,
        safeToStart,
        relatedFindings: nonPermissionFindings,
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

function readOptionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
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
  const writePaths = deriveWritePaths(task, input.cwd);
  const permissionValidation = validateTeamPermissionModel(recipe, writePaths, {
    allowedWritePaths: deriveAllowedWriteScope(task, input.cwd),
    repoRoot: input.cwd
  });

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
        if (finding && finding.verdict === 'blocked-cid-conflict') {
          parallelFindings.push(buildPermissionFinding({
            level: 'error',
            code: 'blocked-cid-conflict',
            detail: `Parallel advisor identified a CID logic conflict with task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}`,
            paths: finding.overlappingFiles
          }));
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
  const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
  const validation = mergeValidation(
    permissionValidation,
    { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings },
    { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings },
    { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings }
  );

  const finalTeamPlan = buildTeamPlan({
    task,
    recipe,
    writePaths,
    validation,
    brokerLane,
    knowledgeSummary: buildTeamKnowledgeSummary({
      cwd: input.cwd,
      taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
      top: 3
    })
  });

  return {
    task,
    recipes,
    recipe,
    permissionValidation,
    validation,
    teamPlan: {
      ...finalTeamPlan,
      validation,
      brokerLane
    }
  };
}

function buildTeamClaimAdmissionFindings(cwd: string, taskId: string, task: Record<string, unknown>): PermissionFinding[] {
  return findTaskClaimDependencyBlockers(cwd, taskId, task).map((blocker) => buildPermissionFinding({
    level: 'error',
    code: 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
    detail: `Team start is unsafe because normal task claim would be blocked by dependency ${blocker.taskId} (${blocker.status}).`,
    paths: [path.relative(cwd, blocker.taskPath).replace(/\\/g, '/')]
  }));
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

export function validateTeamPermissionModel(
  recipe: TeamRecipe,
  writePaths: string[],
  options: TeamPermissionValidationOptions = {}
) {
  const agentRoles = new Map(recipe.agents.map((agent) => [agent.agentId, agent.role]));
  return mergeValidation(
    validateTeamRecipe(recipe, agentRoles),
    validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths), agentRoles, options)
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
    findings: brokerLaneToFindings(brokerLaneResult).map((finding) => buildPermissionFinding({
      level: finding.level,
      code: finding.code,
      detail: finding.detail,
      paths: finding.paths
    })) satisfies PermissionFinding[]
  };
}

function buildPermissionFinding(input: {
  level: 'error' | 'warning';
  code: string;
  detail: string;
  permission?: string;
  agentIds?: string[];
  paths?: string[];
  role?: string;
}): PermissionFinding {
  return {
    level: input.level,
    code: input.code,
    summary: permissionFindingSummary(input),
    detail: input.detail,
    role: input.role,
    permission: input.permission,
    agentIds: input.agentIds,
    paths: input.paths,
    suggestedFix: permissionFindingSuggestedFix(input)
  };
}

function permissionFindingSummary(input: {
  code: string;
  detail: string;
  permission?: string;
  role?: string;
}): string {
  switch (input.code) {
    case 'ATM_TEAM_PERMISSION_UNKNOWN':
      return input.permission
        ? `Unknown permission ${input.permission}.`
        : 'Unknown team permission.';
    case 'ATM_TEAM_PERMISSION_CONFLICT':
      return input.permission
        ? `Exclusive permission ${input.permission} has multiple recipe owners.`
        : 'Exclusive permission has multiple recipe owners.';
    case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
      return input.permission
        ? `${input.permission} must stay with the coordinator.`
        : 'Coordinator-only permission has an invalid owner.';
    case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
      return input.role
        ? `Read-only role ${input.role} must not receive write permissions.`
        : 'Read-only role received a write permission.';
    case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
      return input.permission
        ? `${input.permission} requires explicit scoped paths.`
        : 'Scoped permission is missing lease paths.';
    case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
      return 'Write lease targets forbidden runtime paths.';
    case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
      return 'Write lease includes paths outside the task write scope.';
    case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
      return 'Write lease includes unsafe path traversal.';
    case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
      return input.permission
        ? `Exclusive permission lease ${input.permission} has multiple owners.`
        : 'Exclusive permission lease has multiple owners.';
    case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
      return 'Team start is blocked by task claim dependency gates.';
    default:
      return input.detail;
  }
}

function permissionFindingSuggestedFix(input: {
  code: string;
  permission?: string;
  role?: string;
  agentIds?: string[];
}): string {
  switch (input.code) {
    case 'ATM_TEAM_PERMISSION_UNKNOWN':
      return 'Remove the unknown permission or add it to the team permission catalog before team start.';
    case 'ATM_TEAM_PERMISSION_CONFLICT':
      return input.permission
        ? `Keep ${input.permission} on one role only and remove it from the other agent recipe entries.`
        : 'Assign each exclusive permission to exactly one agent in the recipe.';
    case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
      return input.permission
        ? `Grant ${input.permission} only to the coordinator agent and remove it from other roles.`
        : 'Move coordinator-only permissions back to the coordinator agent.';
    case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
      return input.role
        ? `Remove write permissions from ${input.role}; keep read-only roles on file.read or exec.validator only.`
        : 'Remove write permissions from read-only roles in the recipe.';
    case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
      return input.permission
        ? `Add explicit scoped paths to the ${input.permission} lease before team start.`
        : 'Provide scoped paths for permissions that require a lease boundary.';
    case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
      return 'Remove .atm/runtime/** paths from write leases; runtime state is managed by team start, not leased writes.';
    case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
      return 'Request a governed scope amendment or remove the path before team start.';
    case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
      return 'Use repository-relative paths without .. segments or absolute drive roots.';
    case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
      return input.permission
        ? `Rebuild suggested leases so only one agent owns ${input.permission}.`
        : 'Ensure each exclusive lease has a single owner before team start.';
    case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
      return 'Close, verify, or reopen the dependency through the normal task lifecycle, then rerun team plan/start.';
    default:
      return 'Review the recipe permissions and suggested leases, then rerun team validate.';
  }
}

function resolveFindingRole(agentRoles: Map<string, string>, agentIds?: string[]): string | undefined {
  const primaryAgentId = agentIds?.[0];
  if (!primaryAgentId) return undefined;
  return agentRoles.get(primaryAgentId);
}

function validateTeamRecipe(recipe: TeamRecipe, agentRoles: Map<string, string>) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const ownersByPermission = new Map<string, string[]>();
  const findings: PermissionFinding[] = [];

  for (const agent of recipe.agents) {
    for (const permission of agent.permissions) {
      if (!permissionDefinitions.has(permission)) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_PERMISSION_UNKNOWN',
          detail: `Unknown team permission: ${permission}`,
          permission,
          agentIds: [agent.agentId],
          role: agent.role
        }));
      }
      if (readOnlyTeamRoles.has(agent.role) && writeTeamPermissions.has(permission)) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN',
          detail: `Read-only role ${agent.role} must not receive write permission ${permission}.`,
          permission,
          agentIds: [agent.agentId],
          role: agent.role
        }));
      }
      ownersByPermission.set(permission, [...(ownersByPermission.get(permission) ?? []), agent.agentId]);
    }
  }

  for (const permission of teamPermissionCatalog.filter((entry) => entry.mode === 'exclusive')) {
    const owners = ownersByPermission.get(permission.id) ?? [];
    if (owners.length > 1) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_CONFLICT',
        detail: `Exclusive permission ${permission.id} has multiple owners.`,
        permission: permission.id,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator');
  for (const permission of coordinatorExclusivePermissions) {
    const owners = ownersByPermission.get(permission) ?? [];
    if (owners.length !== 1 || owners[0] !== coordinator?.agentId) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_UNIQUE_OWNER_REQUIRED',
        detail: `${permission} must have exactly one owner and it must be the coordinator.`,
        permission,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function validatePermissionLeases(
  leases: PermissionLease[],
  agentRoles: Map<string, string>,
  options: TeamPermissionValidationOptions = {}
) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const findings: PermissionFinding[] = [];
  const ownersByExclusivePermission = new Map<string, string[]>();
  const allowedWritePathSet = new Set((options.allowedWritePaths ?? []).map((entry) => normalizeTeamLeasePath(entry, options.repoRoot)).filter(Boolean));

  for (const lease of leases) {
    const definition = permissionDefinitions.get(lease.permission);
    const role = agentRoles.get(lease.agentId);
    if (!definition) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_UNKNOWN',
        detail: `Unknown team permission lease: ${lease.permission}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role
      }));
      continue;
    }
    if (definition.mode === 'exclusive') {
      ownersByExclusivePermission.set(lease.permission, [
        ...(ownersByExclusivePermission.get(lease.permission) ?? []),
        lease.agentId
      ]);
    }
    if (definition.scopeRequired && (!Array.isArray(lease.paths) || lease.paths.length === 0)) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED',
        detail: `${lease.permission} requires explicit scoped paths.`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role
      }));
    }
    const normalizedLeasePaths = (lease.paths ?? []).map((entry) => ({
      raw: entry,
      normalized: normalizeTeamLeasePath(entry, options.repoRoot)
    }));
    const unsafeTraversalPaths = normalizedLeasePaths
      .filter((entry) => isUnsafeTeamLeasePath(entry.raw, entry.normalized, options.repoRoot))
      .map((entry) => entry.raw);
    if (unsafeTraversalPaths.length > 0) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL',
        detail: `${lease.permission} cannot lease path traversal or absolute paths: ${unsafeTraversalPaths.join(', ')}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role,
        paths: unsafeTraversalPaths
      }));
    }
    const forbiddenRuntimePaths = normalizedLeasePaths
      .filter((entry) => entry.normalized.startsWith('.atm/runtime/') || entry.normalized === '.atm/runtime')
      .map((entry) => entry.raw);
    const forbiddenHistoryPaths = normalizedLeasePaths
      .filter((entry) => entry.normalized.startsWith('.atm/history/') || entry.normalized === '.atm/history')
      .map((entry) => entry.raw);
    const forbiddenWritePaths = uniqueStrings([...forbiddenRuntimePaths, ...forbiddenHistoryPaths]);
    if (forbiddenWritePaths.length > 0) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN',
        detail: `${lease.permission} cannot lease ATM managed runtime/history paths: ${forbiddenWritePaths.join(', ')}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role,
        paths: forbiddenWritePaths
      }));
    }
    if (lease.permission === 'file.write' && allowedWritePathSet.size > 0) {
      const outOfBoundsPaths = normalizedLeasePaths
        .filter((entry) => entry.normalized && !allowedWritePathSet.has(entry.normalized))
        .map((entry) => entry.raw);
      if (outOfBoundsPaths.length > 0) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS',
          detail: `file.write lease paths are outside task allowedFiles/deliverables: ${outOfBoundsPaths.join(', ')}`,
          permission: lease.permission,
          agentIds: [lease.agentId],
          role,
          paths: outOfBoundsPaths
        }));
      }
    }
  }

  return finalizeLeaseValidation(findings, ownersByExclusivePermission, agentRoles);
}

function finalizeLeaseValidation(
  findings: PermissionFinding[],
  ownersByExclusivePermission: Map<string, string[]>,
  agentRoles: Map<string, string>
) {
  for (const [permission, owners] of ownersByExclusivePermission.entries()) {
    if (new Set(owners).size > 1) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_LEASE_CONFLICT',
        detail: `Exclusive permission lease ${permission} has multiple owners.`,
        permission,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function normalizeTeamLeasePath(value: string, repoRoot?: string) {
  const raw = String(value).trim();
  const repoRelative = normalizeRepoAbsoluteLeasePath(raw, repoRoot);
  const normalized = path.posix.normalize((repoRelative ?? raw).replace(/\\/g, '/'));
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}

function normalizeRepoAbsoluteLeasePath(rawPath: string, repoRoot?: string) {
  if (!repoRoot) return null;
  const raw = String(rawPath).trim();
  const normalizedRaw = raw.replace(/\\/g, '/');
  if (!/^[A-Za-z]:\//.test(normalizedRaw) && !normalizedRaw.startsWith('/')) return null;

  const root = path.resolve(repoRoot);
  const candidate = path.resolve(raw);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '') return '';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

function isUnsafeTeamLeasePath(rawPath: string, normalizedPath: string, repoRoot?: string) {
  const raw = String(rawPath).trim().replace(/\\/g, '/');
  const repoRelative = normalizeRepoAbsoluteLeasePath(rawPath, repoRoot);
  const unsafeAbsolute = (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) && repoRelative === null;
  return unsafeAbsolute
    || raw === '..'
    || raw.startsWith('../')
    || raw.includes('/../')
    || normalizedPath === '..'
    || normalizedPath.startsWith('../');
}

function deriveAllowedWriteScope(task: any, repoRoot?: string) {
  const explicitAllowed = normalizeStringArray(task.targetAllowedFiles);
  if (explicitAllowed.length > 0) {
    return normalizeTaskWriteScope(explicitAllowed, repoRoot);
  }
  return normalizeTaskWriteScope([
    ...normalizeStringArray(task.deliverables),
    ...normalizeStringArray(task.scopePaths)
  ], repoRoot);
}

function normalizeTaskWriteScope(paths: string[], repoRoot?: string) {
  return uniqueStrings(paths.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter(Boolean));
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
  knowledgeSummary?: TeamKnowledgeSummary;
}) {
  const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
  const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
  const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
  const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector);
  return {
    schemaId: 'atm.teamPlan.v1',
    recipeId: input.recipe.recipeId,
    channelHint: 'normal',
    brokerLane: input.brokerLane,
    agents: input.recipe.agents,
    captainDecision,
    implementerSelector,
    ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
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
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>,
  implementerSelector: TeamImplementerSelector
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
    authorityChain: {
      broker: 'Broker verdicts override Coordinator decisions inside broker-governed conflict domains.',
      coordinator: 'Coordinator retains team-local lifecycle authority outside broker-governed conflict domains.'
    },
    conflictRules: [
      'If broker verdict is needs-steward, blocked-cid-conflict, blocked-shared-surface, or historical-delivery-required, Coordinator must stop claim / commit / close progression.',
      'If broker-prescribed routing exceeds task scope, closure authority, or task-card acceptance, Coordinator must escalate to Captain / human.',
      'Coordinator must not silently override broker verdicts inside broker-governed conflict domains.'
    ],
    teamSize: sizing.teamSize,
    requiredRoles: crewBriefingContract.requiredRoles.map((role) => role.role),
    optionalRoles: crewBriefingContract.optionalRoles.map((role) => role.role),
    reason: sizing.reason,
    confidence: sizing.confidence,
    implementerSelector,
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
      needLieutenant: lieutenantEscalation.needLieutenant,
      authorityChain: 'Broker overrides Coordinator inside broker-governed conflict domains; Coordinator remains local outside them.'
    }
  };
}

export function selectTeamImplementer(task: any, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector {
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

function collectImplementerHints(task: any, writePaths: string[]) {
  const scopePaths = uniqueStrings([
    ...normalizeStringArray(task?.scopePaths),
    ...normalizeStringArray(task?.targetAllowedFiles),
    ...writePaths
  ]);
  const deliverables = uniqueStrings(normalizeStringArray(task?.deliverables));
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
    roles: input.recipe.agents.map((agent) => ({
      agentId: agent.agentId,
      role: agent.role,
      profile: agent.profile ?? null,
      language: agent.language ?? null,
      permissions: agent.permissions
    })),
    agents: input.recipe.agents,
    leases: input.teamPlan.suggestedPermissionLeases,
    permissionLeases: input.teamPlan.suggestedPermissionLeases,
    validation: input.validation,
    brokerLane: input.teamPlan.brokerLane,
    captainDecision: input.teamPlan.captainDecision,
    agentReports: [],
    patrolFindings: [],
    evidenceCuratorSummary: null,
    teamSummary: {
      decision: input.teamPlan.captainDecision.reason,
      implementationSummary: 'Team runtime started; closure remains governed by command-backed evidence.',
      validators: normalizeStringArray(input.task.validators),
      evidence: [],
      risk: input.teamPlan.captainDecision.escalationRequired ? 'medium' : 'low',
      closeReady: false
    },
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
    : listTeamRuns(input.cwd).filter((run: any) => run.status === 'active');
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

export function buildTeamPatrolResult(input: {
  cwd: string;
  taskId: string;
  mode: TeamPatrolMode;
  requestedTeamRunId: string;
}) {
  const report = buildTeamPatrolReport(input);
  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message(report.safeToProceed ? 'info' : 'warning', report.safeToProceed ? 'ATM_TEAM_PATROL_READY' : 'ATM_TEAM_PATROL_FINDINGS', report.safeToProceed
        ? 'Team patrol completed with no blocking findings. No runtime or history state was written.'
        : 'Team patrol found follow-up items. No runtime or history state was written.', {
        taskId: input.taskId,
        mode: input.mode,
        severity: report.severity,
        findingCount: report.findings.length
      })
    ],
    evidence: report
  });
}

export function buildTeamPatrolReport(input: {
  cwd: string;
  taskId: string;
  mode: TeamPatrolMode;
  requestedTeamRunId: string;
}) {
  const findings: TeamPatrolFinding[] = [];
  const taskPath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
  const evidencePath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.json`);
  const closurePacketPath = path.join(input.cwd, '.atm', 'history', 'closure-packets', `${input.taskId}.json`);
  const taskExists = existsSync(taskPath);
  const evidenceExists = existsSync(evidencePath);
  const closurePacketExists = existsSync(closurePacketPath);
  const task = taskExists ? readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID') : null;
  const taskSummary = task ? summarizeTask(input.taskId, task) : { taskId: input.taskId, title: input.taskId, status: null, targetRepo: null, sourcePlanPath: null };
  const writePaths = task ? deriveWritePaths(task, input.cwd) : [];
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const teamRun = input.requestedTeamRunId ? readTeamRun(input.cwd, input.requestedTeamRunId) : findLatestTeamRunForTask(input.cwd, input.taskId);

  if (!taskExists) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_TASK_MISSING',
      category: 'artifact-gap',
      summary: `Task ledger is missing for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs next --task ${quoteCliValue(input.taskId)} --json`,
      details: { path: path.relative(input.cwd, taskPath).replace(/\\/g, '/') }
    }));
  }

  if (!evidenceExists) {
    findings.push(teamPatrolFinding({
      level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
      code: 'ATM_TEAM_PATROL_EVIDENCE_MISSING',
      category: 'evidence',
      summary: `Command-backed evidence file is not present for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs evidence run --task ${quoteCliValue(input.taskId)} --actor <actor> -- <validator-command>`,
      details: { path: path.relative(input.cwd, evidencePath).replace(/\\/g, '/') }
    }));
  }

  if (input.mode === 'close-preflight' && !closurePacketExists) {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_CLOSURE_PACKET_MISSING',
      category: 'artifact-gap',
      summary: `Closure packet has not been materialized for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
      details: { path: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/') }
    }));
  }

  if (!teamRun) {
    findings.push(teamPatrolFinding({
      level: 'info',
      code: 'ATM_TEAM_PATROL_NO_TEAM_RUN',
      category: 'runtime-mode',
      summary: 'No matching active team runtime record was found; patrol continues from ledger artifacts only.',
      suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`
    }));
  } else {
    findings.push(...buildTeamRunPatrolFindings(teamRun, input));
  }

  if (input.mode === 'big-script' || largeScriptRisk.level === 'high') {
    findings.push(teamPatrolFinding({
      level: largeScriptRisk.level === 'high' ? 'warning' : 'info',
      code: largeScriptRisk.level === 'high' ? 'ATM_TEAM_PATROL_LARGE_SCRIPT_RISK' : 'ATM_TEAM_PATROL_SCOPE_LOW_RISK',
      category: 'scope',
      summary: largeScriptRisk.level === 'high'
        ? 'Task write scope has large-script or hot-file risk and should receive extra review.'
        : 'Task write scope does not exceed the large-script threshold.',
      suggestedCommand: largeScriptRisk.level === 'high'
        ? `node atm.mjs team plan --task ${quoteCliValue(input.taskId)} --json`
        : null,
      details: { writePaths, largeScriptRisk }
    }));
  }

  const severity = summarizePatrolSeverity(findings);
  return {
    schemaId: 'atm.teamPatrolReport.v1',
    action: 'patrol',
    readOnly: true,
    runtimeWritten: false,
    historyWritten: false,
    agentsSpawned: false,
    mutations: [],
    taskId: input.taskId,
    runId: `patrol-${input.taskId}-${input.mode}`,
    patrolTeam: ['atomic-police', 'scope-guardian', 'evidence-auditor', 'runtime-sentinel'],
    mode: input.mode,
    severity,
    safeToProceed: severity !== 'blocker',
    findings,
    suggestedCommand: suggestedPatrolCommand(input.taskId, input.mode, severity),
    followUp: buildTeamPatrolFollowUp(input.taskId, input.mode, findings),
    task: taskSummary,
    inspected: {
      taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
      evidencePath: path.relative(input.cwd, evidencePath).replace(/\\/g, '/'),
      closurePacketPath: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/'),
      teamRunId: teamRun?.teamRunId ?? null,
      teamRunPath: teamRun?.teamRunId ? `.atm/runtime/team-runs/${teamRun.teamRunId}.json` : null,
      runtimeRoot: '.atm/runtime',
      historyRoot: '.atm/history'
    }
  };
}

function listTeamRuns(cwd: string) {
  const directory = teamRunsDirectory(cwd);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}

function findLatestTeamRunForTask(cwd: string, taskId: string) {
  const runs = listTeamRuns(cwd)
    .filter((run: any) => run.taskId === taskId)
    .sort((left: any, right: any) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')));
  return runs[0] ?? null;
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

function normalizeTeamPatrolMode(value: unknown): TeamPatrolMode {
  const mode = String(value ?? 'claim-preflight').trim();
  if (['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'].includes(mode)) {
    return mode as TeamPatrolMode;
  }
  throw new CliError('ATM_TEAM_PATROL_MODE_INVALID', `Unsupported team patrol mode: ${mode}`, {
    exitCode: 2,
    details: { supportedModes: ['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'] }
  });
}

function buildTeamRunPatrolFindings(teamRun: any, input: { taskId: string; mode: TeamPatrolMode }): TeamPatrolFinding[] {
  const findings: TeamPatrolFinding[] = [];
  if (teamRun.executionMode !== 'manual-team') {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_RUNTIME_MODE_UNEXPECTED',
      category: 'runtime-mode',
      summary: `Team run ${teamRun.teamRunId} is not in manual-team execution mode.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
      details: { executionMode: teamRun.executionMode ?? null }
    }));
  }
  if (teamRun.agentsSpawned === true) {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_AGENTS_SPAWNED',
      category: 'runtime-mode',
      summary: `Team run ${teamRun.teamRunId} reports spawned agents; coordinator should verify advisory role boundaries.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`
    }));
  }
  const remaining = extractRetryBudgetRemaining(teamRun);
  if (remaining !== null && remaining <= 0) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_RETRY_BUDGET_EXHAUSTED',
      category: 'retry-budget',
      summary: `Team run ${teamRun.teamRunId} has no retry budget remaining.`,
      suggestedCommand: `node atm.mjs team patrol --task ${quoteCliValue(input.taskId)} --mode close-preflight --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
      details: { retryBudgetRemaining: remaining }
    }));
  }
  const reworkStatus = String(teamRun.reworkRoute?.status ?? teamRun.reworkStatus ?? '').trim();
  if (['needs-rework', 'blocked', 'stale'].includes(reworkStatus)) {
    findings.push(teamPatrolFinding({
      level: reworkStatus === 'blocked' ? 'blocker' : 'warning',
      code: 'ATM_TEAM_PATROL_REWORK_ROUTE_ATTENTION',
      category: 'rework-state',
      summary: `Team run ${teamRun.teamRunId} rework route is ${reworkStatus}.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(teamRun.teamRunId))} --json`,
      details: { reworkStatus }
    }));
  }
  return findings;
}

function extractRetryBudgetRemaining(teamRun: any): number | null {
  const candidates = [
    teamRun.retryBudget?.remaining,
    teamRun.reworkRoute?.retryBudgetRemaining,
    teamRun.reworkRoute?.retryBudget?.remaining
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function teamPatrolFinding(input: TeamPatrolFinding): TeamPatrolFinding {
  return input;
}

function summarizePatrolSeverity(findings: TeamPatrolFinding[]): TeamPatrolFindingLevel {
  if (findings.some((finding) => finding.level === 'blocker')) return 'blocker';
  if (findings.some((finding) => finding.level === 'warning')) return 'warning';
  return 'info';
}

function suggestedPatrolCommand(taskId: string, mode: TeamPatrolMode, severity: TeamPatrolFindingLevel) {
  if (severity === 'blocker') {
    return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  if (mode === 'claim-preflight') {
    return `node atm.mjs next --claim --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  if (mode === 'close-preflight') {
    return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  return `node atm.mjs team patrol --task ${quoteCliValue(taskId)} --mode ${mode} --json`;
}

function buildTeamPatrolFollowUp(taskId: string, mode: TeamPatrolMode, findings: TeamPatrolFinding[]) {
  const commands = uniqueStrings(findings.map((finding) => finding.suggestedCommand).filter((entry): entry is string => Boolean(entry)));
  if (commands.length > 0) return commands;
  if (mode === 'close-preflight') {
    return [`node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`];
  }
  return [`node atm.mjs team plan --task ${quoteCliValue(taskId)} --json`];
}

function compactTeamRun(run: any) {
  return {
    teamRunId: run.teamRunId,
    taskId: run.taskId,
    recipeId: run.recipeId,
    actorId: run.actorId,
    status: run.status,
    roleCount: Array.isArray(run.roles) ? run.roles.length : Array.isArray(run.agents) ? run.agents.length : 0,
    leaseCount: Array.isArray(run.leases) ? run.leases.length : Array.isArray(run.permissionLeases) ? run.permissionLeases.length : 0,
    agentsSpawned: run.agentsSpawned === true,
    createdAt: run.createdAt ?? null,
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

function deriveWritePaths(task: any, repoRoot?: string) {
  const candidates = [
    ...normalizeStringArray(task.targetAllowedFiles),
    ...normalizeStringArray(task.deliverables),
    ...normalizeStringArray(task.scopePaths)
  ];
  return uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
    return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
  }));
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
