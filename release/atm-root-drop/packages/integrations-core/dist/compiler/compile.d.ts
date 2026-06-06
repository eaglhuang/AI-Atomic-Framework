import { type RenderedCharterInvariants } from './charter-block.ts';
import { type AtmSkillTemplate, type CompileSkillTemplateOptions, type SkillTemplateAdapterTarget } from './skill-templates.ts';
import type { IntegrationSourceFile } from '../manifest/types.ts';
export type { RenderedCharterInvariants };
export declare function renderCharterInvariantsBlock(repositoryRoot?: string): RenderedCharterInvariants;
export declare function compileSkillTemplatesForAdapter(adapterTarget: SkillTemplateAdapterTarget, templates?: readonly AtmSkillTemplate[] | undefined, options?: CompileSkillTemplateOptions): readonly IntegrationSourceFile[];
export declare function compileSkillTemplate(template: AtmSkillTemplate, adapterTarget: SkillTemplateAdapterTarget | 'copilot-instructions' | 'copilot-prompt', options?: CompileSkillTemplateOptions): string;
