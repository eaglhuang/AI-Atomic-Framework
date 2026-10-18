import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const rootAgentsEntryStart = '<!-- ATM ROOT ENTRY:START -->';
const rootAgentsEntryEnd = '<!-- ATM ROOT ENTRY:END -->';
const rootReadmeEntryStart = '<!-- ATM README ENTRY:START -->';
const rootReadmeEntryEnd = '<!-- ATM README ENTRY:END -->';
function relativePathFrom(basePath, absolutePath) {
    return path.relative(basePath, absolutePath).replace(/\\/g, '/');
}
export function createAgentsRootEntryBlock(tokens) {
    return [
        rootAgentsEntryStart,
        '',
        '## ATM Governance Entry',
        '',
        'Read the repository root README.md for project context, then run:',
        '',
        '```bash',
        'node atm.mjs next --prompt "<current user prompt>" --json',
        '```',
        '',
        'First-contact behavior:',
        '',
        '1. For user-requested task work, run `node atm.mjs next --prompt "<current user prompt>" --json`; use `node atm.mjs next --json` only as read-only orientation when no user prompt is available.',
        '2. If the ATM result returns an `ATM_USER_NOTICE` message or `evidence.userNotice`, show that notice to the user in natural language before running the returned next action.',
        '3. If existing host instructions reference a missing local document, mention the missing file once and continue with the ATM route.',
        '4. After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.',
        '',
        'Editor integration self-check:',
        '',
        '1. If `.atm/config.json` exists, confirm this editor already has its repo-local ATM entry files before trusting ATM skill routing.',
        '2. If the current editor entry file is missing, install the matching adapter immediately with `node atm.mjs integration add <editor-id> --json`, then verify it with `node atm.mjs integration verify <editor-id> --json`.',
        '3. Expected primary entry files:',
        '   - `codex`: `integrations/codex-skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add codex --json`',
        '   - `claude-code`: `.claude/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add claude-code --json`',
        '   - `cursor`: `.cursor/rules/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add cursor --json`',
        '   - `copilot`: `.github/instructions/atm-governance-router.instructions.md` via `node atm.mjs integration add copilot --json`',
        '   - `gemini`: `.gemini/commands/atm-governance-router.toml` via `node atm.mjs integration add gemini --json`',
        '   - `antigravity`: `GEMINI.md` via `node atm.mjs integration add antigravity --json`',
        '4. Google-side coverage has two entry shapes: `gemini` installs Gemini CLI command files under `.gemini/commands`, while `antigravity` installs the Antigravity editor entry `GEMINI.md` and `.agents/skills`. If the current Google editor is Antigravity, verify/install `antigravity`, not only `gemini`.',
        '',
        'Python-only runtime self-check:',
        '',
        '1. If the project probe reports Python without JavaScript or TypeScript, candidate ranking and source inventory can continue, but atom birth/apply must not be described as ready until a Python runtime/language adapter or plugin has been selected.',
        '2. If this ATM release does not bundle a dedicated Python language adapter/plugin, say that explicitly. Treat it as an expected product gap, not as host-repo corruption.',
        '3. In that case, continue with ATM discovery routes such as candidate ranking, source inventory, police evidence, or docs-first work, and tell the user that Python atom birth/apply remains deferred until a Python adapter/plugin is installed or implemented.',
        '',
        'Treat these ATM runtime files as supporting state only:',
        '',
        `- ${tokens.BOOTSTRAP_TASK_PATH}`,
        `- ${tokens.BOOTSTRAP_PROFILE_PATH}`,
        `- ${tokens.BOOTSTRAP_EVIDENCE_PATH}`,
        '',
        rootAgentsEntryEnd
    ].join('\n');
}
export function createReadmeRootEntryBlock() {
    return [
        rootReadmeEntryStart,
        '',
        '## AI Agent Entry',
        '',
        'After reading this repository overview, run:',
        '',
        '```bash',
        'node atm.mjs next --prompt "<current user prompt>" --json',
        '```',
        '',
        'Use `node atm.mjs next --json` only as read-only orientation when no user prompt is available. If the result includes an `ATM_USER_NOTICE` message or `evidence.userNotice`, show it to the user in natural language before running the returned next action.',
        '',
        'After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.',
        '',
        rootReadmeEntryEnd
    ].join('\n');
}
export function patchManagedRootEntry(input) {
    const current = readFileSync(input.targetPath, 'utf8');
    const normalizedBlock = normalizeTextBlock(input.block);
    const next = upsertManagedRootEntryBlock(current, normalizedBlock, input.startMarker, input.endMarker, input.insertion, input.force);
    const relativePath = relativePathFrom(input.cwd, input.targetPath);
    if (next === current) {
        input.unchanged.push(relativePath);
        return;
    }
    mkdirSync(path.dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, next, 'utf8');
    input.created.push(relativePath);
}
function upsertManagedRootEntryBlock(current, block, startMarker, endMarker, insertion, force) {
    const existingPattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\r?\\n?`, 'm');
    const lineBreak = detectTrailingNewline(current);
    const formattedBlock = block.replace(/\n/g, lineBreak);
    if (existingPattern.test(current)) {
        return current.replace(existingPattern, `${formattedBlock}${lineBreak}`);
    }
    if (current.includes('node atm.mjs next --prompt "<current user prompt>" --json') && !force) {
        return current;
    }
    const insertionIndex = findRootEntryInsertionIndex(current, insertion);
    const prefix = current.slice(0, insertionIndex).replace(/[ \t]+$/u, '');
    const suffix = current.slice(insertionIndex).replace(/^\r?\n/u, '');
    if (prefix.length === 0) {
        return `${formattedBlock}${lineBreak}${lineBreak}${suffix}`;
    }
    return `${prefix}${lineBreak}${lineBreak}${formattedBlock}${lineBreak}${lineBreak}${suffix}`;
}
function findRootEntryInsertionIndex(current, insertion) {
    if (insertion === 'after-frontmatter') {
        const frontmatterMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
        if (frontmatterMatch) {
            return frontmatterMatch[0].length;
        }
        return 0;
    }
    const titleMatch = current.match(/^# .*(?:\r?\n|$)/m);
    if (titleMatch && typeof titleMatch.index === 'number') {
        return titleMatch.index + titleMatch[0].length;
    }
    return 0;
}
function normalizeTextBlock(value) {
    return value.trim().replace(/\r\n/g, '\n');
}
function detectTrailingNewline(value) {
    return value.includes('\r\n') ? '\r\n' : '\n';
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
