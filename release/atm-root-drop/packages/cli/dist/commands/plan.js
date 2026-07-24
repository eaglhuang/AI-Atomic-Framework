import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, relativePathFrom } from './shared.js';
import { PLANNING_REPO_ROOT_ENV, resolvePlanningRepoRootConfig } from './planning-repo-root.js';
const PLAN_COMMAND = 'plan';
const SERIES_REGISTRY_FILE = 'series-registry.json';
const ATM_PLANNING_ROOT_ENV = 'ATM_PLANNING_ROOT';
export async function runPlan(argv) {
    const options = parsePlanArgs(argv);
    if (!options.action) {
        throw usage('plan requires an action: series, card, or doc.');
    }
    if (options.dryRun === options.write) {
        throw usage('plan commands require exactly one of --dry-run or --write.');
    }
    if (options.action === 'series' && options.subaction === 'register') {
        return runSeriesRegister(options);
    }
    if (options.action === 'doc' && options.subaction === 'create') {
        return runDocCreate(options);
    }
    if (options.action === 'card' && options.subaction === 'create') {
        return runCardCreate(options);
    }
    throw usage(`unsupported plan action: ${[options.action, options.subaction].filter(Boolean).join(' ')}`);
}
function runSeriesRegister(options) {
    const planningRoot = resolvePlanningRoot(options);
    const registry = readSeriesRegistry(planningRoot);
    const prefix = normalizeTaskPrefix(required(options.prefix, '--prefix'));
    const series = normalizeSeriesKey(options.series ?? prefix);
    const familyDir = normalizeFamilyDir(required(options.familyDir, '--family-dir'));
    const planDocs = uniqueSorted([required(options.plan, '--plan')].map(normalizeStoredPath));
    const approvedBy = options.approvedBy ?? 'owner';
    const approvedAt = new Date().toISOString();
    if (!options.ownerApproved) {
        throw new CliError('ATM_PLAN_SERIES_OWNER_APPROVAL_REQUIRED', 'plan series register requires --owner-approved.', {
            exitCode: 1,
            details: {
                requiredFlag: '--owner-approved',
                suggestedCommand: `node atm.mjs plan series register --prefix ${prefix} --family-dir ${familyDir} --plan ${planDocs[0]} --owner-approved --write --json`
            }
        });
    }
    for (const planDoc of planDocs) {
        const planPath = path.join(planningRoot, planDoc);
        if (!existsSync(planPath) || !statSync(planPath).isFile()) {
            throw new CliError('ATM_PLAN_SERIES_PLAN_MISSING', `registered series plan document is missing: ${planDoc}`, {
                exitCode: 1,
                details: { planDoc, planningRoot }
            });
        }
    }
    const existing = findSeries(registry, series);
    const entry = {
        ...(existing ?? {}),
        series,
        prefix,
        familyDir,
        planDocs: uniqueSorted([...(existing?.planDocs ?? []), ...planDocs]),
        status: normalizeSeriesStatus(options.status),
        approvedBy,
        approvedAt,
        createdByCommand: 'atm plan series register',
        creationSeal: buildCreationSeal({
            command: 'atm plan series register',
            planningRoot,
            relativePath: SERIES_REGISTRY_FILE,
            content: `${series}\n${prefix}\n${familyDir}\n${planDocs.join('\n')}`
        })
    };
    const nextRegistry = upsertSeries(registry, entry, planningRoot);
    const registryPath = path.join(planningRoot, SERIES_REGISTRY_FILE);
    const writtenPaths = options.write
        ? writeSeriesRegistry(registryPath, nextRegistry, [path.join(planningRoot, familyDir), path.join(planningRoot, familyDir, 'tasks')])
        : [];
    return makeResult({
        ok: true,
        command: PLAN_COMMAND,
        cwd: options.cwd,
        messages: [message('info', options.write ? 'ATM_PLAN_SERIES_REGISTERED' : 'ATM_PLAN_SERIES_REGISTER_DRY_RUN', `${series} maps to ${familyDir}.`)],
        evidence: {
            action: 'series register',
            dryRun: options.dryRun,
            planningRoot,
            registryPath: relativePathFrom(options.cwd, registryPath),
            entry,
            writtenPaths: writtenPaths.map((entryPath) => relativePathFrom(options.cwd, entryPath))
        }
    });
}
function runDocCreate(options) {
    const planningRoot = resolvePlanningRoot(options);
    const title = required(options.title, '--title');
    const familyDir = normalizeFamilyDir(options.familyDir ?? resolveFamilyDirFromSeries(planningRoot, options.series));
    const docName = normalizeDocName(options.docName ?? `${slugify(title)}.md`);
    const relativePath = normalizeStoredPath(path.join(familyDir, docName));
    const absolutePath = path.join(planningRoot, relativePath);
    const body = renderPlanDoc({
        title,
        familyDir,
        planningRoot,
        relativePath,
        command: 'atm plan doc create'
    });
    const writtenPaths = options.write ? writeTextNewFile(absolutePath, body) : [];
    const registryUpdate = options.series
        ? maybeAddPlanDocToRegistry(planningRoot, options.series, relativePath, options.write)
        : null;
    return makeResult({
        ok: true,
        command: PLAN_COMMAND,
        cwd: options.cwd,
        messages: [message('info', options.write ? 'ATM_PLAN_DOC_CREATED' : 'ATM_PLAN_DOC_CREATE_DRY_RUN', `${relativePath} is ready.`)],
        evidence: {
            action: 'doc create',
            dryRun: options.dryRun,
            planningRoot,
            path: relativePathFrom(options.cwd, absolutePath),
            relativePath,
            registryUpdate,
            writtenPaths: writtenPaths.map((entryPath) => relativePathFrom(options.cwd, entryPath))
        }
    });
}
function runCardCreate(options) {
    const planningRoot = resolvePlanningRoot(options);
    const title = required(options.title, '--title');
    const series = required(options.series, '--series');
    const registry = readSeriesRegistry(planningRoot);
    const entry = findSeries(registry, series);
    if (!entry) {
        throw new CliError('ATM_PLAN_SERIES_NOT_REGISTERED', `series is not registered: ${series}`, {
            exitCode: 1,
            details: {
                series,
                registryPath: path.join(planningRoot, SERIES_REGISTRY_FILE),
                suggestedCommand: `node atm.mjs plan series register --prefix TASK-${normalizeSeriesKey(series)} --family-dir <family-dir> --plan <plan.md> --owner-approved --write --json`
            }
        });
    }
    const taskId = options.taskId ?? nextTaskId(planningRoot, entry);
    const fileName = `${taskId}-${slugify(title)}.task.md`;
    const relativePath = normalizeStoredPath(options.output ?? path.join(entry.familyDir, 'tasks', fileName));
    const absolutePath = path.join(planningRoot, relativePath);
    const planDoc = entry.planDocs[0] ?? '';
    const body = renderTaskCard({
        taskId,
        title,
        status: 'planned',
        relatedPlan: planDoc,
        planningRepo: path.basename(path.dirname(planningRoot)),
        targetRepo: options.targetRepo ?? 'AI-Atomic-Framework',
        closureAuthority: options.closureAuthority ?? 'target_repo',
        planningRoot,
        relativePath,
        command: 'atm plan card create'
    });
    const writtenPaths = options.write ? writeTextNewFile(absolutePath, body) : [];
    return makeResult({
        ok: true,
        command: PLAN_COMMAND,
        cwd: options.cwd,
        messages: [message('info', options.write ? 'ATM_PLAN_CARD_CREATED' : 'ATM_PLAN_CARD_CREATE_DRY_RUN', `${taskId} is ready in ${relativePath}.`)],
        evidence: {
            action: 'card create',
            dryRun: options.dryRun,
            planningRoot,
            taskId,
            series: entry,
            path: relativePathFrom(options.cwd, absolutePath),
            relativePath,
            writtenPaths: writtenPaths.map((entryPath) => relativePathFrom(options.cwd, entryPath))
        }
    });
}
function parsePlanArgs(argv) {
    const positionals = [];
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token.startsWith('--')) {
            if (['--dry-run', '--write', '--owner-approved'].includes(token)) {
                options[token.slice(2)] = true;
                continue;
            }
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw usage(`plan requires a value for ${token}`);
            }
            options[token.slice(2)] = value;
            index += 1;
            continue;
        }
        positionals.push(token);
    }
    return {
        cwd: path.resolve(String(options.cwd ?? process.cwd())),
        action: positionals[0] ?? null,
        subaction: positionals[1] ?? null,
        dryRun: options['dry-run'] === true,
        write: options.write === true,
        planningRoot: stringOption(options['planning-root']),
        series: stringOption(options.series),
        prefix: stringOption(options.prefix),
        familyDir: stringOption(options['family-dir']),
        plan: stringOption(options.plan),
        title: stringOption(options.title),
        docName: stringOption(options['doc-name']),
        taskId: stringOption(options['task-id']),
        output: stringOption(options.output),
        ownerApproved: options['owner-approved'] === true,
        approvedBy: stringOption(options['approved-by']),
        status: stringOption(options.status),
        targetRepo: stringOption(options['target-repo']),
        closureAuthority: stringOption(options['closure-authority'])
    };
}
function resolvePlanningRoot(options) {
    const explicit = options.planningRoot ?? process.env[ATM_PLANNING_ROOT_ENV] ?? process.env[PLANNING_REPO_ROOT_ENV] ?? null;
    const candidates = explicit ? [explicit] : resolvePlanningRepoRootConfig(options.cwd).effectiveRoots;
    for (const candidate of candidates) {
        const resolved = path.resolve(options.cwd, candidate);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
            const nested = path.join(resolved, 'docs', 'ai_atomic_framework');
            return existsSync(nested) && statSync(nested).isDirectory() ? nested : resolved;
        }
    }
    throw new CliError('ATM_PLAN_PLANNING_ROOT_MISSING', 'planning root not found.', {
        exitCode: 1,
        details: {
            env: [ATM_PLANNING_ROOT_ENV, PLANNING_REPO_ROOT_ENV],
            suggestedCommand: 'node atm.mjs plan series register --planning-root <repo-or-docs-ai-atomic-framework> ... --dry-run --json'
        }
    });
}
function readSeriesRegistry(planningRoot) {
    const registryPath = path.join(planningRoot, SERIES_REGISTRY_FILE);
    if (!existsSync(registryPath)) {
        return {
            schemaId: 'atm.seriesRegistry.v1',
            generatedAt: new Date().toISOString(),
            baseDir: '.',
            series: []
        };
    }
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    if (parsed.schemaId !== 'atm.seriesRegistry.v1' || !Array.isArray(parsed.series)) {
        throw new CliError('ATM_PLAN_SERIES_REGISTRY_INVALID', 'series-registry.json is not atm.seriesRegistry.v1.', {
            exitCode: 1,
            details: { registryPath }
        });
    }
    return parsed;
}
function writeSeriesRegistry(registryPath, registry, dirs = []) {
    for (const dir of dirs)
        mkdirSync(dir, { recursive: true });
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    return [registryPath];
}
function upsertSeries(registry, entry, planningRoot) {
    const filtered = registry.series.filter((candidate) => normalizeSeriesKey(candidate.series) !== entry.series && normalizeTaskPrefix(candidate.prefix) !== entry.prefix);
    return {
        ...registry,
        generatedAt: new Date().toISOString(),
        baseDir: relativePathFrom(planningRoot, planningRoot) || '.',
        series: [...filtered, entry].sort((left, right) => left.series.localeCompare(right.series))
    };
}
function findSeries(registry, rawSeries) {
    const key = normalizeSeriesKey(rawSeries ?? '');
    const prefix = rawSeries ? normalizeTaskPrefix(rawSeries) : '';
    return registry.series.find((entry) => normalizeSeriesKey(entry.series) === key || normalizeTaskPrefix(entry.prefix) === prefix) ?? null;
}
function resolveFamilyDirFromSeries(planningRoot, rawSeries) {
    if (!rawSeries)
        throw usage('doc create requires either --family-dir or --series.');
    const entry = findSeries(readSeriesRegistry(planningRoot), rawSeries);
    if (!entry)
        throw new CliError('ATM_PLAN_SERIES_NOT_REGISTERED', `series is not registered: ${rawSeries}`, { exitCode: 1 });
    return entry.familyDir;
}
function maybeAddPlanDocToRegistry(planningRoot, rawSeries, planDoc, write) {
    const registry = readSeriesRegistry(planningRoot);
    const entry = findSeries(registry, rawSeries);
    if (!entry)
        return { status: 'series-not-registered', series: rawSeries };
    const nextEntry = { ...entry, planDocs: uniqueSorted([...entry.planDocs, planDoc]) };
    const nextRegistry = upsertSeries(registry, nextEntry, planningRoot);
    if (write)
        writeSeriesRegistry(path.join(planningRoot, SERIES_REGISTRY_FILE), nextRegistry);
    return { status: write ? 'updated' : 'dry-run', series: entry.series, planDoc };
}
function nextTaskId(planningRoot, entry) {
    const tasksDir = path.join(planningRoot, entry.familyDir, 'tasks');
    const matcher = new RegExp(`^${escapeRegExp(entry.prefix)}-(\\d{4})\\b`, 'i');
    let max = 0;
    if (existsSync(tasksDir)) {
        for (const name of readdirSync(tasksDir)) {
            const match = name.match(matcher);
            if (match)
                max = Math.max(max, Number(match[1]));
        }
    }
    return `${entry.prefix}-${String(max + 1).padStart(4, '0')}`;
}
function renderPlanDoc(input) {
    const withoutSeal = [
        '---',
        `doc_id: pending`,
        `title: ${input.title}`,
        `status: active`,
        `family_dir: ${input.familyDir}`,
        `createdByCommand: ${input.command}`,
        '---',
        '',
        `# ${input.title}`,
        '',
        '## Purpose',
        '',
        'This plan is the approved source document for a registered ATM planning family.',
        '',
        '## Scope',
        '',
        '- Register the family through `atm plan series register`.',
        '- Create future plans and task cards through `atm plan doc create` and `atm plan card create`.',
        '',
        '## ErrorCode Registry Migration Note',
        '',
        'If this family owns error governance, keep the canonical `docs/governance/error-code-registry.json` in place until a governed migration task updates emitters, generators, tests, and documentation together.',
        ''
    ].join('\n');
    const seal = buildCreationSeal({ command: input.command, planningRoot: input.planningRoot, relativePath: input.relativePath, content: withoutSeal });
    return withCreationSeal(withoutSeal, seal);
}
function renderTaskCard(input) {
    const withoutSeal = [
        '---',
        `task_id: ${input.taskId}`,
        `title: ${input.title}`,
        `status: ${input.status}`,
        `owner: unassigned`,
        `priority: P2`,
        `depends_on: []`,
        'causalGraph:',
        '  causalDependencies: []',
        '  startConditions: []',
        '  softRelations: []',
        '  changedPublicSeams: []',
        '  causalImpactEdges: []',
        '  parallelFrontierInputs: []',
        '  validatorReferences: []',
        '  phaseOwner: null',
        `related_plan: ${input.relatedPlan}`,
        `planning_repo: ${input.planningRepo}`,
        `target_repo: ${input.targetRepo}`,
        `closure_authority: ${input.closureAuthority}`,
        'scopePaths: []',
        'deliverables: []',
        'validators: []',
        'errorCodes: []',
        `createdByCommand: ${input.command}`,
        '---',
        '',
        `# ${input.taskId} ${input.title}`,
        '',
        '## Intent',
        '',
        'TBD.',
        '',
        '## Acceptance',
        '',
        '- [ ] Deliverables and validators are filled before import or implementation.',
        ''
    ].join('\n');
    const seal = buildCreationSeal({ command: input.command, planningRoot: input.planningRoot, relativePath: input.relativePath, content: withoutSeal });
    return withCreationSeal(withoutSeal, seal);
}
function withCreationSeal(content, seal) {
    return `${content.trimEnd()}\n\n<!-- atmPlanningCreationSeal ${JSON.stringify(seal)} -->\n`;
}
function buildCreationSeal(input) {
    return {
        schemaId: 'atm.planningCreationSeal.v1',
        command: input.command,
        createdAt: new Date().toISOString(),
        planningRoot: input.planningRoot.replace(/\\/g, '/'),
        relativePath: normalizeStoredPath(input.relativePath),
        contentDigest: `sha256:${createHash('sha256').update(input.content, 'utf8').digest('hex')}`
    };
}
function writeTextNewFile(absolutePath, content) {
    if (existsSync(absolutePath)) {
        throw new CliError('ATM_PLAN_ARTIFACT_EXISTS', `planning artifact already exists: ${absolutePath}`, { exitCode: 1 });
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
    return [absolutePath];
}
function usage(text) {
    return new CliError('ATM_CLI_USAGE', text, { exitCode: 2 });
}
function required(value, flag) {
    if (!value)
        throw usage(`missing required ${flag}`);
    return value;
}
function stringOption(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function normalizeTaskPrefix(value) {
    const raw = value.trim().toUpperCase();
    if (!raw)
        throw usage('task prefix is required');
    if (/^(TASK|ATM)-[A-Z0-9]+$/.test(raw))
        return raw;
    if (/^[A-Z0-9]+$/.test(raw))
        return `TASK-${raw}`;
    throw usage(`invalid task prefix: ${value}`);
}
function normalizeSeriesKey(value) {
    const raw = value.trim().toUpperCase();
    return raw.replace(/^(TASK|ATM)-/, '');
}
function normalizeFamilyDir(value) {
    const normalized = normalizeStoredPath(value);
    if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
        throw usage(`invalid family dir: ${value}`);
    }
    return normalized;
}
function normalizeDocName(value) {
    const normalized = normalizeStoredPath(value);
    if (!normalized.endsWith('.md') || normalized.includes('/') || normalized.includes('..')) {
        throw usage(`invalid doc name: ${value}`);
    }
    return normalized;
}
function normalizeStoredPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function normalizeSeriesStatus(value) {
    const normalized = (value ?? 'active').trim().toLowerCase();
    return normalized === 'archived' || normalized === 'reserved' ? normalized : 'active';
}
function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'untitled';
}
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
