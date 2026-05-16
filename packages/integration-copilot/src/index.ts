import {
  atmFirstCommand,
  charterInvariantsPlaceholder,
  createStaticIntegrationAdapter,
  minimumAtmEntrySkillDefinitions,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationCopilotPackage = {
  packageName: '@ai-atomic-framework/integration-copilot',
  packageRole: 'copilot-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface CopilotIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

type AtmEntrySkillDefinition = (typeof minimumAtmEntrySkillDefinitions)[number];

export function createCopilotIntegrationAdapter(options: CopilotIntegrationAdapterOptions = {}): IntegrationAdapter {
  return createStaticIntegrationAdapter({
    id: 'copilot',
    displayName: 'GitHub Copilot instructions and prompts',
    adapterVersion: options.adapterVersion ?? integrationCopilotPackage.packageVersion,
    targetDir: options.targetDir ?? '.github',
    fileFormat: 'instructions-md',
    placeholderStyle: '{{vars}}',
    sourceFiles: createCopilotSourceFiles()
  });
}

export function createCopilotSourceFiles(): readonly IntegrationSourceFile[] {
  const entryFiles = minimumAtmEntrySkillDefinitions.flatMap((entryDefinition) => [
    {
      relativePath: `instructions/${entryDefinition.id}.instructions.md`,
      content: renderCopilotInstructions(entryDefinition),
      fileFormat: 'instructions-md' as const,
      source: 'template' as const
    },
    {
      relativePath: `prompts/${entryDefinition.id}.prompt.md`,
      content: renderCopilotPrompt(entryDefinition),
      fileFormat: 'prompt-md' as const,
      source: 'template' as const
    }
  ]);
  return [
    {
      relativePath: 'copilot-instructions.md',
      content: renderCopilotRootInstructions(),
      fileFormat: 'instructions-md',
      source: 'template'
    },
    ...entryFiles
  ];
}

function renderCopilotRootInstructions(): string {
  return `# ATM Copilot Instructions

First command:

\`\`\`bash
${atmFirstCommand}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

## Operating Rules

- Route governed work through ATM before editing files.
- Use the ATM prompt and instruction files for specific next, orient, create, lock, evidence, upgrade-scan, and handoff flows.
- Do not create a parallel task model, registry, or approval workflow.
`;
}

function renderCopilotInstructions(entryDefinition: AtmEntrySkillDefinition): string {
  return `---
applyTo: "**"
---

# ${entryDefinition.title}

First command:

\`\`\`bash
${atmFirstCommand}
\`\`\`

## Route Command

\`\`\`bash
${entryDefinition.command}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
`;
}

function renderCopilotPrompt(entryDefinition: AtmEntrySkillDefinition): string {
  return `---
mode: agent
description: ${entryDefinition.summary}
---

# ${entryDefinition.title}

First command:

\`\`\`bash
${atmFirstCommand}
\`\`\`

Then, only when ATM routes here, run:

\`\`\`bash
${entryDefinition.command}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

Do not introduce a second registry, task state, or approval path.
`;
}
