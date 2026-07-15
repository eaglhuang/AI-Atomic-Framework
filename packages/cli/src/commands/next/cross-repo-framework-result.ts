import { buildFirstUseUserNotice } from '../first-use-notice.ts';
import { createFrameworkModeStatus } from '../framework-development.ts';
import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { makeResult, message } from '../shared.ts';
import { buildNextMessages } from './playbook-projection.ts';
import type { NextActionLike } from './next-action-assembly.ts';
import type { ImportedTaskQueue } from './route-predicates.ts';
import { quoteCliValue } from './view-projections.ts';

export function buildCrossRepoFrameworkNextResult(input: {
  readonly cwd: string;
  readonly frameworkStatus: ReturnType<typeof createFrameworkModeStatus>;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
  readonly importedTaskQueue: ImportedTaskQueue | null;
}) {
  const targetRepo = input.frameworkStatus.targetRepo ?? '<target-repo>';
  const nextAction = {
    status: 'blocked',
    command: `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
    reason: 'the current task metadata points to ATM framework work; closure authority and hard gates must run in the target framework repository',
    frameworkMode: input.frameworkStatus.mode,
    targetRepo,
    closureAuthority: input.frameworkStatus.closureAuthority,
    allowedCommands: [
      `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
      `cd ${quoteCliValue(targetRepo)} ; node atm.mjs next --claim --actor <id> --json`
    ],
    blockedCommands: [
      'editing framework critical files while cwd is the planning repository',
      'closing framework target tasks from the planning repository'
    ]
  };
  const userNotice = buildFirstUseUserNotice(nextAction as Parameters<typeof buildFirstUseUserNotice>[0]);
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as NextActionLike,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'ATM framework work was detected from task metadata; switch to the target framework repo before mutating or closing work.', {
        targetRepo,
        closureAuthority: input.frameworkStatus.closureAuthority
      })
    ),
    evidence: {
      nextAction,
      frameworkStatus: input.frameworkStatus,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}
