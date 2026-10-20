export declare function listTemplates(): string[];
export declare function loadTemplate(key: string): string;
export declare function applyIntent(templateText: string, fields: Record<string, unknown>): string;
