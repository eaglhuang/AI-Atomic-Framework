import {
  compileSkillTemplatesForAdapter,
  createStaticIntegrationAdapter,
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
  return compileSkillTemplatesForAdapter('copilot');
}
