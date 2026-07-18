import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentsRootEntryBlock, createReadmeRootEntryBlock, patchManagedRootEntry } from './root-entry-patching.js';
const repoRoot = resolveBundledRepoRoot(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const templateRoot = path.join(repoRoot, 'templates', 'root-drop');
const rootDropScriptNames = [
    'atm-next',
    'atm-orient',
    'atm-create',
    'atm-lock',
    'atm-evidence',
    'atm-upgrade-scan',
    'atm-handoff'
];
const rootDropScriptTemplateFiles = rootDropScriptNames.flatMap((scriptName) => [
    { source: path.join('.atm', 'scripts', 'sh', `${scriptName}.sh`), target: path.join('.atm', 'scripts', 'sh', `${scriptName}.sh`) },
    { source: path.join('.atm', 'scripts', 'ps', `${scriptName}.ps1`), target: path.join('.atm', 'scripts', 'ps', `${scriptName}.ps1`) }
]);
const rootAgentsEntryStart = '<!-- ATM ROOT ENTRY:START -->';
const rootAgentsEntryEnd = '<!-- ATM ROOT ENTRY:END -->';
const rootReadmeEntryStart = '<!-- ATM README ENTRY:START -->';
const rootReadmeEntryEnd = '<!-- ATM README ENTRY:END -->';
function resolveBundledRepoRoot(start, fallback) {
    let current = path.resolve(start);
    while (true) {
        if (existsSync(path.join(current, 'templates', 'root-drop'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(start, fallback);
        }
        current = parent;
    }
}
export function readProjectName(cwd) {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) {
        return null;
    }
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const name = typeof pkg.name === 'string' ? pkg.name.trim() : '';
    return name.length > 0 ? name : null;
}
export function probeRepository(cwd, recommendedPrompt) {
    const packageJsonPath = path.join(cwd, 'package.json');
    const packageJson = existsSync(packageJsonPath)
        ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        : null;
    const scripts = packageJson?.scripts || {};
    const hasIndexHtml = existsSync(path.join(cwd, 'index.html'));
    const hasArticlesIndex = existsSync(path.join(cwd, 'articles', 'index.html'));
    const hasAssetsCss = existsSync(path.join(cwd, 'assets', 'css'));
    const topLevelEntries = existsSync(cwd)
        ? readdirSync(cwd, { withFileTypes: true }).map((entry) => entry.name).sort()
        : [];
    let repositoryKind = 'generic-repository';
    if (packageJson) {
        repositoryKind = 'javascript-package';
    }
    else if (hasIndexHtml || hasArticlesIndex || hasAssetsCss) {
        repositoryKind = 'static-site';
    }
    return {
        schemaVersion: 'atm.projectProbe.v0.1',
        generatedAt: new Date().toISOString(),
        repositoryKind,
        packageManager: detectPackageManager(cwd, packageJson),
        hostWorkflow: packageJson ? 'script-driven' : (repositoryKind === 'static-site' ? 'file-publish' : 'manual'),
        sourceControl: existsSync(path.join(cwd, '.git')) ? 'git' : 'filesystem',
        detectedFiles: topLevelEntries,
        commands: {
            test: scripts.test ? createPackageManagerCommand(cwd, packageJson, 'test') : null,
            typecheck: scripts.typecheck ? createPackageManagerCommand(cwd, packageJson, 'typecheck') : null,
            lint: scripts.lint ? createPackageManagerCommand(cwd, packageJson, 'lint') : null
        },
        recommendedPrompt
    };
}
function detectPackageManager(cwd, packageJson) {
    if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (existsSync(path.join(cwd, 'yarn.lock'))) {
        return 'yarn';
    }
    if (existsSync(path.join(cwd, 'package-lock.json')) || packageJson) {
        return 'npm';
    }
    return 'none';
}
function createPackageManagerCommand(cwd, packageJson, scriptName) {
    const manager = detectPackageManager(cwd, packageJson);
    if (manager === 'pnpm') {
        return `pnpm run ${scriptName}`;
    }
    if (manager === 'yarn') {
        return `yarn ${scriptName}`;
    }
    return `npm run ${scriptName}`;
}
export function ensureDirectory(directoryPath, cwd, created, unchanged) {
    if (existsSync(directoryPath)) {
        unchanged.push(relativePathFrom(cwd, directoryPath));
        return;
    }
    mkdirSync(directoryPath, { recursive: true });
    created.push(relativePathFrom(cwd, directoryPath));
}
export function installPinnedRunner(cwd, force, created, unchanged) {
    const runnerPath = path.join(cwd, 'atm.mjs');
    const metadataPath = path.join(cwd, '.atm', 'runtime', 'pinned-runner.json');
    const metadataRelativePath = '.atm/runtime/pinned-runner.json';
    const generatedAt = readPinnedRunnerGeneratedAt(metadataPath) ?? new Date().toISOString();
    const source = resolvePinnedRunnerSource();
    if (source === null) {
        const metadata = {
            schemaVersion: 'atm.pinnedRunner.v0.1',
            runnerPath: 'atm.mjs',
            metadataPath: metadataRelativePath,
            command: 'node atm.mjs next --prompt "<current user prompt>" --json',
            status: 'source-unavailable',
            sourceKind: 'unavailable',
            frameworkVersion: '0.0.0',
            generatedAt,
            reason: 'No pinned onefile launcher source was available. Run bootstrap from release/atm-onefile/atm.mjs or set ATM_PINNED_RUNNER_SOURCE.'
        };
        writeJsonIfChanged(metadataPath, metadata, cwd, created, unchanged);
        return metadata;
    }
    const sourceBytes = readFileSync(source.path);
    const sourceSha256 = sha256Bytes(sourceBytes);
    const sourceStats = statSync(source.path);
    const existingSha256 = existsSync(runnerPath) ? sha256Bytes(readFileSync(runnerPath)) : undefined;
    let status;
    if (existingSha256 === sourceSha256) {
        status = 'unchanged';
        unchanged.push('atm.mjs');
    }
    else if (existingSha256 && !force) {
        status = 'skipped-existing-different';
        unchanged.push('atm.mjs');
    }
    else {
        mkdirSync(path.dirname(runnerPath), { recursive: true });
        copyFileSync(source.path, runnerPath);
        syncExecutableMode(source.path, runnerPath);
        status = existingSha256 ? 'replaced' : 'installed';
        created.push('atm.mjs');
    }
    const metadata = {
        schemaVersion: 'atm.pinnedRunner.v0.1',
        runnerPath: 'atm.mjs',
        metadataPath: metadataRelativePath,
        command: 'node atm.mjs next --prompt "<current user prompt>" --json',
        status,
        sourceKind: source.kind,
        sourcePath: describePinnedRunnerSource(source),
        sha256: sourceSha256,
        existingSha256,
        sizeBytes: sourceStats.size,
        frameworkVersion: '0.0.0',
        generatedAt,
        ...(status === 'skipped-existing-different'
            ? { reason: 'A different root atm.mjs already exists. Re-run bootstrap with --force to replace it with the pinned runner.' }
            : {})
    };
    writeJsonIfChanged(metadataPath, metadata, cwd, created, unchanged);
    return metadata;
}
function resolvePinnedRunnerSource() {
    const explicit = resolveExistingFile(process.env.ATM_PINNED_RUNNER_SOURCE);
    if (explicit) {
        return { path: explicit, kind: 'explicit-env' };
    }
    const onefileLauncher = resolveExistingFile(process.env.ATM_ONEFILE_LAUNCHER_PATH);
    if (onefileLauncher) {
        return { path: onefileLauncher, kind: 'onefile-launcher' };
    }
    const releaseOnefile = resolveExistingFile(path.join(repoRoot, 'release', 'atm-onefile', 'atm.mjs'));
    if (releaseOnefile) {
        return { path: releaseOnefile, kind: 'release-onefile' };
    }
    return null;
}
function resolveExistingFile(filePath) {
    if (!filePath) {
        return null;
    }
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) {
        return null;
    }
    return statSync(resolved).isFile() ? resolved : null;
}
export function sha256Bytes(value) {
    return createHash('sha256').update(value).digest('hex');
}
function syncExecutableMode(sourcePath, targetPath) {
    if (process.platform === 'win32') {
        return;
    }
    try {
        chmodSync(targetPath, statSync(sourcePath).mode & 0o777);
    }
    catch {
        // Ignore mode sync failures; the runner is still invokable through `node atm.mjs`.
    }
}
function describePinnedRunnerSource(source) {
    if (source.kind === 'onefile-launcher') {
        return 'ATM_ONEFILE_LAUNCHER_PATH';
    }
    if (source.kind === 'explicit-env') {
        return 'ATM_PINNED_RUNNER_SOURCE';
    }
    const relative = path.relative(repoRoot, source.path).replace(/\\/g, '/');
    return relative.startsWith('..') ? source.path : relative;
}
function writeJsonIfChanged(targetPath, value, cwd, created, unchanged) {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    const relativePath = relativePathFrom(cwd, targetPath);
    if (existsSync(targetPath) && readFileSync(targetPath, 'utf8') === next) {
        unchanged.push(relativePath);
        return;
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, next, 'utf8');
    created.push(relativePath);
}
function readPinnedRunnerGeneratedAt(metadataPath) {
    if (!existsSync(metadataPath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
        return typeof parsed?.generatedAt === 'string' && parsed.generatedAt.length > 0 ? parsed.generatedAt : null;
    }
    catch {
        return null;
    }
}
export function writeTemplate(sourcePath, targetPath, tokens, cwd, force, created, unchanged) {
    const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
    writeText(targetPath, rendered, cwd, force, created, unchanged);
}
export function writeAgentInstructionsTemplate(sourcePath, targetPath, tokens, cwd, force, created, unchanged) {
    const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
    if (!existsSync(targetPath)) {
        writeText(targetPath, rendered, cwd, force, created, unchanged);
        return;
    }
    patchManagedRootEntry({
        targetPath,
        cwd,
        force,
        created,
        unchanged,
        startMarker: rootAgentsEntryStart,
        endMarker: rootAgentsEntryEnd,
        block: createAgentsRootEntryBlock(tokens),
        insertion: 'after-frontmatter'
    });
}
export function patchReadmeEntry(targetPath, cwd, force, created, unchanged) {
    if (!existsSync(targetPath)) {
        return;
    }
    patchManagedRootEntry({
        targetPath,
        cwd,
        force,
        created,
        unchanged,
        startMarker: rootReadmeEntryStart,
        endMarker: rootReadmeEntryEnd,
        block: createReadmeRootEntryBlock(),
        insertion: 'after-title'
    });
}
export function writeRootDropScripts(cwd, force, created, unchanged) {
    for (const scriptFile of rootDropScriptTemplateFiles) {
        writeTemplate(path.join(templateRoot, scriptFile.source), path.join(cwd, scriptFile.target), {}, cwd, force, created, unchanged);
    }
}
export function writeJson(targetPath, value, cwd, force, created, unchanged) {
    if (existsSync(targetPath) && !force) {
        unchanged.push(relativePathFrom(cwd, targetPath));
        return;
    }
    writeJsonFile(targetPath, value);
    created.push(relativePathFrom(cwd, targetPath));
}
export function writeText(targetPath, value, cwd, force, created, unchanged) {
    if (existsSync(targetPath) && !force) {
        unchanged.push(relativePathFrom(cwd, targetPath));
        return;
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, value, 'utf8');
    created.push(relativePathFrom(cwd, targetPath));
}
export function renderTemplate(template, tokens) {
    let rendered = stripTemplateHeader(template);
    for (const [token, value] of Object.entries(tokens)) {
        rendered = rendered.replaceAll(`{{${token}}}`, value);
    }
    return rendered;
}
function stripTemplateHeader(template) {
    return template.replace(/^\s*<!--\s*ATM TEMPLATE:[\s\S]*?-->\s*/i, '');
}
export function capabilityResult(text, artifacts = [], evidence = []) {
    return {
        ok: true,
        messages: [text],
        artifacts,
        evidence
    };
}
export function resolveRepoPath(repositoryRoot, filePath) {
    return path.resolve(repositoryRoot, filePath);
}
export function relativePathFrom(basePath, absolutePath) {
    return path.relative(basePath, absolutePath).replace(/\\/g, '/');
}
export function normalizeRelativePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}
export function writeJsonFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function readJsonFile(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function readUnknownFile(filePath) {
    if (filePath.endsWith('.json')) {
        return readJsonFile(filePath);
    }
    return readFileSync(filePath, 'utf8');
}
export function writeUnknownFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (typeof value === 'string') {
        writeFileSync(filePath, value, 'utf8');
        return;
    }
    writeJsonFile(filePath, value);
}
export function withJsonExtension(name) {
    return name.endsWith('.json') ? name : `${name}.json`;
}
export function appendManifestRecord(filePath, record) {
    const manifest = readManifestRecords(filePath).filter((entry) => entry.artifactPath !== record.artifactPath);
    manifest.push(record);
    writeJsonFile(filePath, manifest);
}
export function readManifestRecords(filePath) {
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
export function writeContentFile(filePath, content) {
    if (typeof content === 'string') {
        writeFileSync(filePath, content, 'utf8');
        return;
    }
    writeFileSync(filePath, content);
}
export function readDocumentIndex(documentIndexPath) {
    const filePath = path.join(documentIndexPath, 'documents.json');
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
export function listFilesRecursive(directoryPath) {
    if (!existsSync(directoryPath)) {
        return [];
    }
    const results = [];
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(absolutePath));
            continue;
        }
        if (entry.isFile()) {
            results.push(absolutePath);
        }
    }
    return results.sort((left, right) => left.localeCompare(right));
}
export function readEvidenceDocument(filePath) {
    if (!existsSync(filePath)) {
        return { wrapper: null, evidence: [] };
    }
    const parsed = readJsonFile(filePath);
    if (Array.isArray(parsed)) {
        return { wrapper: null, evidence: parsed };
    }
    if (parsed && typeof parsed === 'object') {
        const wrapper = parsed;
        if (Array.isArray(wrapper.evidence)) {
            return { wrapper, evidence: wrapper.evidence };
        }
        if (isEvidenceRecord(wrapper)) {
            return { wrapper: null, evidence: [wrapper] };
        }
        return { wrapper, evidence: [] };
    }
    return { wrapper: null, evidence: [] };
}
export function readEvidenceRecords(filePath) {
    return readEvidenceDocument(filePath).evidence;
}
export function isEvidenceRecord(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return typeof candidate.evidenceKind === 'string'
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.artifactPaths);
}
export function normalizeWorkItem(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    const workItemId = String(candidate.workItemId ?? candidate.id ?? candidate.taskId ?? '').trim();
    const title = String(candidate.title ?? '').trim();
    const status = String(candidate.status ?? '').trim();
    if (!workItemId || !title || !status) {
        return null;
    }
    return {
        workItemId,
        title,
        status: status
    };
}
export function createEmptyRegistry(timestamp) {
    return {
        schemaId: 'atm.registry',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Local governance registry initialized.'
        },
        registryId: 'ATM-LOCAL-REGISTRY',
        generatedAt: timestamp,
        entries: []
    };
}
