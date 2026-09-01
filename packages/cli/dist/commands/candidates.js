import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isCacheEnabled, computeCacheKey, getGitCommitHash, hasUncommittedChanges, getPolicyHash, readCacheEntry, writeCacheEntry } from '../../../core/dist/cache/guide-cache.js';
import { buildSourceInventoryReport } from '../../../core/dist/source-inventory/source-inventory.js';
import { makePoliceFamilyReport, runPoliceFamilyGate } from '../../../core/dist/police/family.js';
import { classifyGuidanceIntent, probeProject } from '../../../core/dist/guidance/index.js';
import { detectFrameworkRepoIdentity } from './framework-development.js';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.js';
import { CliError, makeResult, message, relativePathFrom } from './shared.js';
const defaultIncludePatterns = ['pipelines/**/*.py', 'scripts/**/*.py', '*.py'];
const ignoredDirectoryNames = new Set(['.git', '.atm', '.venv', 'venv', 'node_modules', 'dist', 'build', '__pycache__']);
export async function runCandidates(argv) {
    const options = parseCandidatesOptions(argv);
    if (options.action !== 'rank') {
        throw new CliError('ATM_CLI_USAGE', `candidates only supports action "rank" (got ${options.action})`, { exitCode: 2 });
    }
    // Cache layer (opt-in, defaults OFF)
    const cacheEnabled = isCacheEnabled(options.cwd) && !options.noCache;
    let cacheBypassReason = null;
    let cacheKey = null;
    let cacheComponents = null;
    if (cacheEnabled) {
        const dirty = hasUncommittedChanges(options.cwd);
        if (dirty) {
            cacheBypassReason = 'dirty-working-tree';
        }
        else {
            const gitHash = getGitCommitHash(options.cwd);
            if (!gitHash) {
                cacheBypassReason = 'no-git-commit';
            }
            else {
                cacheComponents = {
                    goal: options.goal,
                    glob: options.includePatterns.join('|'),
                    gitCommitHash: gitHash,
                    toolVersion: '0.1.0',
                    policyHash: getPolicyHash(options.cwd)
                };
                cacheKey = computeCacheKey(cacheComponents);
                const hit = readCacheEntry(options.cwd, cacheKey);
                if (hit) {
                    return makeResult({
                        ok: true,
                        command: 'candidates',
                        cwd: options.cwd,
                        messages: [
                            message('info', 'ATM_CANDIDATES_RANK_CACHED', 'Candidate ranking returned from cache.', {
                                cached: true,
                                cacheAge: Math.floor((Date.now() - new Date(hit.cachedAt).getTime()) / 1000) + 's',
                                candidates: hit.result?.candidateRanking?.length ?? 0
                            })
                        ],
                        evidence: { report: hit.result, cached: true, cachedAt: hit.cachedAt }
                    });
                }
            }
        }
    }
    const generatedAt = new Date().toISOString();
    const includePatterns = options.includePatterns.length > 0 ? options.includePatterns : defaultIncludePatterns;
    const sourceFiles = expandIncludePatterns(options.cwd, includePatterns);
    const metrics = sourceFiles.flatMap((filePath) => readCandidateMetrics(options.cwd, filePath));
    const sourceInventory = buildSourceInventoryReport({
        entries: metrics.map((entry) => ({
            filePath: entry.filePath,
            language: 'Python',
            lineCount: entry.lineCount,
            exportedSymbols: [...entry.functionNames.slice(0, 50), ...entry.classNames.slice(0, 20)],
            entrypointHint: entry.cliSurfaceCount > 0 ? 'python-cli-or-script-entrypoint' : undefined,
            legacyUri: `legacy://${entry.filePath}`
        })),
        maxFileLines: options.maxFileLines,
        generatedAt
    });
    const policeReport = await runPoliceFamilyGate({
        profile: 'standard',
        generatedAt,
        coreFamilies: [
            makePoliceFamilyReport({ family: 'schema', mode: 'blocker', status: 'pass', sourceValidator: 'atm-candidates-rank' }),
            makePoliceFamilyReport({ family: 'boundary', mode: 'blocker', status: 'pass', sourceValidator: 'atm-candidates-rank' }),
            makePoliceFamilyReport({ family: 'registry-consistency', mode: 'blocker', status: 'pass', sourceValidator: 'atm-candidates-rank' })
        ],
        decomposition: {
            inventory: sourceInventory,
            maxFileLines: options.maxFileLines
        },
        atomization: {},
        demand: {},
        quality: {},
        mapIntegration: {},
        evolution: {},
        polymorph: {},
        rollback: {},
        evidenceIntegrity: {},
        reversibility: {},
        noiseControl: {}
    });
    const candidateRanking = metrics
        .map((entry) => rankCandidate(entry, options.maxFileLines, options.goal))
        .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
        .slice(0, options.limit)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
    const recommendedBehaviors = [...new Set(candidateRanking.flatMap((entry) => entry.recommendedBehaviors))].sort();
    const orientation = probeProject(options.cwd);
    const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
    const guidanceDriftPolice = buildGuidanceDriftPolice(options.cwd, options.goal, generatedAt);
    const pythonOnlyAdopterNeutrality = {
        packageJsonMissing: !existsSync(path.join(options.cwd, 'package.json')) ? 'advisory' : 'not-applicable',
        pythonEntrypointsDetected: orientation.detectedLanguages.includes('Python'),
        candidateRankingAllowed: true,
        createAtomRoute: !existsSync(path.join(options.cwd, 'package.json')) && orientation.detectedLanguages.includes('Python')
            ? runtimeAdapterReadiness.pythonLanguageAdapterAvailable
                ? 'available through language-python adapter (apply still requires evidence + review gates)'
                : 'deferred until package/runtime adapter is selected'
            : 'available through normal ATM create route',
        runtimeAdapterReadiness
    };
    const languagePythonAdapter = {
        bundled: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
        adapterName: runtimeAdapterReadiness.pythonLanguageAdapterAvailable ? '@ai-atomic-framework/language-python' : null,
        supports: runtimeAdapterReadiness.pythonLanguageAdapterAvailable
            ? ['detect-python-project-profile', 'scan-python-entrypoints', 'scan-python-imports', 'plan-python-atomize-dry-run', 'delegated-test-commands']
            : [],
        appliesTo: includePatterns.filter((pattern) => /\.py\b/.test(pattern)),
        note: runtimeAdapterReadiness.pythonLanguageAdapterAvailable
            ? 'Candidate ranking metadata can be enriched with adapter-detected entrypoints; apply still requires evidence and review gates.'
            : 'No bundled Python language adapter; candidate ranking remains advisory-only.'
    };
    const reportId = `candidate-ranking-${formatTimestampForPath(generatedAt)}`;
    const reportsDirectory = path.resolve(options.cwd, options.outDir);
    const sourceInventoryReportPath = path.join(reportsDirectory, `${reportId}.source-inventory.json`);
    const policeReportPath = path.join(reportsDirectory, `${reportId}.police-family.json`);
    const guidanceDriftReportPath = path.join(reportsDirectory, `${reportId}.guidance-drift-police.json`);
    const candidateReportPath = path.join(reportsDirectory, `${reportId}.json`);
    const rankingReport = {
        schemaId: 'atm.candidateRankingReport',
        specVersion: '0.1.0',
        generatedAt,
        repositoryRoot: options.cwd,
        goal: options.goal,
        includePatterns,
        maxFileLines: options.maxFileLines,
        limit: options.limit,
        candidateRanking,
        recommendedBehaviors,
        sourceInventoryReportPath: relativePathFrom(options.cwd, sourceInventoryReportPath),
        policeReportPath: relativePathFrom(options.cwd, policeReportPath),
        guidanceDriftReportPath: relativePathFrom(options.cwd, guidanceDriftReportPath),
        nextDryRunCommand: candidateRanking[0]?.nextDryRunCommand ?? null,
        guidedFallback: buildGuidedFallback(options.cwd),
        pythonOnlyAdopterNeutrality,
        languagePythonAdapter
    };
    mkdirSync(reportsDirectory, { recursive: true });
    writeFileSync(sourceInventoryReportPath, `${JSON.stringify(sourceInventory, null, 2)}\n`, 'utf8');
    writeFileSync(policeReportPath, `${JSON.stringify(policeReport, null, 2)}\n`, 'utf8');
    writeFileSync(guidanceDriftReportPath, `${JSON.stringify(guidanceDriftPolice, null, 2)}\n`, 'utf8');
    writeFileSync(candidateReportPath, `${JSON.stringify(rankingReport, null, 2)}\n`, 'utf8');
    // Write to cache if enabled and no bypass
    if (cacheEnabled && cacheKey && cacheComponents && !cacheBypassReason) {
        try {
            writeCacheEntry(options.cwd, cacheKey, cacheComponents, rankingReport);
        }
        catch {
            // Cache write failure is non-fatal — safe degradation
        }
    }
    return makeResult({
        ok: true,
        command: 'candidates',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CANDIDATES_RANK_READY', 'Candidate ranking report generated.', {
                candidates: candidateRanking.length,
                sourceFiles: metrics.length,
                recommendedBehaviors,
                outputPath: relativePathFrom(options.cwd, candidateReportPath),
                cached: false,
                cacheBypassReason: cacheBypassReason ?? undefined
            })
        ],
        evidence: {
            report: rankingReport,
            outputPath: relativePathFrom(options.cwd, candidateReportPath),
            sourceInventoryReportPath: relativePathFrom(options.cwd, sourceInventoryReportPath),
            policeReportPath: relativePathFrom(options.cwd, policeReportPath),
            guidanceDriftReportPath: relativePathFrom(options.cwd, guidanceDriftReportPath)
        }
    });
}
function parseCandidatesOptions(argv) {
    const options = {
        action: '',
        cwd: process.cwd(),
        includePatterns: [],
        maxFileLines: 1000,
        limit: 10,
        outDir: path.join('.atm', 'history', 'reports', 'candidates'),
        goal: '',
        noCache: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireOptionValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--include') {
            options.includePatterns.push(requireOptionValue(argv, index, '--include'));
            index += 1;
            continue;
        }
        if (arg === '--max-file-lines') {
            options.maxFileLines = parsePositiveInteger(requireOptionValue(argv, index, '--max-file-lines'), '--max-file-lines');
            index += 1;
            continue;
        }
        if (arg === '--limit') {
            options.limit = parsePositiveInteger(requireOptionValue(argv, index, '--limit'), '--limit');
            index += 1;
            continue;
        }
        if (arg === '--out-dir') {
            options.outDir = requireOptionValue(argv, index, '--out-dir');
            index += 1;
            continue;
        }
        if (arg === '--goal') {
            options.goal = requireOptionValue(argv, index, '--goal');
            index += 1;
            continue;
        }
        if (arg === '--no-cache') {
            options.noCache = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `candidates does not support option ${arg}`, { exitCode: 2 });
        }
        if (!options.action) {
            options.action = arg;
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `Unexpected candidates argument: ${arg}`, { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        action: options.action || 'rank'
    };
}
function expandIncludePatterns(cwd, includePatterns) {
    const output = new Set();
    for (const includePattern of includePatterns) {
        const normalizedPattern = normalizePath(includePattern);
        const baseDirectory = resolveGlobBase(cwd, normalizedPattern);
        if (!existsSync(baseDirectory)) {
            continue;
        }
        const regex = globToRegex(normalizedPattern);
        if (statSync(baseDirectory).isFile()) {
            const relative = normalizePath(path.relative(cwd, baseDirectory));
            if (regex.test(relative)) {
                output.add(relative);
            }
            continue;
        }
        for (const absoluteFilePath of listFilesRecursive(baseDirectory)) {
            const relative = normalizePath(path.relative(cwd, absoluteFilePath));
            if (regex.test(relative)) {
                output.add(relative);
            }
        }
    }
    return [...output].sort((left, right) => left.localeCompare(right));
}
function resolveGlobBase(cwd, normalizedPattern) {
    const segments = normalizedPattern.split('/');
    const baseSegments = [];
    for (const segment of segments) {
        if (segment.includes('*') || segment.includes('?')) {
            break;
        }
        baseSegments.push(segment);
    }
    return path.resolve(cwd, baseSegments.length > 0 ? baseSegments.join('/') : '.');
}
function globToRegex(normalizedPattern) {
    let source = '^';
    for (let index = 0; index < normalizedPattern.length; index += 1) {
        const char = normalizedPattern[index];
        const next = normalizedPattern[index + 1];
        if (char === '*' && next === '*') {
            const after = normalizedPattern[index + 2];
            if (after === '/') {
                source += '(?:.*/)?';
                index += 2;
            }
            else {
                source += '.*';
                index += 1;
            }
            continue;
        }
        if (char === '*') {
            source += '[^/]*';
            continue;
        }
        if (char === '?') {
            source += '[^/]';
            continue;
        }
        source += escapeRegex(char);
    }
    return new RegExp(`${source}$`);
}
function listFilesRecursive(directoryPath) {
    const output = [];
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        if (ignoredDirectoryNames.has(entry.name)) {
            continue;
        }
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            output.push(...listFilesRecursive(absolutePath));
            continue;
        }
        if (entry.isFile()) {
            output.push(absolutePath);
        }
    }
    return output;
}
function readCandidateMetrics(cwd, relativeFilePath) {
    const absolutePath = path.resolve(cwd, relativeFilePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        return [];
    }
    let content = '';
    try {
        content = readFileSync(absolutePath, 'utf8');
    }
    catch {
        return [];
    }
    const functionNames = collectRegexGroup(content, /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm);
    const classNames = collectRegexGroup(content, /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/gm);
    return [{
            filePath: normalizePath(relativeFilePath),
            content,
            lineCount: countLines(content),
            functionNames,
            classNames,
            cliSurfaceCount: countMatches(content, /argparse|click\.|typer\.|sys\.argv|if\s+__name__\s*==\s*['"]__main__['"]/g),
            hardcodedPathCount: countMatches(content, /['"][^'"]*(?:artifacts|pipelines|data|reports|\.jsonl?|\.csv|\.md|[A-Za-z]:\\|\/)[^'"]*['"]/g),
            artifactCouplingSignals: countMatches(content, /\bartifacts?\b|\.jsonl?\b|\.csv\b|\.md\b|Path\(|open\(|write_text|read_text/g),
            subprocessSignals: countMatches(content, /subprocess\.|os\.system|runpy\.|importlib\.import_module/g)
        }];
}
function rankCandidate(metrics, maxFileLines, goal) {
    const functionCount = metrics.functionNames.length;
    const classCount = metrics.classNames.length;
    const score = Math.round(metrics.lineCount
        + functionCount * 25
        + classCount * 18
        + metrics.cliSurfaceCount * 80
        + metrics.hardcodedPathCount * 10
        + metrics.artifactCouplingSignals * 8
        + metrics.subprocessSignals * 120);
    const reasons = [];
    if (metrics.lineCount > maxFileLines)
        reasons.push(`source has ${metrics.lineCount} LOC above threshold ${maxFileLines}`);
    if (functionCount >= 20)
        reasons.push(`source exposes ${functionCount} functions`);
    if (metrics.cliSurfaceCount > 0)
        reasons.push(`script-like CLI surface count ${metrics.cliSurfaceCount}`);
    if (metrics.hardcodedPathCount >= 10)
        reasons.push(`hardcoded path / artifact literal count ${metrics.hardcodedPathCount}`);
    if (metrics.artifactCouplingSignals >= 10)
        reasons.push(`artifact read/write coupling signals ${metrics.artifactCouplingSignals}`);
    if (metrics.subprocessSignals > 0)
        reasons.push(`subprocess or dynamic execution signals ${metrics.subprocessSignals}`);
    if (reasons.length === 0)
        reasons.push('lower-risk candidate retained for comparison');
    const recommendedBehaviors = [
        ...(metrics.lineCount > maxFileLines || functionCount >= 20 || metrics.cliSurfaceCount > 1 ? ['split'] : []),
        ...(metrics.lineCount > maxFileLines || metrics.artifactCouplingSignals >= 10 ? ['atomize'] : []),
        ...(metrics.subprocessSignals > 0 || /run_|loop|orchestr/i.test(path.basename(metrics.filePath)) ? ['infect'] : []),
        ...(/run_|loop|pipeline|orchestr/i.test(path.basename(metrics.filePath)) && functionCount >= 10 ? ['compose'] : [])
    ];
    return {
        rank: 0,
        filePath: metrics.filePath,
        score,
        riskLevel: score >= 2500 ? 'high' : score >= 1000 ? 'medium' : 'low',
        lineCount: metrics.lineCount,
        functionCount,
        classCount,
        cliSurfaceCount: metrics.cliSurfaceCount,
        hardcodedPathCount: metrics.hardcodedPathCount,
        artifactCouplingSignals: metrics.artifactCouplingSignals,
        subprocessSignals: metrics.subprocessSignals,
        recommendedBehaviors: recommendedBehaviors.length > 0 ? [...new Set(recommendedBehaviors)] : ['split'],
        reasons,
        nextDryRunCommand: `node atm.mjs start --cwd . --goal ${quoteCliValue(goal || `Rank and prepare ${metrics.filePath} for ATM legacy candidate review`)} --target-file ${quoteCliValue(metrics.filePath)} --legacy-flow --json`
    };
}
function buildGuidedFallback(cwd) {
    const preferredDocs = detectFrameworkRepoIdentity(cwd).isFrameworkRepo
        ? ['README.md', 'docs/QUICK_START.md']
        : ['README.md', 'docs/QUICK_START.md', 'docs/keep.summary.md'];
    const missingDocs = preferredDocs.filter((relativePath) => !existsSync(path.join(cwd, relativePath)));
    return {
        missingDocs,
        fallbackSources: missingDocs.length > 0
            ? ['README.md', '.atm/runtime/project-probe.json', 'source inventory scan']
            : [],
        continuedOriginalRequest: true
    };
}
function buildGuidanceDriftPolice(cwd, goal, generatedAt) {
    const classification = classifyGuidanceIntent(goal, {
        repositoryRoot: cwd,
        adapterStatus: probeProject(cwd).adapterStatus.status
    });
    const findings = [];
    if (!goal.trim()) {
        findings.push({
            level: 'warning',
            code: 'ATM_GUIDANCE_DRIFT_GOAL_MISSING',
            text: 'Candidate ranking was run without the original user goal, so skill-trigger evidence cannot be audited.'
        });
    }
    else if (classification.matchedIntent !== 'legacy-candidate-ranking') {
        findings.push({
            level: 'warning',
            code: 'ATM_GUIDANCE_SKILL_MISS_CANDIDATE',
            text: 'The original goal did not classify as legacy-candidate-ranking; record a reviewed host-local phrase if this was a legitimate candidate ranking request.'
        });
    }
    else {
        findings.push({
            level: 'info',
            code: 'ATM_GUIDANCE_ROUTE_CONFIRMED',
            text: 'The original goal classified as legacy-candidate-ranking before local source ranking.'
        });
    }
    const shouldSuggestLearning = goal.trim().length > 0 && classification.matchedIntent !== 'legacy-candidate-ranking';
    return {
        schemaId: 'atm.guidanceDriftPoliceReport',
        specVersion: '0.1.0',
        generatedAt,
        goal,
        expectedIntent: 'legacy-candidate-ranking',
        observedIntent: classification.matchedIntent,
        status: findings.some((finding) => finding.level === 'warning') ? 'advisory' : 'pass',
        findings,
        skillMissLearningLoop: {
            status: shouldSuggestLearning ? 'suggested' : 'not-needed',
            lexiconPath: '.atm/guidance/intent-lexicon.json',
            suggestedCommand: shouldSuggestLearning
                ? `node atm.mjs guide learn --phrase ${quoteCliValue(goal)} --intent legacy-candidate-ranking --reason "Guidance Drift Police observed a missed candidate-ranking phrase." --status suggested --cwd . --json`
                : null,
            reviewPolicy: 'Keep learned phrases host-local until repeated evidence and human review justify promotion.'
        }
    };
}
function countLines(content) {
    if (!content)
        return 0;
    return content.split(/\r?\n/).length;
}
function countMatches(content, pattern) {
    return [...content.matchAll(pattern)].length;
}
function collectRegexGroup(content, pattern) {
    return [...content.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}
function requireOptionValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `candidates requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
function parsePositiveInteger(value, optionName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new CliError('ATM_CLI_USAGE', `candidates ${optionName} requires a positive integer (got ${value})`, { exitCode: 2 });
    }
    return parsed;
}
function formatTimestampForPath(value) {
    return value.replace(/[:.]/g, '-');
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}
function quoteCliValue(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function escapeRegex(value) {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
