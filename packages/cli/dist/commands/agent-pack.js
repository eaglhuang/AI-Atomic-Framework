import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashFiles, renderManifest } from '../../../agent-pack-sdk/dist/index.js';
import { claudeCodePack } from '../../../agent-pack-claude-code/dist/index.js';
import { copilotPack } from '../../../agent-pack-copilot/dist/index.js';
import { cursorPack } from '../../../agent-pack-cursor/dist/index.js';
import { geminiPack } from '../../../agent-pack-gemini/dist/index.js';
import { windsurfPack } from '../../../agent-pack-windsurf/dist/index.js';
import { collectATMChartSources, collectSchemaDrift } from './atm-chart.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
import { getCommandSpec } from './command-specs.js';
const defaultAgentPackManifestDir = path.join('.atm', 'agent-pack');
/** Registry of all built-in agent packs available for install. */
const packRegistry = {
    'claude-code': claudeCodePack,
    copilot: copilotPack,
    cursor: cursorPack,
    gemini: geminiPack,
    windsurf: windsurfPack,
};
/** Return a SHA-256 hex digest of the given string. */
function sha256(input) {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}
/** Apply {{VAR}} substitutions to a template string. */
function applyVars(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? _m);
}
export async function runAgentPack(argv) {
    const spec = getCommandSpec('agent-pack');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for agent-pack.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, normalizePackArgv(argv));
    const [action = 'list'] = parsed.positional;
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const packId = parsed.options.pack;
    const dryRun = parsed.options.dryRun === true;
    if (action === 'list') {
        return runAgentPackList(cwd);
    }
    if (action === 'install') {
        return runAgentPackInstall(cwd, packId, dryRun);
    }
    if (action === 'uninstall') {
        return runAgentPackUninstall(cwd, packId);
    }
    if (action === 'diff') {
        return runAgentPackDiff(cwd, packId);
    }
    if (action === 'verify-fresh') {
        return runAgentPackVerifyFresh(cwd, packId);
    }
    throw new CliError('ATM_CLI_USAGE', `agent-pack does not support action "${action}". Valid: install | uninstall | diff | list | verify-fresh`, { exitCode: 2 });
}
function runAgentPackList(cwd) {
    const installedPacks = readInstalledPackManifests(cwd).map((manifest) => ({
        packId: manifest.packId,
        version: manifest.version,
        manifestPath: manifest.manifestPath,
        guardsHash: manifest.sourceHashes.guardsHash
    }));
    return makeResult({
        ok: true,
        command: 'agent-pack',
        cwd,
        messages: [message('info', 'ATM_AGENT_PACK_LIST', installedPacks.length === 0 ? 'No agent packs installed.' : 'Agent packs listed.')],
        evidence: { action: 'list', installedPacks }
    });
}
function runAgentPackInstall(cwd, packId, dryRun) {
    if (!packId) {
        throw new CliError('ATM_CLI_USAGE', 'agent-pack install requires --pack <pack-id> (or --id <pack-id>)', { exitCode: 2 });
    }
    const registeredPack = packRegistry[packId];
    const context = { cwd };
    let pack;
    let sourceGuardsSha256 = null;
    let sourceSchemaSha256s = {};
    if (registeredPack) {
        pack = registeredPack;
        // Try to collect ATM chart sources for guards/schema freshness tracking.
        // If the host repo is not bootstrapped yet, skip gracefully (guards tracking disabled).
        try {
            const sources = collectATMChartSources(cwd);
            sourceGuardsSha256 = sources.sourceGuardsSha256;
            sourceSchemaSha256s = sources.sourceSchemaSha256s;
        }
        catch (e) {
            if (!(e instanceof CliError) || e.code !== 'ATM_CHART_GUARDS_MISSING')
                throw e;
            // Non-bootstrapped repo: leave guards/schema hashes as null/{} — always fresh.
        }
    }
    else {
        // Bespoke pack: ATM chart sources are required.
        const sources = collectATMChartSources(cwd);
        pack = {
            packId,
            name: packId,
            version: '0.1.0',
            agentTarget: packId,
            targetFiles: [],
            sourceHash: hashFiles([packId, sources.sourceGuardsSha256, JSON.stringify(sources.sourceSchemaSha256s)])
        };
        sourceGuardsSha256 = sources.sourceGuardsSha256;
        sourceSchemaSha256s = sources.sourceSchemaSha256s;
    }
    const renderedManifest = renderManifest(pack, context);
    const mPath = resolveAgentPackManifestPath(cwd, packId);
    const manifest = createAgentPackManifest({
        cwd,
        pack,
        manifestPath: mPath,
        renderedManifest,
        sourceGuardsSha256,
        sourceSchemaSha256s
    });
    if (!dryRun) {
        // Write target files to host repo
        for (const file of pack.targetFiles) {
            const filePath = path.join(cwd, file.path);
            mkdirSync(path.dirname(filePath), { recursive: true });
            writeFileSync(filePath, applyVars(file.template, context.vars ?? {}), 'utf8');
        }
        // Write manifest record
        mkdirSync(path.dirname(mPath), { recursive: true });
        writeFileSync(mPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    return makeResult({
        ok: true,
        command: 'agent-pack',
        cwd,
        messages: [
            message('info', dryRun ? 'ATM_AGENT_PACK_INSTALL_DRY_RUN' : 'ATM_AGENT_PACK_INSTALL', `Agent pack "${packId}" install${dryRun ? ' (dry-run)' : ''} ok.`)
        ],
        evidence: {
            action: 'install',
            dryRun,
            manifestPath: relativePathFrom(cwd, mPath),
            manifest
        }
    });
}
function runAgentPackUninstall(cwd, packId) {
    if (!packId) {
        throw new CliError('ATM_CLI_USAGE', 'agent-pack uninstall requires --pack <pack-id> (or --id <pack-id>)', { exitCode: 2 });
    }
    const mPath = resolveAgentPackManifestPath(cwd, packId);
    const removedFiles = [];
    const backedUpFiles = [];
    // If manifest exists, remove managed target files (with .bak for user-modified)
    if (existsSync(mPath)) {
        const record = readAgentPackManifest(mPath);
        for (const renderedFile of record.renderedManifest.renderedFiles) {
            const filePath = path.join(cwd, renderedFile.path);
            if (!existsSync(filePath))
                continue;
            const currentHash = sha256(readFileSync(filePath, 'utf8'));
            if (currentHash !== renderedFile.contentHash) {
                // User-modified: rename to .bak instead of deleting
                renameSync(filePath, `${filePath}.bak`);
                backedUpFiles.push(renderedFile.path);
            }
            else {
                rmSync(filePath, { force: true });
                removedFiles.push(renderedFile.path);
            }
        }
        // Remove manifest record last
        rmSync(mPath, { force: true });
        removedFiles.push(relativePathFrom(cwd, mPath));
    }
    return makeResult({
        ok: true,
        command: 'agent-pack',
        cwd,
        messages: [message('info', 'ATM_AGENT_PACK_UNINSTALL', `Agent pack "${packId}" uninstalled (${removedFiles.length} removed, ${backedUpFiles.length} backed up).`)],
        evidence: { action: 'uninstall', packId, removedFiles, backedUpFiles }
    });
}
function runAgentPackDiff(cwd, packId) {
    if (!packId) {
        throw new CliError('ATM_CLI_USAGE', 'agent-pack diff requires --pack <pack-id> (or --id <pack-id>)', { exitCode: 2 });
    }
    const mPath = resolveAgentPackManifestPath(cwd, packId);
    if (!existsSync(mPath)) {
        return makeResult({
            ok: true,
            command: 'agent-pack',
            cwd,
            messages: [message('warn', 'ATM_AGENT_PACK_NOT_INSTALLED', `Agent pack "${packId}" is not installed.`)],
            evidence: { action: 'diff', packId, changedFiles: [] }
        });
    }
    const record = readAgentPackManifest(mPath);
    const changedFiles = [];
    for (const renderedFile of record.renderedManifest.renderedFiles) {
        const filePath = path.join(cwd, renderedFile.path);
        if (!existsSync(filePath)) {
            changedFiles.push({ path: renderedFile.path, status: 'missing' });
        }
        else {
            const currentHash = sha256(readFileSync(filePath, 'utf8'));
            if (currentHash !== renderedFile.contentHash) {
                changedFiles.push({ path: renderedFile.path, status: 'modified' });
            }
        }
    }
    return makeResult({
        ok: true,
        command: 'agent-pack',
        cwd,
        messages: [message('info', 'ATM_AGENT_PACK_DIFF', `Agent pack "${packId}" diff: ${changedFiles.length} changed file(s).`)],
        evidence: {
            action: 'diff',
            packId,
            manifestPath: relativePathFrom(cwd, mPath),
            changedFiles
        }
    });
}
function runAgentPackVerifyFresh(cwd, packId) {
    if (!packId) {
        throw new CliError('ATM_CLI_USAGE', 'agent-pack verify-fresh requires --pack <pack-id> (or --id <pack-id>)', { exitCode: 2 });
    }
    const manifestPath = resolveAgentPackManifestPath(cwd, packId);
    if (!existsSync(manifestPath)) {
        throw new CliError('ATM_AGENT_PACK_MANIFEST_MISSING', `Agent pack "${packId}" manifest was not found. Run install first.`, {
            exitCode: 2,
            details: {
                manifestPath: relativePathFrom(cwd, manifestPath)
            }
        });
    }
    const manifest = readAgentPackManifest(manifestPath);
    const storedGuardsHash = manifest.sourceHashes.guardsHash;
    // Try to collect ATM chart sources. If not bootstrapped, skip staleness checks.
    let currentGuardsHash = null;
    let currentSchemaHashes = {};
    try {
        const sources = collectATMChartSources(cwd);
        currentGuardsHash = sources.sourceGuardsSha256;
        currentSchemaHashes = sources.sourceSchemaSha256s;
    }
    catch (e) {
        if (!(e instanceof CliError) || e.code !== 'ATM_CHART_GUARDS_MISSING')
            throw e;
        // Non-bootstrapped repo: no guards to compare — treat as fresh.
    }
    // Only report stale when both stored and current guards hashes are available.
    const guardsDrifted = storedGuardsHash !== null && currentGuardsHash !== null && storedGuardsHash !== currentGuardsHash;
    const schemaDrift = (storedGuardsHash !== null && currentGuardsHash !== null)
        ? collectSchemaDrift(manifest.sourceHashes.schemaHashes, currentSchemaHashes)
        : [];
    if (guardsDrifted || schemaDrift.length > 0) {
        throw new CliError('ATM_AGENT_PACK_STALE', 'Agent pack manifest is stale. Reinstall or re-render the pack from the current SSoT.', {
            exitCode: 2,
            details: {
                packId,
                manifestPath: relativePathFrom(cwd, manifestPath),
                recordedGuardsHash: storedGuardsHash,
                currentGuardsHash,
                schemaDrift
            }
        });
    }
    return makeResult({
        ok: true,
        command: 'agent-pack',
        cwd,
        messages: [message('info', 'ATM_AGENT_PACK_VERIFY_FRESH_OK', `Agent pack "${packId}" matches the current ATM source hashes.`)],
        evidence: {
            action: 'verify-fresh',
            packId,
            manifestPath: relativePathFrom(cwd, manifestPath),
            guardsHash: currentGuardsHash,
            schemaHashes: currentSchemaHashes
        }
    });
}
function normalizePackArgv(argv) {
    return argv.map((arg) => arg === '--id' ? '--pack' : arg);
}
function resolveAgentPackManifestPath(cwd, packId) {
    return path.join(cwd, defaultAgentPackManifestDir, `${packId}.manifest.json`);
}
function createAgentPackManifest(input) {
    return {
        schemaId: 'atm.agentPackManifest',
        specVersion: '0.1.0',
        packId: input.pack.packId,
        version: input.pack.version,
        installedAt: input.renderedManifest.installedAt,
        manifestPath: relativePathFrom(input.cwd, input.manifestPath),
        sourceHashes: {
            guardsHash: input.sourceGuardsSha256,
            schemaHashes: input.sourceSchemaSha256s
        },
        renderedManifest: input.renderedManifest
    };
}
function readInstalledPackManifests(cwd) {
    const manifestDir = path.join(cwd, defaultAgentPackManifestDir);
    if (!existsSync(manifestDir)) {
        return [];
    }
    return readdirSync(manifestDir)
        .filter((entryName) => entryName.endsWith('.manifest.json'))
        .sort((left, right) => left.localeCompare(right))
        .flatMap((entryName) => {
        try {
            return [readAgentPackManifest(path.join(manifestDir, entryName))];
        }
        catch {
            return [];
        }
    });
}
function readAgentPackManifest(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
function relativePathFrom(cwd, filePath) {
    const relativePath = path.relative(cwd, filePath).replace(/\\/g, '/');
    return relativePath.length > 0 ? relativePath : '.';
}
