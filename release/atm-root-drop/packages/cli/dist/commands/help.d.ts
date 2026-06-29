export interface CommandHelpRequiredFlags {
    when: string;
    flags: string[];
}
export interface CommandHelpMetadata {
    audience?: 'general' | 'agent' | 'maintainer' | 'mixed';
    requiredFlagSets?: CommandHelpRequiredFlags[];
    relatedCommands?: string[];
    commonMistakes?: string[];
    playbookNotes?: string[];
    maintainerNotes?: string[];
    deprecatedGuidance?: string[];
}
export declare function normalizeCommandHelpMetadata(value: unknown): CommandHelpMetadata | undefined;
