import {
  atmFirstCommand,
  charterInvariantsPlaceholder,
  createStaticIntegrationAdapter,
  minimumAtmEntrySkillDefinitions,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationClaudeCodePackage = {
  packageName: '@ai-atomic-framework/integration-claude-code',
  packageRole: 'claude-code-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface ClaudeCodeIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

type AtmEntrySkillDefinition = (typeof minimumAtmEntrySkillDefinitions)[number];

export function createClaudeCodeIntegrationAdapter(options: ClaudeCodeIntegrationAdapterOptions = {}): IntegrationAdapter {
  return createStaticIntegrationAdapter({
    id: 'claude-code',
    displayName: 'Claude Code skills',
    adapterVersion: options.adapterVersion ?? integrationClaudeCodePackage.packageVersion,
    targetDir: options.targetDir ?? '.claude/skills',
    fileFormat: 'skill',
    placeholderStyle: '$ARGUMENTS',
    sourceFiles: createClaudeCodeSourceFiles()
  });
}

export function createClaudeCodeSourceFiles(): readonly IntegrationSourceFile[] {
  return minimumAtmEntrySkillDefinitions.map((entryDefinition) => ({
    relativePath: `${entryDefinition.id}/SKILL.md`,
    content: renderClaudeCodeSkill(entryDefinition),
    fileFormat: 'skill',
    source: 'template'
  }));
}

function renderClaudeCodeSkill(entryDefinition: AtmEntrySkillDefinition): string {
  return `---
name: ${entryDefinition.id}
description: ${entryDefinition.summary}
argument-hint: "<ATM context>"
charter-invariants-injected: true
---

# ${entryDefinition.title}

First command:

\`\`\`bash
${atmFirstCommand}
\`\`\`

## Command Route

Use this ATM command only after the first command confirms it is the current governed route:

\`\`\`bash
${entryDefinition.command}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Preserve host edits; uninstall is hash-guarded by the install manifest.
`;
}
