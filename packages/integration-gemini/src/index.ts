import {
  compileSkillTemplatesForAdapter,
  createStaticIntegrationAdapter,
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
  return compileSkillTemplatesForAdapter('gemini');
}
