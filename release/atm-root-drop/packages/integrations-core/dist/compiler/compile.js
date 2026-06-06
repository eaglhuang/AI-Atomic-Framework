/**
 * compiler/compile.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Adapter-specific skill template compiler. Emits IntegrationSourceFile
 * objects ready for installation by the manifest/construct layer.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCharterInvariantsBlock as renderCharterInvariantsBlockCore } from './charter-block.js';
import { loadMinimumAtmSkillTemplates } from './skill-templates.js';
// Private constants — inline literals so compile.ts has no import from index.ts
const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const charterInvariantsPlaceholder = '{{CHARTER_INVARIANTS}}';
export function renderCharterInvariantsBlock(repositoryRoot = integrationsCoreRepoRoot) {
    return renderCharterInvariantsBlockCore(repositoryRoot);
}
export function compileSkillTemplatesForAdapter(adapterTarget, templates = loadMinimumAtmSkillTemplates(), options = {}) {
    const resolvedTemplates = templates ?? loadMinimumAtmSkillTemplates();
    if (adapterTarget === 'claude-code' || adapterTarget === 'codex') {
        return resolvedTemplates.map((template) => ({
            relativePath: `${template.frontmatter.id}/SKILL.md`,
            content: compileSkillTemplate(template, adapterTarget, options),
            fileFormat: 'skill',
            source: 'template'
        }));
    }
    if (adapterTarget === 'cursor') {
        return resolvedTemplates.map((template) => ({
            relativePath: `${template.frontmatter.id}/SKILL.md`,
            content: compileSkillTemplate(template, 'cursor', options),
            fileFormat: 'markdown',
            source: 'template'
        }));
    }
    if (adapterTarget === 'gemini') {
        return resolvedTemplates.map((template) => ({
            relativePath: `${template.frontmatter.id}.toml`,
            content: compileSkillTemplate(template, 'gemini', options),
            fileFormat: 'toml',
            source: 'template'
        }));
    }
    return resolvedTemplates.flatMap((template) => [
        {
            relativePath: `instructions/${template.frontmatter.id}.instructions.md`,
            content: compileSkillTemplate(template, 'copilot-instructions', options),
            fileFormat: 'instructions-md',
            source: 'template'
        },
        {
            relativePath: `prompts/${template.frontmatter.id}.prompt.md`,
            content: compileSkillTemplate(template, 'copilot-prompt', options),
            fileFormat: 'prompt-md',
            source: 'template'
        }
    ]);
}
export function compileSkillTemplate(template, adapterTarget, options = {}) {
    const frontmatter = template.frontmatter;
    const body = renderSkillTemplateBody(template, options);
    if (adapterTarget === 'claude-code' || adapterTarget === 'codex') {
        return `---
name: ${frontmatter.id}
description: ${frontmatter.summary}
argument-hint: "<ATM context>"
charter-invariants-injected: true
---

${body}
`;
    }
    if (adapterTarget === 'copilot-instructions') {
        return `---
applyTo: "**"
---

${body}

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
`;
    }
    if (adapterTarget === 'copilot-prompt') {
        return `---
mode: agent
description: ${frontmatter.summary}
---

${body}

Do not introduce a second registry, task state, or approval path.
`;
    }
    if (adapterTarget === 'cursor') {
        return `${body}

## Rules

- Use ATM as the only governance route for this action.
- Do not create a second registry, task state, or approval workflow.
- Preserve user-edited integration files; manifest hashes decide uninstall safety.
`;
    }
    return `name = "${escapeTomlBasicString(frontmatter.id)}"
description = "${escapeTomlBasicString(frontmatter.summary)}"
first_command = "${escapeTomlBasicString(frontmatter.firstCommand)}"
command = "${escapeTomlBasicString(frontmatter.command)}"
handoff = "${escapeTomlBasicString(frontmatter.handoffs)}"
charter_invariants_injected = true

[atm]
entry_id = "${escapeTomlBasicString(frontmatter.id)}"
first_command = "${escapeTomlBasicString(frontmatter.firstCommand)}"
route_command = "${escapeTomlBasicString(frontmatter.command)}"
handoff_command = "${escapeTomlBasicString(frontmatter.handoffs)}"

[atm.guardrails]
no_parallel_registry = true
no_parallel_task_model = true
hash_guarded_uninstall = true

instructions = """
${body}
"""

charter_invariants = """
${renderCharterInvariantsBlock(options.repositoryRoot).text}
"""
`;
}
// ─── Private helpers ───────────────────────────────────────────────────────
function renderSkillTemplateBody(template, options = {}) {
    const frontmatter = template.frontmatter;
    const charterInvariants = renderCharterInvariantsBlock(options.repositoryRoot);
    return template.body
        .replaceAll('{{id}}', frontmatter.id)
        .replaceAll('{{title}}', frontmatter.title)
        .replaceAll('{{summary}}', frontmatter.summary)
        .replaceAll('{{firstCommand}}', frontmatter.firstCommand)
        .replaceAll('{{command}}', frontmatter.command)
        .replaceAll('{{handoffs}}', frontmatter.handoffs)
        .replaceAll(charterInvariantsPlaceholder, charterInvariants.text)
        .trimEnd();
}
function escapeTomlBasicString(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
