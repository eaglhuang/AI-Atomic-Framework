import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dir, '..', 'templates');
function readTemplate(name) {
    return readFileSync(path.join(templatesDir, name), 'utf8');
}
function sha256(input) {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}
/** Ordered list of templates managed by this pack. */
const entries = [
    { tmpl: 'atm-bootstrap.md.tmpl', dest: '.claude/commands/atm-bootstrap.md' },
    { tmpl: 'atm-lock.md.tmpl', dest: '.claude/commands/atm-lock.md' },
    { tmpl: 'atm-next.md.tmpl', dest: '.claude/commands/atm-next.md' },
    { tmpl: 'atm-evidence.md.tmpl', dest: '.claude/commands/atm-evidence.md' },
    { tmpl: 'atm-handoff.md.tmpl', dest: '.claude/commands/atm-handoff.md' },
    { tmpl: 'atm-verify.md.tmpl', dest: '.claude/commands/atm-verify.md' },
];
const targetFiles = entries.map(({ tmpl, dest }) => ({
    path: dest,
    template: readTemplate(tmpl),
    protected: false,
}));
/**
 * ATM Claude Code agent pack.
 *
 * Installs 6 governed slash commands under `.claude/commands/` that route
 * agent actions through deterministic ATM CLI calls.
 */
export const claudeCodePack = {
    packId: 'claude-code',
    name: 'Claude Code Agent Pack',
    version: '0.1.0',
    agentTarget: 'claude-code',
    targetFiles,
    sourceHash: sha256(targetFiles.map((f) => f.template).join('\0')),
};
