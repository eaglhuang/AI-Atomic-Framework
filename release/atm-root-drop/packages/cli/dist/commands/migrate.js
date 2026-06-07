import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CliError, makeResult, makeHelpResult, message, parseArgsForCommand } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { resolveCodemodsForMigration } from '../migration/codemod-registry.js';
const migrationIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migration/migration-index.json');
function loadMigrationIndex() {
    const raw = readFileSync(migrationIndexPath, 'utf8');
    return JSON.parse(raw);
}
function findMigrationEntry(idx, fromVersion, toVersion) {
    return idx.migrations.find((m) => m.fromVersion === fromVersion && m.toVersion === toVersion);
}
function collectFiles(dir, base = dir) {
    const results = [];
    if (!existsSync(dir))
        return results;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFiles(full, base));
        }
        else {
            results.push(path.relative(base, full).replace(/\\/g, '/'));
        }
    }
    return results;
}
function isUserModified(relFile, cwd) {
    const result = spawnSync('git', ['status', '--short', '--', relFile], { cwd, encoding: 'utf8' });
    if (result.status !== 0)
        return false;
    return (result.stdout || '').trim().length > 0;
}
function runPlan(options, cwd) {
    const fromVersion = options.from;
    const toVersion = options.to;
    if (!fromVersion || !toVersion) {
        throw new CliError('ATM_CLI_USAGE', 'migrate plan requires --from <version> and --to <version>', { exitCode: 2 });
    }
    const index = loadMigrationIndex();
    const entry = findMigrationEntry(index, fromVersion, toVersion);
    if (!entry) {
        return makeResult({ ok: true, command: 'migrate', cwd, messages: [message('info', 'ATM_MIGRATE_NO_ENTRY', `No migration defined for ${fromVersion} to ${toVersion}`)], evidence: { fromVersion, toVersion, status: 'no-migration-defined', codemods: [], affectedFiles: [], userModifiedFiles: [], guide: null } });
    }
    const codemods = resolveCodemodsForMigration(entry.codemods, fromVersion, toVersion);
    const workspaceFiles = collectFiles(cwd);
    const affectedFiles = [];
    const userModifiedFiles = [];
    for (const rel of workspaceFiles) {
        for (const codemod of codemods) {
            const abs = path.join(cwd, rel);
            let content;
            try {
                content = readFileSync(abs, 'utf8');
            }
            catch {
                continue;
            }
            const transformed = codemod.apply(content, rel);
            if (transformed !== null && !affectedFiles.includes(rel)) {
                affectedFiles.push(rel);
                if (isUserModified(rel, cwd))
                    userModifiedFiles.push(rel);
            }
        }
    }
    return makeResult({ ok: true, command: 'migrate', cwd, messages: [], evidence: { fromVersion, toVersion, status: 'ready', codemods: entry.codemods, affectedFiles, userModifiedFiles, guide: entry.guide, description: entry.description } });
}
function runApply(options, cwd) {
    const fromVersion = options.from;
    const toVersion = options.to;
    if (!fromVersion || !toVersion) {
        throw new CliError('ATM_CLI_USAGE', 'migrate apply requires --from <version> and --to <version>', { exitCode: 2 });
    }
    const index = loadMigrationIndex();
    const entry = findMigrationEntry(index, fromVersion, toVersion);
    if (!entry) {
        throw new CliError('ATM_MIGRATE_NO_ENTRY', `No migration defined for ${fromVersion} to ${toVersion}`, { exitCode: 1 });
    }
    const codemods = resolveCodemodsForMigration(entry.codemods, fromVersion, toVersion);
    const workspaceFiles = collectFiles(cwd);
    const backupId = `migrate-${fromVersion.replace(/\./g, '_')}-to-${toVersion.replace(/\./g, '_')}-${Date.now().toString(36)}`;
    const backupDir = path.join(cwd, '.atm', 'backups', backupId);
    mkdirSync(backupDir, { recursive: true });
    const modifiedFiles = [];
    for (const rel of workspaceFiles) {
        for (const codemod of codemods) {
            const abs = path.join(cwd, rel);
            let content;
            try {
                content = readFileSync(abs, 'utf8');
            }
            catch {
                continue;
            }
            const transformed = codemod.apply(content, rel);
            if (transformed !== null) {
                const backupTarget = path.join(backupDir, rel);
                mkdirSync(path.dirname(backupTarget), { recursive: true });
                writeFileSync(backupTarget, content, 'utf8');
                writeFileSync(abs, transformed, 'utf8');
                modifiedFiles.push(rel);
            }
        }
    }
    writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify({ fromVersion, toVersion, codemods: entry.codemods, modifiedFiles }, null, 2), 'utf8');
    return makeResult({ ok: true, command: 'migrate', cwd, messages: [], evidence: { fromVersion, toVersion, status: 'applied', codemods: entry.codemods, modifiedFiles, backupPath: backupDir } });
}
function runVerify(options, cwd, root) {
    const fixturePath = options.fixture;
    if (fixturePath) {
        let fixtureAbs = path.isAbsolute(fixturePath) ? fixturePath : path.resolve(root, fixturePath);
        if (!existsSync(path.join(fixtureAbs, 'before')) || !existsSync(path.join(fixtureAbs, 'after'))) {
            const fallbackAbs = path.isAbsolute(fixturePath) ? fixturePath : path.resolve(cwd, fixturePath);
            if (existsSync(path.join(fallbackAbs, 'before')) && existsSync(path.join(fallbackAbs, 'after'))) {
                fixtureAbs = fallbackAbs;
            }
        }
        const beforeDir = path.join(fixtureAbs, 'before');
        const afterDir = path.join(fixtureAbs, 'after');
        if (!existsSync(beforeDir) || !existsSync(afterDir)) {
            throw new CliError('ATM_MIGRATE_FIXTURE_MISSING', `Fixture ${fixturePath} must contain before/ and after/ directories`, { exitCode: 1 });
        }
        const index = loadMigrationIndex();
        const fixtureRel = path.relative(root, fixtureAbs).replace(/\\/g, '/');
        const normalizedFixtureAbs = fixtureAbs.replace(/\\/g, '/');
        const matchedEntry = index.migrations.find((m) => fixtureRel === m.fixture || normalizedFixtureAbs.endsWith(m.fixture));
        if (!matchedEntry) {
            throw new CliError('ATM_MIGRATE_FIXTURE_NOT_INDEXED', `Fixture ${fixturePath} is not referenced in the migration index`, { exitCode: 1 });
        }
        const codemods = resolveCodemodsForMigration(matchedEntry.codemods, matchedEntry.fromVersion, matchedEntry.toVersion);
        const beforeFiles = collectFiles(beforeDir);
        const failures = [];
        for (const rel of beforeFiles) {
            const beforeContent = readFileSync(path.join(beforeDir, rel), 'utf8');
            const afterFilePath = path.join(afterDir, rel);
            if (!existsSync(afterFilePath)) {
                failures.push(`after/${rel} not found`);
                continue;
            }
            const afterContent = readFileSync(afterFilePath, 'utf8');
            let transformed = beforeContent;
            for (const codemod of codemods) {
                const r = codemod.apply(transformed, rel);
                if (r !== null)
                    transformed = r;
            }
            if (transformed !== afterContent)
                failures.push(`${rel}: codemod output does not match after/ expected content`);
        }
        if (failures.length > 0) {
            return makeResult({ ok: false, command: 'migrate', cwd, messages: failures.map((f) => message('error', 'ATM_MIGRATE_FIXTURE_MISMATCH', `verify failure: ${f}`)), evidence: { fixture: fixturePath, status: 'fixture-mismatch', failures } });
        }
        return makeResult({ ok: true, command: 'migrate', cwd, messages: [], evidence: { fixture: fixturePath, status: 'fixture-ok', verifiedFiles: beforeFiles } });
    }
    return makeResult({ ok: true, command: 'migrate', cwd, messages: [message('info', 'ATM_MIGRATE_WORKSPACE_VERIFY', 'Workspace version verification requires --from / --to flags; use migrate plan instead.')], evidence: { status: 'workspace-verify-not-implemented' } });
}
export async function runMigrate(argv) {
    const spec = getCommandSpec('migrate');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for migrate.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, argv);
    if (parsed.helpRequested) {
        return makeHelpResult(spec);
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const [action = 'plan'] = parsed.positional;
    const options = parsed.options;
    try {
        if (action === 'plan')
            return runPlan(options, cwd);
        if (action === 'apply')
            return runApply(options, cwd);
        if (action === 'verify')
            return runVerify(options, cwd, root);
        throw new CliError('ATM_CLI_USAGE', `Unknown migrate action: ${action}. Expected plan | apply | verify`, { exitCode: 2 });
    }
    catch (err) {
        if (err instanceof CliError) {
            return makeResult({ ok: false, command: 'migrate', cwd, messages: [message('error', err.code ?? 'ATM_MIGRATE_ERROR', err.message)], evidence: { status: 'error' } });
        }
        throw err;
    }
}
