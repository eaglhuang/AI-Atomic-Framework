export function hasEntrypointSignature(sourceText) {
    if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/m.test(sourceText))
        return true;
    if (/^\s*def\s+main\s*\(/m.test(sourceText))
        return true;
    return false;
}
export function message(level, code, text, filePath, line) {
    const result = { level, code, text };
    if (filePath)
        result.filePath = filePath;
    if (typeof line === 'number')
        result.line = line;
    return result;
}
export function mergePolicy(base, overrides) {
    const forbidden = new Set([...base.forbiddenSpecifiers, ...(overrides?.forbiddenSpecifiers ?? [])]);
    const allowed = new Set([...(base.allowedSpecifiers ?? []), ...(overrides?.allowedSpecifiers ?? [])]);
    return Object.freeze({
        forbiddenSpecifiers: [...forbidden],
        allowedSpecifiers: [...allowed]
    });
}
export function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
export function createStaticCheckPlan(tier, commands, input) {
    return {
        tier,
        commands,
        source: input.source,
        scope: 'repository',
        estimatedCost: tier === 'fast' ? 'fast' : tier === 'default' ? 'medium' : 'slow',
        kinds: input.kinds,
        guidance: input.guidance
    };
}
