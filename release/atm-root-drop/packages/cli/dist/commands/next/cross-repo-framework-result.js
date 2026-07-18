import { buildFirstUseUserNotice } from '../first-use-notice.js';
import { makeResult, message } from '../shared.js';
import { buildNextMessages } from './playbook-projection.js';
import { quoteCliValue } from './view-projections.js';
export function buildCrossRepoFrameworkNextResult(input) {
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
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, userNotice, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'ATM framework work was detected from task metadata; switch to the target framework repo before mutating or closing work.', {
            targetRepo,
            closureAuthority: input.frameworkStatus.closureAuthority
        })),
        evidence: {
            nextAction,
            frameworkStatus: input.frameworkStatus,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
