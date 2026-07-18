// @ts-nocheck
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathFieldMatches } from '../match-and-sort.js';
import { readConfiguredPlanningRoots } from '../../planning-repo-root.js';
import { resolveCandidatePlanningRoots } from '../planning-root-preference.js';
import { normalizeSearchText } from '../intent-normalizers.js';
import { uniqueSorted } from '../view-projections.js';
export function listTaskCardFiles(cwd) {
    const output = new Set();
    for (const filePath of listRootLevelTaskCardFiles(cwd)) {
        output.add(filePath);
    }
    for (const root of listTaskCardDiscoveryRoots(cwd)) {
        for (const filePath of listFilesRecursive(root, (candidate) => candidate.endsWith('.task.md'))) {
            output.add(filePath);
        }
    }
    return uniqueSorted(Array.from(output));
}
function listRootLevelTaskCardFiles(cwd) {
    return safeReadDir(cwd)
        .filter((entry) => entry.isFile() && entry.name.endsWith('.task.md'))
        .map((entry) => path.join(cwd, entry.name));
}
function listTaskCardDiscoveryRoots(cwd) {
    const relativeRoots = [
        'docs',
        'atomic_workbench',
        'specs',
        'schemas',
        'templates',
        'integrations',
        'examples',
        'tests',
        'packages',
        'scripts',
        '.agents',
        '.github',
        '.claude',
        '.cursor',
        '.gemini'
    ];
    return uniqueSorted(relativeRoots
        .map((entry) => path.join(cwd, entry))
        .filter((entry) => existsSync(entry)));
}
export function listPromptScopedExternalTaskCardFiles(cwd, intent, planningRoots = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
}).roots) {
    if (!intent?.userPrompt || !intent.taskScopeMentioned)
        return [];
    const output = new Set();
    for (const root of planningRoots) {
        const markdownFiles = listFilesRecursive(root, (filePath) => filePath.endsWith('.md') && !filePath.endsWith('.task.md'));
        for (const planPath of markdownFiles) {
            if (!planFileMatchesPrompt(cwd, planPath, intent))
                continue;
            const taskDir = path.join(path.dirname(planPath), 'tasks');
            for (const taskPath of listFilesRecursive(taskDir, (filePath) => filePath.endsWith('.task.md'))) {
                output.add(taskPath);
            }
        }
        if (intent.mentionedTaskIds.length > 0 || intent.taskRootHints.length > 0) {
            for (const taskPath of listFilesRecursive(root, (filePath) => filePath.endsWith('.task.md'))) {
                if (taskCardPathMatchesIntent(taskPath, intent)) {
                    output.add(taskPath);
                }
            }
        }
    }
    return uniqueSorted(Array.from(output));
}
export function isTaskPathUnderPreferredPlanningRoots(cwd, taskPath) {
    const absoluteTaskPath = path.resolve(cwd, taskPath);
    const resolution = resolveCandidatePlanningRoots(cwd, {
        configuredRoots: readConfiguredPlanningRoots(cwd)
    });
    return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`));
}
function planFileMatchesPrompt(cwd, planPath, intent) {
    const prompt = normalizeSearchText(intent.userPrompt ?? '');
    const relativePlanPath = path.relative(cwd, planPath).replace(/\\/g, '/');
    if (intent.mentionedPlanPaths.some((hint) => pathFieldMatches(relativePlanPath, hint) || pathFieldMatches(planPath, hint))) {
        return true;
    }
    const stem = normalizeSearchText(path.basename(planPath).replace(/\.[^.]+$/, ''));
    if (stem.length >= 8 && prompt.includes(stem))
        return true;
    const title = readMarkdownTitle(planPath);
    const normalizedTitle = title ? normalizeSearchText(title) : '';
    if (normalizedTitle.length >= 8 && prompt.includes(normalizedTitle))
        return true;
    return false;
}
function readMarkdownTitle(filePath) {
    try {
        const head = readFileSync(filePath, 'utf8').split(/\r?\n/, 40);
        for (const line of head) {
            const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
            if (match?.[1]?.trim())
                return match[1].trim();
        }
    }
    catch {
        return null;
    }
    return null;
}
function taskCardPathMatchesIntent(taskPath, intent) {
    const normalizedTaskPath = normalizeSearchText(taskPath);
    const basename = path.basename(taskPath).replace(/\.task\.md$/i, '').toUpperCase();
    if (intent.mentionedTaskIds.some((taskId) => basename === taskId || normalizedTaskPath.includes(normalizeSearchText(taskId)))) {
        return true;
    }
    return intent.taskRootHints.some((hint) => {
        const normalizedHint = normalizeSearchText(hint);
        return normalizedHint.length > 0 && normalizedTaskPath.includes(normalizedHint);
    });
}
export function listFilesRecursive(directoryPath, predicate) {
    if (!existsSync(directoryPath))
        return [];
    const stats = safeStat(directoryPath);
    if (!stats)
        return [];
    if (stats.isFile())
        return predicate(directoryPath) ? [directoryPath] : [];
    const output = [];
    for (const entry of safeReadDir(directoryPath)) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory() && shouldSkipRecursiveDiscoveryDirectory(absolutePath))
            continue;
        if (entry.isDirectory()) {
            output.push(...listFilesRecursive(absolutePath, predicate));
        }
        else if (entry.isFile() && predicate(absolutePath)) {
            output.push(absolutePath);
        }
    }
    return output;
}
export function findNearbyPlanPaths(cwd, taskPath) {
    const taskDir = path.dirname(taskPath);
    const parent = path.basename(taskDir).toLowerCase() === 'tasks' ? path.dirname(taskDir) : taskDir;
    if (!existsSync(parent))
        return [];
    return safeReadDir(parent)
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.task.md'))
        .map((entry) => path.relative(cwd, path.join(parent, entry.name)).replace(/\\/g, '/'));
}
function safeReadDir(directoryPath) {
    try {
        return readdirSync(directoryPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function safeStat(filePath) {
    try {
        return statSync(filePath);
    }
    catch {
        return null;
    }
}
function shouldSkipRecursiveDiscoveryDirectory(directoryPath) {
    const normalized = directoryPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const ignoredSegmentNames = new Set([
        '.git',
        'node_modules',
        'dist',
        'build',
        'release',
        '.atm-temp',
        'scratch',
        'tmp',
        'temp',
        'library',
        'coverage',
        '.next',
        '.turbo'
    ]);
    const basename = segments[segments.length - 1] ?? '';
    if (ignoredSegmentNames.has(basename))
        return true;
    return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}
