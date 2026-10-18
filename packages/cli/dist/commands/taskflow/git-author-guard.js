import { execFileSync } from 'node:child_process';
import { CliError } from '../shared.js';
import { resolveActorGitIdentityForCommit } from '../git-governance.js';
export const TASKFLOW_GIT_AUTHOR_MISSING = 'ATM_TASKFLOW_CLOSE_GIT_AUTHOR_MISSING';
function readGitConfigValue(cwd, key) {
    try {
        return execFileSync('git', ['config', '--get', key], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    }
    catch {
        return '';
    }
}
/** The author a taskflow commit will actually use: actor profile, then Git config, then env. */
export function inspectTaskflowGitAuthorGap(cwd, actorId) {
    const identity = actorId ? resolveActorGitIdentityForCommit(cwd, actorId) : null;
    const name = String(identity?.gitName || readGitConfigValue(cwd, 'user.name') || process.env.GIT_AUTHOR_NAME || '').trim();
    const email = String(identity?.gitEmail || readGitConfigValue(cwd, 'user.email') || process.env.GIT_AUTHOR_EMAIL || '').trim();
    if (name && email)
        return null;
    const commands = [
        name ? null : 'git config user.name "Your Name"',
        email ? null : 'git config user.email "you@example.com"'
    ].filter((command) => Boolean(command));
    const requiredCommand = commands.join(' && ');
    const missing = [name ? null : 'user.name', email ? null : 'user.email'].filter(Boolean).join(' and ');
    return {
        missingName: !name,
        missingEmail: !email,
        commands,
        requiredCommand,
        summary: `Git author is incomplete (${missing}). taskflow close cannot create the commit until you run: ${requiredCommand}`
    };
}
export function assertTaskflowGitAuthor(cwd, actorId) {
    const gap = inspectTaskflowGitAuthorGap(cwd, actorId);
    if (!gap)
        return;
    throw new CliError(TASKFLOW_GIT_AUTHOR_MISSING, gap.summary, {
        exitCode: 1,
        details: { requiredCommand: gap.requiredCommand, commands: gap.commands }
    });
}
