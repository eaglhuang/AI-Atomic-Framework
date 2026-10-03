import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
export const supportedAgentIds = ['claude-code', 'codex', 'copilot', 'cursor', 'gemini', 'antigravity'];
/** Metadata-only configuration discovery, NOT proof of installation/login.
 * Caller must snapshot before any installer writes. Never execute a CLI or read
 * configuration contents. No CLI-availability claim is made from these signals.
 * Sources (verified 2026-10-03):
 * https://code.claude.com/docs/en/settings
 * https://learn.chatgpt.com/docs/config-file/config-basic
 * https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
 * https://prod.cursor.com/help/customization/rules
 * https://geminicli.com/docs/reference/configuration/
 * https://geminicli.com/docs/cli/custom-commands/
 * https://www.antigravity.google/docs/hooks
 * Home-relative paths use OS home on Windows/macOS/Linux; no guessed AppData
 * paths. Generic .github/.agents/.gemini and GEMINI.md are not vendor proof.
 */
export function detectInstalledAgents(options) {
    const warnings = [];
    const evidence = new Map();
    const env = options.env ?? process.env;
    const home = options.homeDir ?? homedir();
    // platform is accepted for caller consistency; filesystem paths intentionally
    // use the running OS implementation, never emulate Windows paths on POSIX.
    void options.platform;
    const editor = env.ATM_EDITOR_ID?.trim();
    if (editor && supportedAgentIds.includes(editor)) {
        evidence.set(editor, [{ kind: 'environment', name: 'ATM_EDITOR_ID' }]);
    }
    // Exact canonical IDs only: model/actor names and substrings are not editor hints.
    function probe(id, kind, candidate, type) {
        try {
            const stat = lstatSync(candidate);
            if (stat.isSymbolicLink()) {
                warnings.push(`Skipped symbolic link detection path: ${candidate}`);
                return;
            }
            if (!(type === 'directory' ? stat.isDirectory() : stat.isFile()))
                return;
            const list = evidence.get(id) ?? [];
            if (!list.some(item => item.kind === kind && 'path' in item && item.path === candidate))
                list.push({ kind, path: candidate });
            evidence.set(id, list);
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR')
                warnings.push(`Cannot inspect detection path ${candidate}: ${code ?? 'UNKNOWN'}`);
        }
    }
    function homeRoot(id, standard, override) {
        probe(id, 'home-config', path.join(home, standard), 'directory');
        const value = override ? env[override] : undefined;
        if (!value?.trim())
            return;
        if (!path.isAbsolute(value)) {
            warnings.push(`Ignored relative ${override} detection path`);
            return;
        }
        probe(id, 'home-config', path.normalize(value), 'directory');
    }
    homeRoot('claude-code', '.claude', 'CLAUDE_CONFIG_DIR');
    homeRoot('codex', '.codex', 'CODEX_HOME');
    homeRoot('copilot', '.copilot', 'COPILOT_HOME');
    homeRoot('cursor', '.cursor');
    probe('gemini', 'home-config', path.join(home, '.gemini', 'settings.json'), 'file');
    probe('gemini', 'home-config', path.join(home, '.gemini', 'commands'), 'directory');
    // GEMINI_CLI_HOME replaces the parent HOME, not the .gemini directory.
    const geminiHome = env.GEMINI_CLI_HOME;
    if (geminiHome?.trim()) {
        if (!path.isAbsolute(geminiHome)) {
            warnings.push('Ignored relative GEMINI_CLI_HOME detection path');
        }
        else {
            probe('gemini', 'home-config', path.join(geminiHome, '.gemini', 'settings.json'), 'file');
            probe('gemini', 'home-config', path.join(geminiHome, '.gemini', 'commands'), 'directory');
        }
    }
    for (const product of ['antigravity', 'antigravity-ide', 'antigravity-cli']) {
        probe('antigravity', 'home-config', path.join(home, '.gemini', product), 'directory');
    }
    const entries = [
        ['claude-code', '.claude/skills', 'directory'],
        ['claude-code', '.claude/settings.json', 'file'],
        ['codex', '.codex/config.toml', 'file'],
        ['codex', 'integrations/codex-skills/atm-governance-router/SKILL.md', 'file'],
        ['copilot', '.github/copilot-instructions.md', 'file'],
        ['copilot', '.github/instructions/atm-governance-router.instructions.md', 'file'],
        ['cursor', '.cursor/rules', 'directory'],
        ['gemini', '.gemini/commands', 'directory'],
        ['gemini', '.gemini/settings.json', 'file'],
    ];
    // Antigravity's GEMINI.md + .agents/skills are shared conventions, so no
    // project-only Antigravity inference. Explicit selection remains available.
    for (const [id, relative, type] of entries)
        probe(id, 'project-entry', path.join(options.repositoryRoot, relative), type);
    return {
        adapters: supportedAgentIds.flatMap(id => evidence.has(id) ? [{ id, evidence: evidence.get(id) }] : []),
        warnings: [...new Set(warnings)],
    };
}
