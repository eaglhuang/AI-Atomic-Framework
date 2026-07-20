// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isTaskDirectionPathCandidate, partitionTaskScope } from '../../task-direction.js';
import { extractPathLikeStringsFromPrompt } from '../../work-channels.js';
import { normalizeOptionalTaskPath } from '../intent-normalizers.js';
import { uniqueSorted } from '../view-projections.js';
import { listFilesRecursive } from './task-card-discovery.js';
export function finalizeImportedTaskSummary(task, cwd) {
    const partition = partitionTaskScope(task, cwd ? { cwd } : undefined);
    return {
        ...task,
        planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
        planningMirrorPaths: partition.targetWork.planningMirrorPaths,
        targetAllowedFiles: partition.targetWork.allowedFiles
    };
}
export function withMirrorSyncOnlyTarget(task) {
    return {
        ...task,
        targetAllowedFiles: []
    };
}
export function withMirrorSyncOnlyTargetQueue(queue, taskId) {
    const rewrite = (task) => task.workItemId === taskId ? withMirrorSyncOnlyTarget(task) : task;
    return {
        ...queue,
        selectedTask: queue.selectedTask ? rewrite(queue.selectedTask) : queue.selectedTask,
        claimableTask: queue.claimableTask && queue.claimableTask.workItemId === taskId ? null : queue.claimableTask,
        tasks: queue.tasks.map(rewrite),
        promptScope: queue.promptScope
            ? {
                ...queue.promptScope,
                selectedTasks: queue.promptScope.selectedTasks.map(rewrite)
            }
            : queue.promptScope
    };
}
export function extractDeclaredTaskPathsFromDocument(taskDocument) {
    const files = new Set();
    for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts']) {
        collectDeclaredTaskPathValues(taskDocument[key], files);
    }
    const source = taskDocument.source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        const sourceRecord = source;
        collectDeclaredTaskPathValues(sourceRecord.path, files);
        collectDeclaredTaskPathValues(sourceRecord.planPath, files);
    }
    for (const key of ['notes', 'summary', 'description', 'acceptance']) {
        collectDeclaredTaskPathValues(taskDocument[key], files);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}
