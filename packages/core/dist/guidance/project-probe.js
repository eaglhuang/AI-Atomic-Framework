import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { defaultMutationPolicy } from './guidance-packet.js';
export function probeProject(repositoryRoot, options = {}) {
    const root = path.resolve(repositoryRoot);
    const packageJson = readJsonIfExists(path.join(root, 'package.json'));
    const detectedLanguages = detectLanguages(root, packageJson);
    const packageManager = detectPackageManager(root);
    const testEntrypoints = detectTestEntrypoints(packageJson);
    const governanceFiles = detectGovernanceFiles(root);
    const availableAdapters = detectAvailableAdapters(root, packageJson);
    const registryState = summarizeState(root, [
        'atomic-registry.json',
        path.join('.atm', 'catalog', 'index', 'registry.json'),
        path.join('.atm', 'registry')
    ]);
    const mapState = summarizeState(root, [
        path.join('atomic_workbench', 'maps'),
        path.join('.atm', 'catalog', 'shards')
    ]);
    const atomState = summarizeState(root, [
        path.join('atomic_workbench', 'atoms'),
        path.join('packages', 'core', 'src')
    ]);
    const unknowns = buildUnknowns(root, packageJson, packageManager, testEntrypoints, governanceFiles, detectedLanguages);
    const hostGates = options.hostGates ?? [];
    const noTouchZones = options.noTouchZones ?? [];
    const mutationPolicy = {
        ...defaultMutationPolicy,
        ...(options.mutationPolicy ?? {})
    };
    const atmConfig = readAtmConfig(root);
    const configHotspots = extractConfigLegacyHotspots(atmConfig);
    const configNoTouchZones = extractConfigNoTouchZones(atmConfig);
    const configDefaultLegacyFlow = extractConfigDefaultLegacyFlow(atmConfig);
    const mergedNoTouchZones = [...noTouchZones, ...configNoTouchZones];
    const adapterStatus = governanceFiles.includes('.atm/config.json') || availableAdapters.length > 0
        ? {
            status: 'available',
            reason: availableAdapters.length > 0 ? 'at least one adapter is available' : '.atm/config.json exists'
        }
        : {
            status: 'missing',
            reason: 'no ATM config or adapter package was detected'
        };
    return {
        schemaId: 'atm.projectOrientationReport',
        specVersion: '0.1.0',
        repositoryRoot: root,
        detectedLanguages,
        packageManager,
        testEntrypoints,
        governanceFiles,
        adapterStatus,
        availableAdapters,
        registryState,
        mapState,
        atomState,
        legacyUriSupport: {
            supported: true,
            scheme: 'legacy',
            resolver: availableAdapters.includes('@ai-atomic-framework/adapter-local-git') ? '@ai-atomic-framework/adapter-local-git' : 'local-git-compatible'
        },
        hostGates,
        noTouchZones: mergedNoTouchZones,
        mutationPolicy,
        legacyHotspots: detectLegacyHotspots(root),
        configLegacyHotspots: configHotspots,
        releaseBlockers: buildReleaseBlockers(root, packageJson, detectedLanguages),
        releaseAdvisories: buildReleaseAdvisories(root, packageJson, detectedLanguages),
        defaultLegacyFlow: configDefaultLegacyFlow,
        unknowns
    };
}
function detectLanguages(root, packageJson) {
    const languages = new Set();
    if (existsSync(path.join(root, 'tsconfig.json'))) {
        languages.add('TypeScript');
    }
    if (packageJson || existsSync(path.join(root, 'package.json'))) {
        languages.add('JavaScript');
    }
    if (existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'requirements.txt'))) {
        languages.add('Python');
    }
    if (existsSync(path.join(root, 'pom.xml')) || existsSync(path.join(root, 'build.gradle')) || existsSync(path.join(root, 'build.gradle.kts')) || hasFileWithExtension(root, '.java')) {
        languages.add('Java');
    }
    if (hasFileWithExtension(root, '.csproj') || hasFileWithExtension(root, '.sln') || hasFileWithExtension(root, '.cs')) {
        languages.add('C#');
    }
    return [...languages].sort();
}
function detectPackageManager(root) {
    if (existsSync(path.join(root, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (existsSync(path.join(root, 'yarn.lock')))
        return 'yarn';
    if (existsSync(path.join(root, 'package-lock.json')))
        return 'npm';
    if (existsSync(path.join(root, 'bun.lockb')))
        return 'bun';
    if (existsSync(path.join(root, 'pom.xml')))
        return 'maven';
    if (existsSync(path.join(root, 'build.gradle')) || existsSync(path.join(root, 'build.gradle.kts')))
        return 'gradle';
    if (hasFileWithExtension(root, '.csproj') || hasFileWithExtension(root, '.sln'))
        return 'dotnet';
    return null;
}
function detectTestEntrypoints(packageJson) {
    const scripts = typeof packageJson?.scripts === 'object' && packageJson.scripts !== null
        ? packageJson.scripts
        : {};
    return Object.entries(scripts)
        .filter(([name]) => /test|validate|typecheck|lint/.test(name))
        .map(([name, command]) => `${name}: ${String(command)}`)
        .sort();
}
function detectGovernanceFiles(root) {
    return [
        '.atm/config.json',
        '.atm/runtime/current-task.json',
        '.atm/runtime/project-probe.json',
        'AGENTS.md',
        'CLAUDE.md',
        'atomic-registry.json'
    ].filter((relativePath) => existsSync(path.join(root, relativePath)));
}
function detectAvailableAdapters(root, packageJson) {
    const adapters = new Set();
    const dependencies = {
        ...(typeof packageJson?.dependencies === 'object' && packageJson.dependencies !== null ? packageJson.dependencies : {}),
        ...(typeof packageJson?.devDependencies === 'object' && packageJson.devDependencies !== null ? packageJson.devDependencies : {})
    };
    for (const dependencyName of Object.keys(dependencies)) {
        if (dependencyName.includes('adapter')) {
            adapters.add(dependencyName);
        }
    }
    if (existsSync(path.join(root, 'packages', 'adapter-local-git'))) {
        adapters.add('@ai-atomic-framework/adapter-local-git');
    }
    if (existsSync(path.join(root, 'packages', 'language-js'))) {
        adapters.add('@ai-atomic-framework/language-js');
    }
    if (existsSync(path.join(root, 'packages', 'language-python'))) {
        adapters.add('@ai-atomic-framework/language-python');
    }
    return [...adapters].sort();
}
function summarizeState(root, relativePaths) {
    const existingPaths = relativePaths.filter((relativePath) => existsSync(path.join(root, relativePath)));
    if (existingPaths.length === 0) {
        return { status: 'missing', paths: [] };
    }
    const count = existingPaths.reduce((total, relativePath) => total + countEntries(path.join(root, relativePath)), 0);
    return {
        status: existingPaths.length === relativePaths.length ? 'present' : 'partial',
        paths: existingPaths.map((entry) => entry.replace(/\\/g, '/')),
        count
    };
}
function countEntries(absolutePath) {
    if (!existsSync(absolutePath))
        return 0;
    const stats = statSync(absolutePath);
    if (stats.isFile())
        return 1;
    return readdirSync(absolutePath).length;
}
function detectLegacyHotspots(root) {
    const candidates = ['src', 'packages', 'scripts']
        .map((relativePath) => path.join(root, relativePath))
        .filter((absolutePath) => existsSync(absolutePath));
    const hotspots = [];
    for (const candidate of candidates) {
        for (const filePath of listSourceFiles(candidate, 20)) {
            const lineCount = readFileSync(filePath, 'utf8').split(/\r?\n/).length;
            if (lineCount >= 250) {
                hotspots.push({
                    path: path.relative(root, filePath).replace(/\\/g, '/'),
                    reason: `source file has ${lineCount} lines`,
                    riskLevel: lineCount >= 500 ? 'high' : 'medium'
                });
            }
            if (hotspots.length >= 10) {
                return hotspots;
            }
        }
    }
    return hotspots;
}
function listSourceFiles(directoryPath, limit) {
    const output = [];
    const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (output.length >= limit)
            break;
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist')
                continue;
            output.push(...listSourceFiles(absolutePath, limit - output.length));
            continue;
        }
        if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
            output.push(absolutePath);
        }
    }
    return output;
}
function buildUnknowns(root, packageJson, packageManager, testEntrypoints, governanceFiles, detectedLanguages) {
    const unknowns = [];
    const nonJavaScriptHost = isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages);
    if (!packageJson && !nonJavaScriptHost)
        unknowns.push('package.json');
    if (!packageManager && !nonJavaScriptHost)
        unknowns.push('packageManager');
    if (testEntrypoints.length === 0)
        unknowns.push('testEntrypoints');
    if (!governanceFiles.includes('.atm/config.json'))
        unknowns.push('atmConfig');
    if (!existsSync(path.join(root, '.git')))
        unknowns.push('gitRepository');
    return unknowns;
}
function buildReleaseBlockers(root, packageJson, detectedLanguages) {
    const blockers = [];
    if (!packageJson && !isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages))
        blockers.push('package-json-missing');
    if (!existsSync(path.join(root, '.git')))
        blockers.push('git-repository-missing');
    return blockers;
}
function buildReleaseAdvisories(root, packageJson, detectedLanguages) {
    const advisories = [];
    if (!packageJson && isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages)) {
        advisories.push('package-json-missing:advisory');
        advisories.push(`${detectedLanguages.join('+').toLowerCase()}-entrypoints-detected`);
        advisories.push('candidate-ranking-allowed');
        advisories.push('create-atom-route-deferred-until-language-adapter-selected');
    }
    return advisories;
}
function isNonJavaScriptHostWithoutPackageJson(packageJson, detectedLanguages) {
    return !packageJson
        && detectedLanguages.length > 0
        && !detectedLanguages.includes('JavaScript')
        && !detectedLanguages.includes('TypeScript');
}
function isPythonOnlyAdopter(packageJson, detectedLanguages) {
    return !packageJson
        && detectedLanguages.includes('Python')
        && !detectedLanguages.includes('JavaScript')
        && !detectedLanguages.includes('TypeScript');
}
function hasFileWithExtension(root, extension) {
    for (const relativePath of ['', 'src']) {
        const absolutePath = path.join(root, relativePath);
        if (!existsSync(absolutePath))
            continue;
        for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith(extension))
                return true;
            if (entry.isDirectory() && relativePath === '') {
                if (shouldSkipProbeDirectory(entry.name))
                    continue;
                const nestedPath = path.join(absolutePath, entry.name);
                try {
                    if (readdirSync(nestedPath, { withFileTypes: true }).some((nestedEntry) => nestedEntry.isFile() && nestedEntry.name.endsWith(extension))) {
                        return true;
                    }
                }
                catch {
                    continue;
                }
            }
        }
    }
    return false;
}
function shouldSkipProbeDirectory(name) {
    return new Set([
        '.git',
        '.atm',
        '.atm-temp',
        '.tmp',
        '.venv',
        'node_modules',
        'library',
        'temp',
        'tmp',
        'local',
        'artifacts',
        'profiles',
        'settings',
        'scratch',
        'dist',
        'build',
        'release',
        'coverage'
    ]).has(name);
}
function readJsonIfExists(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function readAtmConfig(root) {
    return readJsonIfExists(path.join(root, '.atm', 'config.json'));
}
function extractConfigLegacyHotspots(atmConfig) {
    const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
        ? atmConfig.guidance
        : null;
    if (!guidance || !Array.isArray(guidance.legacyHotspots))
        return [];
    return guidance.legacyHotspots.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null)
            return [];
        const e = entry;
        if (typeof e.path !== 'string')
            return [];
        return [{
                path: e.path,
                releaseBlockers: Array.isArray(e.releaseBlockers)
                    ? e.releaseBlockers.filter((s) => typeof s === 'string')
                    : [],
                demandReportPath: typeof e.demandReportPath === 'string' ? e.demandReportPath : null,
                existingAtomIndexPath: typeof e.existingAtomIndexPath === 'string' ? e.existingAtomIndexPath : null
            }];
    });
}
function extractConfigNoTouchZones(atmConfig) {
    const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
        ? atmConfig.guidance
        : null;
    if (!guidance || !Array.isArray(guidance.noTouchZones))
        return [];
    return guidance.noTouchZones.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null)
            return [];
        const e = entry;
        if (typeof e.path !== 'string')
            return [];
        const scope = e.scope === 'file' || e.scope === 'directory' || e.scope === 'glob' ? e.scope : 'unknown';
        return [{
                path: e.path,
                reason: typeof e.reason === 'string' ? e.reason : 'declared in .atm/config.json',
                scope
            }];
    });
}
function extractConfigDefaultLegacyFlow(atmConfig) {
    const guidance = typeof atmConfig?.guidance === 'object' && atmConfig.guidance !== null
        ? atmConfig.guidance
        : null;
    if (!guidance)
        return undefined;
    const flow = guidance.defaultLegacyFlow;
    if (flow === 'shadow' || flow === 'dry-run')
        return flow;
    return undefined;
}
