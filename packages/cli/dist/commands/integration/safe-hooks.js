import { existsSync, readFileSync } from 'node:fs';
import { losslessUtf8, safeInstallPath } from '../../_vendor/integrations-core/dist/manifest/safe-install.js';
import { CliError } from '../shared.js';
/** Preflight the existing hook installer without accepting malformed settings. */
export async function safeIntegrationHooks(cwd, id, dryRun) {
    if (id !== 'claude-code' && id !== 'copilot')
        return null;
    const relative = id === 'claude-code' ? '.claude/settings.json' : '.github/hooks/atm-framework-development.json';
    const file = safeInstallPath(cwd, relative);
    let existing = null;
    if (existsSync(file)) {
        const parsed = JSON.parse(losslessUtf8(readFileSync(file)));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new CliError('ATM_INTEGRATION_MERGE_CONFLICT', `Preserve invalid hook settings: ${relative}`);
        existing = parsed;
    }
    if (id === 'copilot' && existing) {
        const hooks = Array.isArray(existing.hooks) ? existing.hooks : [];
        const expected = [
            ['sessionStart', 'node atm.mjs integration hook pre-agent --editor copilot --json'],
            ['userPromptSubmitted', 'node atm.mjs integration hook pre-agent --editor copilot --json'],
            ['preToolUse', 'node atm.mjs integration hook pre-tool --editor copilot --json']
        ];
        if (!expected.every(([event, command]) => hooks.some(hook => hook?.event === event && hook.command === command))) {
            throw new CliError('ATM_INTEGRATION_MERGE_CONFLICT', `Preserve existing Copilot hook file; required ATM entries differ: ${relative}`);
        }
        // Existing custom hooks/keys remain byte-for-byte intact. Never call the
        // legacy whole-file Copilot writer on an existing compatible document.
        return { ok: true, dryRun, preserved: true, writtenFiles: [] };
    }
    if (id === 'claude-code' && existing?.hooks !== undefined) {
        const hooks = existing.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))
            throw new CliError('ATM_INTEGRATION_MERGE_CONFLICT', 'Preserve non-object Claude hooks.');
        const required = {
            UserPromptSubmit: 'node atm.mjs integration hook pre-agent --editor claude-code --json',
            PreToolUse: 'node atm.mjs integration hook pre-tool --editor claude-code --json',
            Stop: 'node atm.mjs tasks audit --json'
        };
        for (const [key, command] of Object.entries(required)) {
            const entries = hooks[key];
            if (entries !== undefined && !Array.isArray(entries))
                throw new CliError('ATM_INTEGRATION_MERGE_CONFLICT', `Preserve non-array Claude hook: ${key}`);
            const exact = Array.isArray(entries) && entries.some((entry) => {
                if (!entry || typeof entry !== 'object')
                    return false;
                const value = entry;
                return (value.matcher === '*' || value.matcher === undefined || value.matcher === '')
                    && Array.isArray(value.hooks) && value.hooks.some(hook => hook?.type === 'command' && hook.command === command);
            });
            if (entries !== undefined && JSON.stringify(entries).includes(command) && !exact) {
                throw new CliError('ATM_INTEGRATION_MERGE_CONFLICT', `Preserve conflicting Claude ${key} hook: the ATM command is present only as a substring or restricted matcher.`);
            }
        }
    }
    const module = await import('../integration-hooks.js');
    return module.installEditorIntegrationHooks(cwd, id, { dryRun });
}
