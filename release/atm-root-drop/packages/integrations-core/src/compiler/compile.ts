/**
 * compiler/compile.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Adapter-specific skill template compiler. Emits IntegrationSourceFile
 * objects ready for installation by the manifest/construct layer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type RenderedCharterInvariants,
  renderCharterInvariantsBlock as renderCharterInvariantsBlockCore
} from './charter-block.ts';
import {
  type AtmSkillTemplate,
  type CompileSkillTemplateOptions,
  type SkillTemplateAdapterTarget,
  loadMinimumAtmSkillTemplates
} from './skill-templates.ts';
import type { IntegrationSourceFile } from '../manifest/types.ts';

export type { RenderedCharterInvariants };

// Private constants — inline literals so compile.ts has no import from index.ts
const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const charterInvariantsPlaceholder = '{{CHARTER_INVARIANTS}}';
const actorIdentityHandoffGatePlaceholder = '{{ACTOR_IDENTITY_HANDOFF_GATE}}';
const actorIdentityHandoffGate = [
  '## Actor Identity Handoff Gate',
  '',
  'Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,',
  'or governed `git ...` command, resolve this agent\'s explicit actor id.',
  '',
  '- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.',
  '- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.',
  '- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.',
  '- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.'
].join('\n');

export function renderCharterInvariantsBlock(repositoryRoot = integrationsCoreRepoRoot): RenderedCharterInvariants {
  return renderCharterInvariantsBlockCore(repositoryRoot);
}

export function compileSkillTemplatesForAdapter(
  adapterTarget: SkillTemplateAdapterTarget,
  templates: readonly AtmSkillTemplate[] | undefined = loadMinimumAtmSkillTemplates(),
  options: CompileSkillTemplateOptions = {}
): readonly IntegrationSourceFile[] {
  const resolvedTemplates = templates ?? loadMinimumAtmSkillTemplates();
  if (adapterTarget === 'claude-code' || adapterTarget === 'codex') {
    return resolvedTemplates.flatMap((template) => [
      {
        relativePath: `${template.frontmatter.id}/SKILL.md`,
        content: compileSkillTemplate(template, adapterTarget, options),
        fileFormat: 'skill',
        source: 'template'
      },
      ...loadSkillTemplateCompanionFiles(template.frontmatter.id)
    ]);
  }
  if (adapterTarget === 'cursor') {
    return resolvedTemplates.flatMap((template) => [
      {
        relativePath: `${template.frontmatter.id}/SKILL.md`,
        content: compileSkillTemplate(template, 'cursor', options),
        fileFormat: 'markdown',
        source: 'template'
      },
      ...loadSkillTemplateCompanionFiles(template.frontmatter.id)
    ]);
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
      fileFormat: 'instructions-md' as const,
      source: 'template' as const
    },
    {
      relativePath: `prompts/${template.frontmatter.id}.prompt.md`,
      content: compileSkillTemplate(template, 'copilot-prompt', options),
      fileFormat: 'prompt-md' as const,
      source: 'template' as const
    }
  ]);
}

export function compileSkillTemplate(
  template: AtmSkillTemplate,
  adapterTarget: SkillTemplateAdapterTarget | 'copilot-instructions' | 'copilot-prompt',
  options: CompileSkillTemplateOptions = {}
): string {
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

function renderSkillTemplateBody(template: AtmSkillTemplate, options: CompileSkillTemplateOptions = {}): string {
  const frontmatter = template.frontmatter;
  const charterInvariants = renderCharterInvariantsBlock(options.repositoryRoot);
  return template.body
    .replaceAll('{{id}}', frontmatter.id)
    .replaceAll('{{title}}', frontmatter.title)
    .replaceAll('{{summary}}', frontmatter.summary)
    .replaceAll('{{firstCommand}}', frontmatter.firstCommand)
    .replaceAll('{{command}}', frontmatter.command)
    .replaceAll('{{handoffs}}', frontmatter.handoffs)
    .replaceAll(actorIdentityHandoffGatePlaceholder, actorIdentityHandoffGate)
    .replaceAll(charterInvariantsPlaceholder, charterInvariants.text)
    .trimEnd();
}

function loadSkillTemplateCompanionFiles(templateId: string): readonly IntegrationSourceFile[] {
  const companionRoot = path.join(integrationsCoreRepoRoot, 'templates', 'skills', `${templateId}.files`);
  return walkCompanionDirectory(companionRoot).map((filePath) => ({
    relativePath: `${templateId}/${path.relative(companionRoot, filePath).replace(/\\/g, '/')}`,
    content: readFileSync(filePath, 'utf8'),
    fileFormat: inferIntegrationFileFormat(filePath),
    source: 'template' as const
  }));
}

function walkCompanionDirectory(directoryPath: string): readonly string[] {
  try {
    const entries = readdirSync(directoryPath, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkCompanionDirectory(fullPath);
      }
      if (entry.isFile()) {
        return [fullPath];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function inferIntegrationFileFormat(filePath: string): IntegrationSourceFile['fileFormat'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') return 'markdown';
  if (extension === '.toml') return 'toml';
  if (extension === '.yml' || extension === '.yaml') return 'yaml';
  return 'markdown';
}

function escapeTomlBasicString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
