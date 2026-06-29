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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRequiredFlagSets(value: unknown): CommandHelpRequiredFlags[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const when = typeof entry?.when === 'string' ? entry.when.trim() : '';
      const flags = normalizeStringList(entry?.flags);
      if (!when || flags.length === 0) {
        return null;
      }
      return { when, flags };
    })
    .filter((entry): entry is CommandHelpRequiredFlags => Boolean(entry));
}

export function normalizeCommandHelpMetadata(value: unknown): CommandHelpMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const audience = typeof (value as { audience?: unknown }).audience === 'string'
    ? ((value as { audience?: string }).audience?.trim() || undefined)
    : undefined;
  const normalized: CommandHelpMetadata = {};
  if (audience) {
    normalized.audience = audience as CommandHelpMetadata['audience'];
  }
  const requiredFlagSets = normalizeRequiredFlagSets((value as { requiredFlagSets?: unknown }).requiredFlagSets);
  if (requiredFlagSets.length > 0) {
    normalized.requiredFlagSets = requiredFlagSets;
  }
  for (const [sourceKey, targetKey] of [
    ['relatedCommands', 'relatedCommands'],
    ['commonMistakes', 'commonMistakes'],
    ['playbookNotes', 'playbookNotes'],
    ['maintainerNotes', 'maintainerNotes'],
    ['deprecatedGuidance', 'deprecatedGuidance']
  ] as const) {
    const list = normalizeStringList((value as Record<string, unknown>)[sourceKey]);
    if (list.length > 0) {
      switch (targetKey) {
        case 'relatedCommands':
          normalized.relatedCommands = list;
          break;
        case 'commonMistakes':
          normalized.commonMistakes = list;
          break;
        case 'playbookNotes':
          normalized.playbookNotes = list;
          break;
        case 'maintainerNotes':
          normalized.maintainerNotes = list;
          break;
        case 'deprecatedGuidance':
          normalized.deprecatedGuidance = list;
          break;
      }
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
