function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
function matchesPattern(filePath, pattern) {
    const normalizedFile = normalizePath(filePath);
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.endsWith('/'))
        return normalizedFile.startsWith(normalizedPattern);
    if (!normalizedPattern.includes('*'))
        return normalizedFile === normalizedPattern;
    const escaped = normalizedPattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    return new RegExp(`^${escaped}$`).test(normalizedFile);
}
function firstMatch(filePath, patterns) {
    return patterns.find((pattern) => matchesPattern(filePath, pattern)) ?? null;
}
export function runnerAffectingPatterns(manifest) {
    return [
        ...manifest.runnerAffectingSourceRoots,
        ...manifest.buildChainScripts,
        ...manifest.buildConfigPaths,
        ...manifest.rootLaunchers,
        ...manifest.schemaRoots
    ];
}
export function classifyAtmCorePath(manifest, filePath) {
    const path = normalizePath(filePath);
    const generatedMatch = firstMatch(path, manifest.generatedArtifacts);
    if (generatedMatch) {
        return { path, kind: 'generated-artifact', matchedPattern: generatedMatch, stewardOnly: true };
    }
    const planningMatch = firstMatch(path, manifest.nonCorePlanningUtilities);
    if (planningMatch) {
        return { path, kind: 'non-core-planning', matchedPattern: planningMatch, stewardOnly: false };
    }
    const runnerMatch = firstMatch(path, runnerAffectingPatterns(manifest));
    if (runnerMatch) {
        return { path, kind: 'atm-core', matchedPattern: runnerMatch, stewardOnly: false };
    }
    return { path, kind: 'outside-atm-core', matchedPattern: null, stewardOnly: false };
}
export function analyzeAtmCoreScope(manifest, filePaths) {
    const classifications = filePaths.map((filePath) => classifyAtmCorePath(manifest, filePath));
    const diagnostics = classifications.flatMap((classification) => {
        if (classification.kind === 'generated-artifact') {
            return [{
                    code: 'ATM_CORE_SCOPE_RELEASE_WRITE_STEWARD_ONLY',
                    path: classification.path,
                    message: 'release artifacts are generated outputs and must be published by the runner sync steward',
                    matchedPattern: classification.matchedPattern
                }];
        }
        if (classification.kind === 'outside-atm-core') {
            return [{
                    code: 'ATM_CORE_SCOPE_UNDECLARED_WRITE',
                    path: classification.path,
                    message: 'path is not declared in runner build scope manifest',
                    matchedPattern: null
                }];
        }
        return [];
    });
    return {
        schemaId: 'atm.atmCoreScopeReport.v1',
        classifications,
        diagnostics,
        runnerSyncNeeded: classifications.some((classification) => classification.kind === 'atm-core')
    };
}
