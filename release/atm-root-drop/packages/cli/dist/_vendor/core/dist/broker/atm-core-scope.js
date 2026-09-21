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
const codeScopePatterns = [
    'packages/',
    'scripts/',
    'templates/',
    'schemas/',
    'atomic_workbench/',
    'release/',
    'integrations/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'atm.mjs',
    'atm.dev.mjs'
];
const docsScopePatterns = [
    'docs/',
    '*.md'
];
const ledgerScopePatterns = [
    '.atm/'
];
export function classifyAtmFileScope(filePath) {
    const path = normalizePath(filePath);
    const scopeClass = [];
    const matchedPatterns = [];
    const addMatches = (kind, patterns) => {
        const match = firstMatch(path, patterns);
        if (!match)
            return;
        scopeClass.push(kind);
        matchedPatterns.push(match);
    };
    addMatches('ledger', ledgerScopePatterns);
    addMatches('code', codeScopePatterns);
    addMatches('docs', docsScopePatterns);
    return { path, scopeClass, matchedPatterns };
}
export function deriveAtmScopeClass(filePaths) {
    const classifications = filePaths.map((filePath) => classifyAtmFileScope(filePath));
    const scopeClass = uniqueScopeClasses(classifications.flatMap((classification) => classification.scopeClass));
    return {
        schemaId: 'atm.fileScopeReport.v1',
        classifications,
        scopeClass,
        hasCode: scopeClass.includes('code'),
        hasDocs: scopeClass.includes('docs'),
        hasLedger: scopeClass.includes('ledger')
    };
}
export function applyAtmScopeClassOverride(filePaths, overrideScopeClass) {
    const derived = deriveAtmScopeClass(filePaths);
    const override = uniqueScopeClasses(overrideScopeClass);
    if (derived.hasCode && !override.includes('code')) {
        return derived;
    }
    return {
        ...derived,
        scopeClass: override,
        hasCode: override.includes('code'),
        hasDocs: override.includes('docs'),
        hasLedger: override.includes('ledger')
    };
}
function uniqueScopeClasses(values) {
    return ['code', 'docs', 'ledger'].filter((value) => values.includes(value));
}
