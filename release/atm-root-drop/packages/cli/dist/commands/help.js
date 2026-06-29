function normalizeStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function normalizeRequiredFlagSets(value) {
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
        .filter((entry) => Boolean(entry));
}
export function normalizeCommandHelpMetadata(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const audience = typeof value.audience === 'string'
        ? (value.audience?.trim() || undefined)
        : undefined;
    const normalized = {};
    if (audience) {
        normalized.audience = audience;
    }
    const requiredFlagSets = normalizeRequiredFlagSets(value.requiredFlagSets);
    if (requiredFlagSets.length > 0) {
        normalized.requiredFlagSets = requiredFlagSets;
    }
    for (const [sourceKey, targetKey] of [
        ['relatedCommands', 'relatedCommands'],
        ['commonMistakes', 'commonMistakes'],
        ['playbookNotes', 'playbookNotes'],
        ['maintainerNotes', 'maintainerNotes'],
        ['deprecatedGuidance', 'deprecatedGuidance']
    ]) {
        const list = normalizeStringList(value[sourceKey]);
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
