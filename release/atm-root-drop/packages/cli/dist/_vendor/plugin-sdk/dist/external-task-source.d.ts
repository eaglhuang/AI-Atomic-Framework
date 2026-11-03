export interface ExternalTaskSourcePlugin {
    readonly kind: 'external-task-source';
    readonly id: string;
    readonly version: string;
    parse?(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null>;
    validate?(parsed: ParsedExternalTask): Promise<ExternalTaskValidationResult>;
    generate?(intent: ExternalTaskGenerationIntent): Promise<GeneratedExternalTaskCard>;
}
export interface ExternalTaskSourceInput {
    readonly cwd: string;
    readonly sourcePath: string;
    readonly raw: string;
}
export interface ParsedExternalTask {
    readonly taskId: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly body?: string;
    readonly sourcePath: string;
}
export interface ExternalTaskValidationResult {
    readonly ok: boolean;
    readonly diagnostics: ReadonlyArray<{
        code: string;
        level: 'error' | 'warning' | 'info';
        message: string;
    }>;
}
export interface ExternalTaskGenerationIntent {
    readonly cwd: string;
    readonly templateKey?: string;
    readonly fields: Readonly<Record<string, unknown>>;
}
export interface GeneratedExternalTaskCard {
    readonly taskId: string;
    readonly sourcePath: string;
    readonly content: string;
}
