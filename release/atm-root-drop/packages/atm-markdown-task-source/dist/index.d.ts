import type { ExternalTaskSourcePlugin, ExternalTaskSourceInput, ParsedExternalTask, ExternalTaskValidationResult, ExternalTaskGenerationIntent, GeneratedExternalTaskCard } from '@ai-atomic-framework/plugin-sdk';
export declare class AtmMarkdownTaskSourcePlugin implements ExternalTaskSourcePlugin {
    readonly kind = "external-task-source";
    readonly id = "atm.markdown-task-source";
    readonly version = "0.1.0";
    parse(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null>;
    validate(parsed: ParsedExternalTask): Promise<ExternalTaskValidationResult>;
    generate(intent: ExternalTaskGenerationIntent): Promise<GeneratedExternalTaskCard>;
}
declare const plugin: AtmMarkdownTaskSourcePlugin;
export default plugin;
