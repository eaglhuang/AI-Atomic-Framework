import {
  atmFirstCommand,
  charterInvariantsPlaceholder,
  createStaticIntegrationAdapter,
  minimumAtmEntrySkillDefinitions,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationGeminiPackage = {
  packageName: '@ai-atomic-framework/integration-gemini',
  packageRole: 'gemini-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface GeminiIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

type AtmEntrySkillDefinition = (typeof minimumAtmEntrySkillDefinitions)[number];

export function createGeminiIntegrationAdapter(options: GeminiIntegrationAdapterOptions = {}): IntegrationAdapter {
  return createStaticIntegrationAdapter({
    id: 'gemini',
    displayName: 'Gemini commands',
    adapterVersion: options.adapterVersion ?? integrationGeminiPackage.packageVersion,
    targetDir: options.targetDir ?? '.gemini/commands',
    fileFormat: 'toml',
    placeholderStyle: 'toml-fields',
    sourceFiles: createGeminiSourceFiles()
  });
}

export function createGeminiSourceFiles(): readonly IntegrationSourceFile[] {
  return minimumAtmEntrySkillDefinitions.map((entryDefinition) => ({
    relativePath: `${entryDefinition.id}.toml`,
    content: renderGeminiCommand(entryDefinition),
    fileFormat: 'toml',
    source: 'template'
  }));
}

function renderGeminiCommand(entryDefinition: AtmEntrySkillDefinition): string {
  return `name = "${entryDefinition.id}"
description = "${entryDefinition.summary}"
first_command = "${atmFirstCommand}"
command = "${entryDefinition.command}"
charter_invariants_injected = true

[atm]
entry_id = "${entryDefinition.id}"
first_command = "${atmFirstCommand}"
route_command = "${entryDefinition.command}"

[atm.guardrails]
no_parallel_registry = true
no_parallel_task_model = true
hash_guarded_uninstall = true

charter_invariants = """
${charterInvariantsPlaceholder}
"""
`;
}
