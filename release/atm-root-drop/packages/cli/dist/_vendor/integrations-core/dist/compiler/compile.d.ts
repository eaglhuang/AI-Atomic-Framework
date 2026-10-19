import { type RenderedCharterInvariants } from './charter-block.js';
import { type AtmSkillTemplate, type CompileSkillTemplateOptions, type SkillTemplateAdapterTarget } from './skill-templates.js';
import type { IntegrationSourceFile } from '../manifest/types.js';
export type { RenderedCharterInvariants };
export declare function renderCharterInvariantsBlock(repositoryRoot?: string): RenderedCharterInvariants;
export declare function compileSkillTemplatesForAdapter(adapterTarget: SkillTemplateAdapterTarget, templates?: readonly AtmSkillTemplate[] | undefined, options?: CompileSkillTemplateOptions): readonly IntegrationSourceFile[];
/**
 * Report the same default source corpus that compilation selects for a target
 * repository. The templates are bundled with integrations-core; the target
 * repository only selects the install profile and is never treated as the
 * template source.
 */
export declare function resolveDefaultSkillSourceCoverage(repositoryRoot?: string): {
    sourceFileCount: number;
    sourceCatalogDigest: `sha256:${string}`;
};
export declare function compileSkillTemplate(template: AtmSkillTemplate, adapterTarget: SkillTemplateAdapterTarget | 'copilot-instructions' | 'copilot-prompt', options?: CompileSkillTemplateOptions): string;
