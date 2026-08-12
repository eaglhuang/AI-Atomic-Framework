import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
/** The stable output family of a sealed ATM runner build. */
export function isRunnerBuildOutputPath(filePath) {
    const normalized = normalizePath(filePath);
    return normalized.startsWith('packages/cli/dist/')
        || normalized.startsWith('release/atm-root-drop/')
        || normalized.startsWith('release/atm-onefile/')
        || /^\.atm\/history\/evidence\/[^/]+\.runner-sync-receipt\.json$/i.test(normalized);
}
/** Build artifacts whose unexpected dirty state must match a sealed inventory. */
export function isRunnerPublicationArtifactPath(filePath) {
    const normalized = normalizePath(filePath);
    return normalized.startsWith('packages/cli/dist/')
        || normalized.startsWith('release/atm-root-drop/')
        || normalized.startsWith('release/atm-onefile/');
}
export function deriveRunnerBuildOutputInventory(input) {
    return buildRunnerBuildOutputInventory({
        ...input,
        outputPaths: input.observedPaths.filter(isRunnerBuildOutputPath)
    });
}
/**
 * The sealed build adapter asks this module for publication membership. It does
 * not infer it from a dirty Git diff, which may contain another lane's work.
 */
export function scanSealedRunnerBuildOutputInventory(input) {
    const outputPaths = changedPathsSinceSnapshot(input.cwd, input.buildTarget, input.beforeBuildSnapshot);
    if (input.includeDirtyPublicationMembers) {
        outputPaths.push(...listDirtyPaths(input.cwd).filter(isRunnerPublicationArtifactPath));
    }
    if (input.taskId)
        outputPaths.push(`.atm/history/evidence/${input.taskId}.runner-sync-receipt.json`);
    return deriveRunnerBuildOutputInventory({
        sealedSourceSha: input.sealedSourceSha,
        observedPaths: outputPaths,
        currentTaskId: input.taskId,
        ownership: outputPaths.map((entry) => ({ path: entry, ownerTaskId: input.taskId }))
    });
}
/** Capture byte identities before a sealed build mutates its output surfaces. */
export function captureRunnerBuildOutputSnapshot(input) {
    const roots = publicationRoots(input.cwd, input.buildTarget);
    const members = Object.fromEntries(collectOutputPaths(input.cwd, roots).map((entry) => [entry, fileFingerprint(input.cwd, entry)]));
    const allowedFiles = input.currentTaskAllowedFiles ?? [];
    const hasCanonicalScope = Boolean(input.currentTaskId?.trim()) && allowedFiles.length > 0;
    const preexistingDirtyPaths = listDirtyPaths(input.cwd)
        .filter((entry) => Object.hasOwn(members, entry))
        .filter((entry) => !hasCanonicalScope || !pathMatchesScope(entry, allowedFiles));
    return { schemaId: 'atm.runnerBuildOutputSnapshot.v1', buildTarget: input.buildTarget, members, preexistingDirtyPaths };
}
/** Create the immutable payload a broker must persist before a takeover. */
export function planRunnerPublicationTakeover(input) {
    const entries = uniquePaths(input.snapshot.preexistingDirtyPaths)
        .map((entry) => ({ path: entry, observedDigest: input.snapshot.members[entry] ?? 'missing' }));
    if (entries.some((entry) => !isRunnerPublicationArtifactPath(entry.path) || entry.observedDigest === 'missing')) {
        throw new Error('Runner publication takeover can only name pre-existing generated publication members with an observed digest.');
    }
    const sealedSourceSha = input.sealedSourceSha.trim();
    const snapshotDigest = digestSnapshot(input.snapshot);
    return {
        schemaId: 'atm.runnerPublicationTakeoverPlan.v1',
        sealedSourceSha,
        snapshotDigest,
        entries,
        digest: digestTakeoverPlan({ sealedSourceSha, snapshotDigest, entries })
    };
}
/** Reject stale, broadened, or hand-edited takeovers before any bytes move. */
export function validateRunnerPublicationTakeoverPlan(input) {
    if (!input.plan || typeof input.plan !== 'object' || Array.isArray(input.plan))
        return { ok: false, plan: null, reason: 'plan must be an object' };
    const raw = input.plan;
    if (raw.schemaId !== 'atm.runnerPublicationTakeoverPlan.v1' || !Array.isArray(raw.entries))
        return { ok: false, plan: null, reason: 'plan schema or entries are invalid' };
    const sealedSourceSha = typeof raw.sealedSourceSha === 'string' ? raw.sealedSourceSha.trim() : '';
    const snapshotDigest = typeof raw.snapshotDigest === 'string' ? raw.snapshotDigest.trim() : '';
    const entries = raw.entries.map((entry) => {
        const value = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
        return { path: typeof value.path === 'string' ? normalizePath(value.path) : '', observedDigest: typeof value.observedDigest === 'string' ? value.observedDigest : '' };
    });
    if (!sealedSourceSha || !snapshotDigest || entries.some((entry) => !entry.path || !entry.observedDigest) || JSON.stringify(entries) !== JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path)))) {
        return { ok: false, plan: null, reason: 'plan entries must be complete, unique, and sorted' };
    }
    const plan = { schemaId: 'atm.runnerPublicationTakeoverPlan.v1', sealedSourceSha, snapshotDigest, entries, digest: typeof raw.digest === 'string' ? raw.digest.trim() : '' };
    if (plan.digest !== digestTakeoverPlan(plan))
        return { ok: false, plan: null, reason: 'plan digest is invalid' };
    if (plan.sealedSourceSha !== input.sealedSourceSha.trim())
        return { ok: false, plan: null, reason: 'plan sealed source does not match this build' };
    if (plan.snapshotDigest !== digestSnapshot(input.snapshot))
        return { ok: false, plan: null, reason: 'plan snapshot does not match current pre-build bytes' };
    const expected = planRunnerPublicationTakeover({ sealedSourceSha: input.sealedSourceSha, snapshot: input.snapshot });
    if (plan.digest !== expected.digest)
        return { ok: false, plan: null, reason: 'plan does not cover exactly the current pre-existing publication members' };
    return { ok: true, plan, reason: null };
}
export function buildRunnerBuildOutputInventory(input) {
    const ownershipByPath = new Map((input.ownership ?? []).map((entry) => [normalizePath(entry.path), entry]));
    const entries = uniquePaths(input.outputPaths).map((outputPath) => {
        const ownership = ownershipByPath.get(outputPath);
        const ownerTaskId = ownership?.ownerTaskId?.trim() || null;
        const ownerActorId = ownership?.ownerActorId?.trim() || null;
        const disposition = ownerTaskId === input.currentTaskId
            ? 'owned-current'
            : ownerTaskId && ownership?.leaseFresh !== false
                ? 'foreign-live'
                : ownerTaskId
                    ? 'stale-recovery-input'
                    : 'unowned';
        return { path: outputPath, disposition, ownerTaskId, ownerActorId };
    });
    const sealedSourceSha = input.sealedSourceSha.trim();
    return {
        schemaId: 'atm.runnerBuildOutputInventory.v1',
        sealedSourceSha,
        entries,
        digest: digestInventory(sealedSourceSha, entries)
    };
}
export function inventoryPathsForPublication(inventory) {
    return inventory.entries
        .filter((entry) => entry.disposition === 'owned-current')
        .map((entry) => entry.path);
}
export function inventoryRecoveryBlockers(inventory) {
    return inventory.entries.filter((entry) => entry.disposition === 'foreign-live' || entry.disposition === 'unowned');
}
export function evaluateRunnerPublicationDisposition(input) {
    const inventoryPaths = new Set(input.inventory.entries.map((entry) => entry.path));
    const dirtyPaths = uniquePaths(input.dirtyPaths);
    // A foreign task's evidence receipt is not an artifact of this generation.
    // It is relevant only when this inventory explicitly named it.
    const publicationDirtyPaths = dirtyPaths.filter((entry) => (inventoryPaths.has(entry) || isRunnerPublicationArtifactPath(entry)));
    const dirtyInventoryPaths = publicationDirtyPaths.filter((entry) => inventoryPaths.has(entry));
    const extraOutputPaths = publicationDirtyPaths.filter((entry) => !inventoryPaths.has(entry));
    const terminalDisposition = input.terminalDisposition ?? null;
    const disposition = terminalDisposition === 'recovery-retained'
        ? 'recovery-retained'
        : terminalDisposition === 'published' && extraOutputPaths.length === 0
            ? 'published'
            : extraOutputPaths.length > 0
                ? 'inventory-incomplete'
                : dirtyInventoryPaths.length > 0
                    ? 'publication-pending'
                    : 'published';
    return {
        schemaId: 'atm.runnerPublicationDisposition.v1',
        disposition,
        ok: disposition === 'published' || disposition === 'recovery-retained',
        inventoryDigest: input.inventory.digest,
        dirtyInventoryPaths,
        extraOutputPaths,
        terminalDisposition
    };
}
function changedPathsSinceSnapshot(cwd, buildTarget, before) {
    if (before.schemaId !== 'atm.runnerBuildOutputSnapshot.v1' || before.buildTarget !== buildTarget) {
        throw new Error('Runner build output snapshot does not match the sealed build target.');
    }
    const roots = publicationRoots(cwd, buildTarget);
    const afterPaths = collectOutputPaths(cwd, roots);
    const paths = uniquePaths([...Object.keys(before.members), ...afterPaths]);
    return paths.filter((entry) => before.members[entry] !== fileFingerprint(cwd, entry));
}
function collectOutputPaths(cwd, roots) {
    return uniquePaths([...roots.flatMap((root) => listFiles(cwd, root)), ...listTrackedFiles(cwd, roots)]);
}
function fileFingerprint(cwd, relativePath) {
    const absolute = path.join(cwd, relativePath);
    if (!existsSync(absolute))
        return 'missing';
    return `sha256:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`;
}
function listDirtyPaths(cwd) {
    const collect = (args) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if ((result.status ?? 1) !== 0)
            return [];
        return String(result.stdout ?? '').split(/\r?\n/).map(normalizePath).filter(Boolean);
    };
    return uniquePaths([...collect(['diff', '--name-only']), ...collect(['diff', '--name-only', '--cached'])]);
}
export function pathMatchesScope(filePath, allowedFiles) {
    const normalizedFile = normalizePath(filePath).toLowerCase();
    return allowedFiles.some((candidate) => {
        const normalizedCandidate = normalizePath(candidate).toLowerCase();
        if (normalizedCandidate.includes('*')) {
            const escaped = normalizedCandidate
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
                .replace(/\*/g, '[^/]*')
                .replace(/__ATM_DOUBLE_STAR__/g, '.*');
            return new RegExp(`^${escaped}$`).test(normalizedFile);
        }
        if (!normalizedCandidate)
            return false;
        if (normalizedFile === normalizedCandidate)
            return true;
        if (normalizedCandidate.endsWith('/'))
            return normalizedFile.startsWith(normalizedCandidate);
        if (!/\.[a-z0-9]+$/i.test(normalizedCandidate))
            return normalizedFile.startsWith(`${normalizedCandidate}/`);
        return false;
    });
}
export function verifyRunnerBuildOutputParity(inventory, declaredPaths) {
    const observed = new Set(inventory.entries.map((entry) => entry.path));
    const declared = new Set(uniquePaths(declaredPaths));
    const missing = [...declared].filter((entry) => !observed.has(entry)).sort();
    const extra = [...observed].filter((entry) => !declared.has(entry)).sort();
    return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}
