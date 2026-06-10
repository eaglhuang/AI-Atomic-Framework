import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCommandSpec } from './command-specs.ts';
import { generateTaskCard, runTasks, runTasksRosterUpdate } from './tasks.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import {
  buildDelegationContract,
  buildTaskflowOpenDiagnostics,
  loadProfile,
  resolveOpenerMode,
  resolveWriteSupport,
  type TaskflowProfileV1
} from './taskflow/profile-loader.ts';
import {
  canResolveHostOpenerPolicy,
  resolveHostOpenerPolicyDecision
} from './taskflow/host-opener-policy.ts';

function buildTasksNewCommand(input: {
  taskId?: string | null;
  outputPath?: string | null;
  template?: string | null;
  title?: string | null;
}): string {
  const parts = ['node atm.mjs tasks new'];
  if (input.template) {
    parts.push(`--template ${input.template}`);
  }
  if (input.taskId) {
    parts.push(`--task-id ${input.taskId}`);
  }
  if (input.title) {
    parts.push(`--title ${JSON.stringify(input.title)}`);
  }
  if (input.outputPath) {
    parts.push(`--output ${input.outputPath}`);
  }
  return parts.join(' ');
}

function buildRosterSyncCommand(input: {
  indexPath: string;
  fromPath: string;
  dryRun?: boolean;
}): string {
  const parts = ['node atm.mjs tasks roster update', `--index ${input.indexPath}`, `--from ${input.fromPath}`];
  if (input.dryRun) {
    parts.push('--dry-run');
  }
  parts.push('--json');
  return parts.join(' ');
}

function buildTasksImportCommand(input: {
  fromPath: string;
}): string {
  return `node atm.mjs tasks import --from ${input.fromPath} --write --json`;
}

function buildOrchestrationPlan(input: {
  profile: TaskflowProfileV1 | null;
  openerMode: ReturnType<typeof resolveOpenerMode>;
  delegationContract: ReturnType<typeof buildDelegationContract>;
  taskId?: string | null;
  outputPath?: string | null;
  template?: string | null;
  title?: string | null;
  rosterIndexPath?: string | null;
  hostPolicyDecision?: ReturnType<typeof resolveHostOpenerPolicyDecision> | null;
}) {
  const resolvedTaskId = input.hostPolicyDecision?.taskId ?? input.taskId ?? null;
  const resolvedOutputPath = input.hostPolicyDecision?.outputPath ?? input.outputPath ?? null;
  const followUpSteps: string[] = ['generate-via-tasks-new'];
  if (input.delegationContract.hostOpenerAvailable) {
    followUpSteps.unshift('resolve-delegation');
  }
  if (input.hostPolicyDecision?.sources.taskId === 'host-policy') {
    followUpSteps.push('allocate-task-id-via-host-policy');
  }
  if (input.hostPolicyDecision?.sources.outputPath === 'host-policy') {
    followUpSteps.push('resolve-output-path-via-host-policy');
  }
  if (input.openerMode === 'template-only-fallback') {
    followUpSteps.push('operator-supply-task-id-and-output');
  }
  if (resolvedOutputPath) {
    followUpSteps.push('import-into-runtime');
  }

  const rosterSyncPolicy = input.delegationContract.policy.rosterSyncPolicy;
  const rosterIndexPath = input.rosterIndexPath ?? input.delegationContract.policy.rosterSync.indexPath;
  let rosterFollowUpCommand: string | null = null;
  if (rosterSyncPolicy === 'follow-up-command' && rosterIndexPath && resolvedOutputPath) {
    rosterFollowUpCommand = buildRosterSyncCommand({
      indexPath: rosterIndexPath,
      fromPath: resolvedOutputPath
    });
    followUpSteps.push('roster-sync-follow-up-command');
  } else if (rosterSyncPolicy === 'inline' && rosterIndexPath && resolvedOutputPath) {
    followUpSteps.push('roster-sync-inline');
  }

  return {
    generationSurface: 'tasks-new' as const,
    wouldInvokeTasksNew: true,
    wouldInvokeTasksImport: Boolean(resolvedOutputPath),
    tasksNewCommand: buildTasksNewCommand({
      taskId: resolvedTaskId,
      outputPath: resolvedOutputPath,
      template: input.template,
      title: input.title
    }),
    tasksImportCommand: resolvedOutputPath
      ? buildTasksImportCommand({ fromPath: resolvedOutputPath })
      : null,
    hostOpenerInvocation: input.delegationContract.displayHint,
    rosterSyncPolicy,
    rosterIndexPath,
    rosterFollowUpCommand,
    followUpRequired: input.openerMode === 'template-only-fallback'
      || !resolvedTaskId
      || !resolvedOutputPath
      || (rosterSyncPolicy === 'follow-up-command' && Boolean(rosterFollowUpCommand)),
    followUpSteps,
    targetRepo: input.profile?.ownerRepo ?? 'adopter-repo',
    profileRepoLabel: input.profile?.repoLabel ?? 'adopter-repo',
    policyDecision: {
      allocateTaskId: input.delegationContract.policy.allocateTaskId,
      resolveCanonicalOutputPath: input.delegationContract.policy.resolveCanonicalOutputPath,
      rosterSyncPolicy,
      rosterSyncIndexPath: rosterIndexPath,
      fallbackBehavior: input.delegationContract.policy.fallbackBehavior
    },
    hostPolicyDecision: input.hostPolicyDecision ?? null
  };
}