export function extractLinkedSourceTaskArtifactPaths(cwd, sourcePlanPath) {
    if (!sourcePlanPath)
        return [];
    const absolutePlanPath = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
    if (!existsSync(absolutePlanPath))
        return [];
    try {
        return extractTaskArtifactPathsFromMarkdown(cwd, readFileSync(absolutePlanPath, 'utf8'));
    }
    catch {
        return [];
    }
}
function collectDeclaredTaskPathValues(value, files) {
    if (typeof value === 'string') {
        const normalized = normalizeOptionalTaskPath(value);
        if (normalized && isTaskDirectionPathCandidate(normalized)) {
            files.add(normalized);
        }
        for (const candidate of extractPathLikeStringsFromText(value)) {
            files.add(candidate);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectDeclaredTaskPathValues(entry, files);
        }
    }
}
export function extractTaskArtifactPathsFromMarkdown(cwd, text) {
    return uniqueSorted([
        ...extractPathLikeStringsFromText(text),
        ...resolveBareArtifactPathCandidates(cwd, extractBareArtifactFileNames(text)),
        ...extractCommandSurfacePathsFromMarkdown(text)
    ]);
}
export function extractPathLikeStringsFromText(text) {
    const candidates = new Set();
    const matches = text.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|\.github|\.claude|\.cursor|\.gemini)(?:\/[A-Za-z0-9._-]+)+\b|\b(?:atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)\b/g);
    for (const match of matches) {
        const normalized = normalizeOptionalTaskPath(match[0]);
        if (normalized) {
            candidates.add(normalized);
        }
    }
    return [...candidates].sort((left, right) => left.localeCompare(right));
}
function extractBareArtifactFileNames(text) {
    const candidates = new Set();
    const matches = text.matchAll(/(?:^|[\s`"'([>-])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|jsonl|md|csv|tsv|txt|ya?ml|html|xml))(?:$|[\s`"')\]<,.;:])/gmi);
    for (const match of matches) {
        const fileName = match[1]?.trim();
        if (!fileName || fileName.includes('/') || fileName.includes('\\'))
            continue;
        if (fileName.length > 120)
            continue;
        candidates.add(fileName);
    }
    return [...candidates].sort((left, right) => left.localeCompare(right));
}
function resolveBareArtifactPathCandidates(cwd, fileNames) {
    if (fileNames.length === 0)
        return [];
    const output = new Set();
    const knownArtifactFiles = listKnownArtifactFiles(cwd);
    const artifactFilesByBasename = new Map();
    for (const artifactPath of knownArtifactFiles) {
        const key = path.basename(artifactPath).toLowerCase();
        const existing = artifactFilesByBasename.get(key) ?? [];
        existing.push(artifactPath);
        artifactFilesByBasename.set(key, existing);
    }
    for (const fileName of fileNames) {
        for (const candidateName of artifactFileNameVariants(fileName)) {
            for (const existingPath of artifactFilesByBasename.get(candidateName.toLowerCase()) ?? []) {
                output.add(existingPath);
            }
            const atomizationCoveragePath = resolveAtomizationCoverageArtifactPath(candidateName);
            if (atomizationCoveragePath) {
                output.add(atomizationCoveragePath);
            }
        }
    }
    return [...output].sort((left, right) => left.localeCompare(right));
}
function listKnownArtifactFiles(cwd) {
    const roots = [
        'atomic_workbench',
        'artifacts',
        'docs',
        'fixtures',
        'reports',
        'schemas'
    ];
    return uniqueSorted(roots.flatMap((root) => {
        const absoluteRoot = path.join(cwd, root);
        return listFilesRecursive(absoluteRoot, (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            return ['.json', '.jsonl', '.md', '.csv', '.tsv', '.txt', '.yaml', '.yml'].includes(ext);
        }).map((filePath) => path.relative(cwd, filePath).replace(/\\/g, '/'));
    }));
}
function artifactFileNameVariants(fileName) {
    const variants = new Set();
    const normalized = fileName.trim();
    if (!normalized)
        return [];
    variants.add(normalized);
    if (normalized.startsWith('atm-')) {
        variants.add(normalized.slice('atm-'.length));
    }
    return [...variants].sort((left, right) => left.localeCompare(right));
}
function resolveAtomizationCoverageArtifactPath(fileName) {
    const basename = path.basename(fileName);
    const atomizationCoverageArtifacts = new Set([
        'dogfood-score.json',
        'dogfood-score.md',
        'exclusion-inventory.json',
        'generated-fixture-boundaries.json',
        'path-to-atom-map.json',
        'manifest.json'
    ]);
    if (!atomizationCoverageArtifacts.has(basename))
        return null;
    if (basename === 'manifest.json') {
        return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
    }
    return `atomic_workbench/atomization-coverage/${basename}`;
}
function extractCommandSurfacePathsFromMarkdown(text) {
    const paths = new Set();
    for (const match of text.matchAll(/\bnode\s+atm\.mjs\s+(guard|validate)\s+([a-z][a-z0-9-]*)\b/gi)) {
        const command = match[1]?.toLowerCase();
        const topic = match[2]?.toLowerCase();
        if (command === 'guard') {
            paths.add('packages/cli/src/commands/guard.ts');
        }
        if (command === 'validate') {
            paths.add('packages/cli/src/commands/validate.ts');
            addValidateTopicPaths(paths, topic);
        }
    }
    for (const match of text.matchAll(/\bnpm\s+run\s+validate:([a-z][a-z0-9-]*)\b/gi)) {
        addValidateTopicPaths(paths, match[1]?.toLowerCase());
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
}
function addValidateTopicPaths(paths, topic) {
    if (!topic)
        return;
    paths.add('package.json');
    paths.add(`scripts/validate-${topic}.ts`);
}
export function resolveQuickfixScope(prompt) {
    return uniqueSorted([
        ...extractPathLikeStringsFromText(prompt),
        ...extractPathLikeStringsFromPrompt(prompt)
    ]);
}
