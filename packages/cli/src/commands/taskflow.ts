import path from 'node:path';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { loadProfile } from './taskflow/profile-loader.ts';

export function runTaskflow(argv: string[] = []) {
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

  const write = !!parsed.options.write;

  if (write) {
    throw new CliError(
      'ATM_TASKFLOW_WRITE_MODE_NOT_SUPPORTED',
      'The write mode is not supported for taskflow in this version. ATM taskflow acts as an orchestrator only and does not write to task card, ledger, or shard files.',
      { exitCode: 1 }
    );
  }

  let profileData: any = null;
  const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;

  if (profilePath) {
    profileData = loadProfile(profilePath);
  }

  const taskId = profileData ? `${profileData.taskIdPrefix}-0001` : 'TASK-ADOPTER-0001';
  const targetRepo = profileData ? profileData.ownerRepo : 'adopter-repo';

  // 實作 dry-run 骨架
  const result = makeResult({
    ok: true,
    command: 'taskflow open',
    cwd,
    mode: 'dry-run',
    messages: [
      message(
        'info',
        'ATM_TASKFLOW_OPEN_DRY_RUN_SKELETON_READY',
        profileData
          ? `Taskflow open dry-run with profile "${profileData.name}" is ready. Write mode is not supported by design.`
          : 'Taskflow open dry-run skeleton is ready. Write mode is not supported by design.',
        { cwd }
      )
    ],
    evidence: {
      wouldCreate: false,
      wouldValidate: true,
      wouldDelegate: true,
      profileRepoLabel: profileData ? profileData.repoLabel : 'adopter-repo',
      taskIdPrefix: profileData ? profileData.taskIdPrefix : 'TASK-ADOPTER',
      templateHint: profileData ? (profileData.template.defaultMarkdown ? 'defaultMarkdown' : 'none') : 'none',
      delegationDisplayHint: profileData ? (profileData.delegationDisplayHint ?? profileData.delegation.hint) : 'repo-profile task compiler / task-card-opener.js',
      taskPlanReport: {
        profileRepoLabel: profileData ? profileData.repoLabel : 'adopter-repo',
        taskIdPrefix: profileData ? profileData.taskIdPrefix : 'TASK-ADOPTER',
        templateHint: profileData ? (profileData.template.defaultMarkdown ? 'defaultMarkdown' : 'none') : 'none',
        delegationDisplayHint: profileData ? (profileData.delegationDisplayHint ?? profileData.delegation.hint) : 'repo-profile task compiler / task-card-opener.js',
        delegation: profileData ? {
          hint: profileData.delegation.hint,
          openerPath: profileData.delegation.openerPath,
          writerInvocation: profileData.delegation.writerInvocation ? {
            describeOnly: true,
            displayHint: profileData.delegation.writerInvocation.displayHint
          } : null
        } : null,
        wouldCreate: false,
        wouldValidate: true,
        wouldDelegate: true
      },
      wouldDo: [
        {
          workItemId: taskId,
          action: 'create-dry-run',
          status: 'planned',
          targetRepo: targetRepo
        }
      ],
      diagnostics: profileData ? [
        `Loaded profile: ${profileData.name}`,
        `Capabilities: supportsDryRun=${profileData.capabilities.supportsDryRun}, supportsWrite=${profileData.capabilities.supportsWrite}`,
        `Delegation: ${profileData.delegation.hint}`,
        `TaskId format: ${profileData.taskId.format}`,
        `Default markdown template available`
      ] : [
        'This is a read-only orchestrator dry-run skeleton.',
        'No physical task cards, ledger records, or json shards will be created or modified by this command.'
      ],
      decision: profileData ? {
        reason: `Delegated to opener defined in profile "${profileData.name}": ${profileData.delegation.hint}`,
        delegatedTo: profileData.delegation.openerPath ?? 'repo-profile task compiler / task-card-opener.js',
        displayHint: profileData.delegation.writerInvocation?.displayHint ?? 'repo-profile task compiler / task-card-opener.js'
      } : {
        reason: 'All task ledger mutations remain delegated to the repo-profile specified task opener and compiler.',
        delegatedTo: 'repo-profile task compiler / task-card-opener.js'
      },
      ...(profileData ? { profile: profileData } : {})
    }
  });

  return {
    ...result,
    schemaId: 'atm.taskflowOpenResult.v1',
    writeEnabled: false
  };
}
