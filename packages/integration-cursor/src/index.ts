import {
  atmFirstCommand,
  charterInvariantsPlaceholder,
  createStaticIntegrationAdapter,
  minimumAtmEntrySkillDefinitions,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationCursorPackage = {
  packageName: '@ai-atomic-framework/integration-cursor',
  packageRole: 'cursor-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface CursorIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

type AtmEntrySkillDefinition = (typeof minimumAtmEntrySkillDefinitions)[number];

export function createCursorIntegrationAdapter(options: CursorIntegrationAdapterOptions = {}): IntegrationAdapter {
  return createStaticIntegrationAdapter({
    id: 'cursor',
    displayName: 'Cursor rules skills',
    adapterVersion: options.adapterVersion ?? integrationCursorPackage.packageVersion,
    targetDir: options.targetDir ?? '.cursor/rules/skills',
    fileFormat: 'markdown',
    placeholderStyle: '$ARGUMENTS',
    sourceFiles: createCursorSourceFiles()
  });
}

export function createCursorSourceFiles(): readonly IntegrationSourceFile[] {
  return minimumAtmEntrySkillDefinitions.map((entryDefinition) => ({
    relativePath: `${entryDefinition.id}/SKILL.md`,
    content: renderCursorSkill(entryDefinition),
    fileFormat: 'markdown',
    source: 'template'
  }));
}

function renderCursorSkill(entryDefinition: AtmEntrySkillDefinition): string {
  return `# ${entryDefinition.title}

First command:

\`\`\`bash
${atmFirstCommand}
\`\`\`

## Route

After ATM confirms this route, run:

\`\`\`bash
${entryDefinition.command}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

## Rules

- Use ATM as the only governance route for this action.
- Do not create a second registry, task state, or approval workflow.
- Preserve user-edited integration files; manifest hashes decide uninstall safety.
`;
}