/**
 * Validate a receipt-provided inventory against the same canonical digest used
 * by the build writer. Consumers must not accept a merely shape-compatible
 * inventory, because it could describe a different sealed generation.
 */
export function validateRunnerBuildOutputInventory(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, inventory: null, reason: 'inventory must be an object' };
    }
    const candidate = value;
    if (candidate.schemaId !== 'atm.runnerBuildOutputInventory.v1') {
        return { ok: false, inventory: null, reason: 'inventory schemaId is invalid' };
    }
    const sealedSourceSha = typeof candidate.sealedSourceSha === 'string' ? candidate.sealedSourceSha.trim() : '';
    if (!sealedSourceSha || !Array.isArray(candidate.entries) || typeof candidate.digest !== 'string') {
        return { ok: false, inventory: null, reason: 'inventory is missing sealedSourceSha, entries, or digest' };
    }
    const entries = [];
    for (const entry of candidate.entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { ok: false, inventory: null, reason: 'inventory contains an invalid entry' };
        }
        const raw = entry;
        const path = typeof raw.path === 'string' ? normalizePath(raw.path) : '';
        const disposition = raw.disposition;
        if (!path || !['owned-current', 'foreign-live', 'stale-recovery-input', 'unowned'].includes(String(disposition))) {
            return { ok: false, inventory: null, reason: 'inventory contains an invalid path or disposition' };
        }
        entries.push({
            path,
            disposition: disposition,
            ownerTaskId: typeof raw.ownerTaskId === 'string' && raw.ownerTaskId.trim() ? raw.ownerTaskId.trim() : null,
            ownerActorId: typeof raw.ownerActorId === 'string' && raw.ownerActorId.trim() ? raw.ownerActorId.trim() : null
        });
    }
    const paths = entries.map((entry) => entry.path);
    if (paths.length !== new Set(paths).size || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
        return { ok: false, inventory: null, reason: 'inventory paths must be unique and sorted' };
    }
    const inventory = {
        schemaId: 'atm.runnerBuildOutputInventory.v1',
        sealedSourceSha,
        entries,
        digest: String(candidate.digest).trim()
    };
    if (inventory.digest !== digestInventory(inventory.sealedSourceSha, inventory.entries)) {
        return { ok: false, inventory: null, reason: 'inventory digest does not match its canonical entries' };
    }
    return { ok: true, inventory, reason: null };
}
function digestInventory(sealedSourceSha, entries) {
    const payload = JSON.stringify({ sealedSourceSha, entries });
    return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
function digestSnapshot(snapshot) {
    return `sha256:${createHash('sha256').update(JSON.stringify({ buildTarget: snapshot.buildTarget, members: snapshot.members, preexistingDirtyPaths: uniquePaths(snapshot.preexistingDirtyPaths) })).digest('hex')}`;
}
function digestTakeoverPlan(plan) {
    const payload = {
        sealedSourceSha: plan.sealedSourceSha,
        snapshotDigest: plan.snapshotDigest,
        entries: plan.entries
    };
    return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
function uniquePaths(paths) {
    return [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function publicationRoots(cwd, buildTarget) {
    const roots = [];
    if (buildTarget === 'full' || buildTarget === 'packages') {
        const packagesRoot = path.join(cwd, 'packages');
        if (existsSync(packagesRoot)) {
            for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
                if (entry.isDirectory())
                    roots.push(path.join('packages', entry.name, 'dist'));
            }
        }
    }
    if (buildTarget === 'full' || buildTarget === 'root-drop')
        roots.push(path.join('release', 'atm-root-drop'));
    if (buildTarget === 'full' || buildTarget === 'onefile')
        roots.push(path.join('release', 'atm-onefile'));
    return roots;
}
function listFiles(cwd, relativeRoot) {
    const absoluteRoot = path.join(cwd, relativeRoot);
    if (!existsSync(absoluteRoot))
        return [];
    const files = [];
    const visit = (absolute) => {
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
            const child = path.join(absolute, entry.name);
            if (entry.isDirectory())
                visit(child);
            else if (entry.isFile())
                files.push(path.relative(cwd, child).replace(/\\/g, '/'));
        }
    };
    visit(absoluteRoot);
    return files;
}
function listTrackedFiles(cwd, relativeRoots) {
    if (relativeRoots.length === 0)
        return [];
    const result = spawnSync('git', ['ls-files', '--', ...relativeRoots.map(normalizePath)], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
    });
    if ((result.status ?? 1) !== 0)
        return [];
    return String(result.stdout ?? '')
        .split(/\r?\n/)
        .map(normalizePath)
        .filter(Boolean);
}