export async function runTaskflow(argv: string[] = []) {
  const spec = getCommandSpec('taskflow');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for taskflow.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  const action = parsed.positional[0];
  if (action !== 'open') {
    throw new CliError('ATM_CLI_USAGE', `Unknown taskflow action: ${action}. Only "open" is supported.`, { exitCode: 2 });
  }

  const writeRequested = !!parsed.options.write;
  const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
  const taskId = parsed.options.taskId ? String(parsed.options.taskId) : null;
  const outputPath = parsed.options.output ? String(parsed.options.output) : null;
  const rosterIndexPath = parsed.options.rosterIndex ? String(parsed.options.rosterIndex) : null;
  const template = parsed.options.template ? String(parsed.options.template) : 'aao-l2-split';
  const title = parsed.options.title ? String(parsed.options.title) : 'New Task';

  let profileData: TaskflowProfileV1 | null = null;
  if (profilePath) {
    profileData = loadProfile(profilePath);
  }

  const prerequisiteInput = {
    profile: profileData,
    taskIdSupplied: taskId !== null,
    outputPathSupplied: outputPath !== null,
    writeRequested
  };

  const delegationContract = buildDelegationContract(profileData);
  const openerMode = resolveOpenerMode(prerequisiteInput);
  const writeSupport = resolveWriteSupport(prerequisiteInput);
  const diagnostics = buildTaskflowOpenDiagnostics(prerequisiteInput);

  let hostPolicyDecision: ReturnType<typeof resolveHostOpenerPolicyDecision> | null = null;
  if (profileData && canResolveHostOpenerPolicy({
    cwd,
    profile: profileData,
    delegationContract,
    taskId,
    outputPath
  })) {
    try {
      hostPolicyDecision = resolveHostOpenerPolicyDecision({
        cwd,
        profile: profileData,
        delegationContract,
        taskId,
        outputPath
      });
      diagnostics.messages.push(...hostPolicyDecision.diagnostics);
    } catch (error) {
      if (writeRequested || taskId || outputPath) {
        throw error;
      }
    }
  }

  const orchestrationPlan = buildOrchestrationPlan({
    profile: profileData,
    openerMode,
    delegationContract,
    taskId: hostPolicyDecision?.taskId ?? taskId,
    outputPath: hostPolicyDecision?.outputPath ?? outputPath,
    template,
    title,
    rosterIndexPath,
    hostPolicyDecision
  });

  if (writeRequested && !writeSupport.allowed) {
    throw new CliError(
      'ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK',
      openerMode === 'template-only-fallback'
        ? 'taskflow open --write is not available in template-only-fallback mode. Load an invocable host opener profile or use tasks new for explicit template generation.'
        : 'taskflow open --write prerequisites are incomplete. Supply --task-id/--output or configure host-opener numbering and output-path policy.',
      {
        exitCode: 1,
        details: {
          openerMode,
          writeSupport,
          delegationContract,
          diagnostics,
          orchestrationPlan,
          recommendedCommand: buildTasksNewCommand({
            taskId: hostPolicyDecision?.taskId ?? taskId,
            outputPath: hostPolicyDecision?.outputPath ?? outputPath,
            template,
            title
          })
        }
      }
    );
  }

  if (writeRequested && writeSupport.allowed) {
    if (!profileData) {
      throw new CliError('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK', 'taskflow open --write requires a governed profile.', { exitCode: 1 });
    }

    const resolved = hostPolicyDecision ?? resolveHostOpenerPolicyDecision({
      cwd,
      profile: profileData,
      delegationContract,
      taskId,
      outputPath
    });

    const generated = await generateTaskCard({
      cwd,
      templateKey: template,
      taskId: resolved.taskId,
      title,
      outputPath: resolved.outputPath
    });

    const targetAbsolute = path.resolve(cwd, resolved.outputPath);
    const hadExistingTarget = existsSync(targetAbsolute);
    const previousTargetContent = hadExistingTarget ? readFileSync(targetAbsolute, 'utf8') : null;
    mkdirSync(path.dirname(targetAbsolute), { recursive: true });
    writeFileSync(targetAbsolute, generated.content, 'utf8');

    let runtimeImport: Record<string, unknown> | null = null;
    try {
      const runtimeImportResult = await runTasks([
        'import',
        '--cwd', cwd,
        '--from', resolved.outputPath,
        '--write'
      ]);
      runtimeImport = {
        command: buildTasksImportCommand({ fromPath: resolved.outputPath }),
        result: runtimeImportResult
      };
    } catch (error) {
      if (hadExistingTarget && previousTargetContent !== null) {
        writeFileSync(targetAbsolute, previousTargetContent, 'utf8');
      } else if (existsSync(targetAbsolute)) {
        rmSync(targetAbsolute, { force: true });
      }
      throw error;
    }

    const effectiveRosterIndex = rosterIndexPath ?? delegationContract.policy.rosterSync.indexPath;
    let rosterSync: Record<string, unknown> | null = null;
    if (delegationContract.policy.rosterSyncPolicy === 'inline' && effectiveRosterIndex) {
      const rosterResult = await runTasksRosterUpdate([
        '--cwd', cwd,
        '--index', effectiveRosterIndex,
        '--from', resolved.outputPath
      ]);
      rosterSync = {
        mode: 'inline',
        command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath }),
        result: rosterResult
      };
    } else if (delegationContract.policy.rosterSyncPolicy === 'follow-up-command' && effectiveRosterIndex) {
      rosterSync = {
        mode: 'follow-up-command',
        command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath })
      };
    }

    return {
      ...makeResult({
        ok: true,
        command: 'taskflow open',
        cwd,
        mode: 'write',
        messages: [
          message(
            'info',
            'ATM_TASKFLOW_OPEN_WRITE_ORCHESTRATED',
            `taskflow open orchestrated tasks new generation at ${resolved.outputPath}.`,
            { openerMode, generationSurface: 'tasks-new', runtimeImported: true }
          )
        ],
        evidence: {
          openerMode,
          writeSupport,
          delegationContract,
          diagnostics,
          orchestrationPlan,
          hostPolicyDecision: resolved,
          generation: {
            surface: 'tasks-new',
            taskId: generated.taskId,
            sourcePath: generated.sourcePath,
            templateUsed: generated.templateUsed
          },
          runtimeImport,
          rosterSync,
          ...(profileData ? { profile: profileData } : {})
        }
      }),
      schemaId: 'atm.taskflowOpenResult.v1',
      writeEnabled: true
    };
  }

  const result = makeResult({
    ok: true,
    command: 'taskflow open',
    cwd,
    mode: 'dry-run',
    messages: [
      message(
        openerMode === 'delegated-governed' ? 'info' : 'warn',
        openerMode === 'delegated-governed'
          ? 'ATM_TASKFLOW_OPEN_ORCHESTRATION_READY'
          : 'ATM_TASKFLOW_OPEN_TEMPLATE_ONLY_FALLBACK',
        openerMode === 'delegated-governed'
          ? 'taskflow open dry-run orchestration plan is ready for delegated governed entry.'
          : 'taskflow open is in template-only-fallback mode. tasks new remains the explicit low-level generator.',
        { cwd, openerMode }
      )
    ],
    evidence: {
      openerMode,
      writeSupport,
      delegationContract,
      diagnostics,
      orchestrationPlan,
      hostPolicyDecision,
      fallbackBehavior: delegationContract.policy.fallbackBehavior,
      ...(profileData ? { profile: profileData } : {})
    }
  });

  return {
    ...result,
    schemaId: 'atm.taskflowOpenResult.v1',
    writeEnabled: false
  };
}
