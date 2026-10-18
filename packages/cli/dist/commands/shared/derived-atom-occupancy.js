import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverJavaScriptAtomCandidates } from '../../_vendor/language-js/dist/language-js-adapter.js';
import { inferLanguageId } from '../../_vendor/core/dist/broker/candidate-bridge.js';
import { atomsTouchedByChange, deriveFileAtoms, derivedAtomRefs, findDerivedAtomConflicts, isPreambleChangeAdditive, mergeIntentDerivedAtoms, parseUnifiedZeroDiff } from '../../_vendor/core/dist/broker/derived-atoms.js';
import { loadRegistry } from '../../_vendor/core/dist/broker/registry.js';
import { commitBrokerRegistryTransaction, createBrokerTransactionAuthority } from '../../_vendor/core/dist/broker/transaction-authority.js';
/**
 * Derived atom occupancy (derived-atoms-plan v0.4, TASK-ASP-0007..0010).
 *
 * Derived atoms are computed from code on demand and never stored as a second
 * registry. Claim-time `--atoms` reserves symbols (an intent ceiling, not an
 * exclusive guarantee); commit-time confirmation derives the atoms the staged
 * diff actually touched and records them on the task's broker intent, which the
 * existing VirtualAtomInUse projection already exposes. Anything that cannot be
 * derived (unsupported language, binary file, stale formal atom) stays
 * file-level, which is the behaviour before this plan.
 */
export const BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';
const derivableLanguages = new Set(['javascript', 'typescript']);
export function derivedAtomsDisabled() {
    return /^(off|0|false)$/i.test(process.env.ATM_DERIVED_ATOMS ?? '');
}
export function isDerivableSourcePath(filePath) {
    return derivableLanguages.has(inferLanguageId(filePath));
}
export function deriveAtomsFromText(filePath, sourceText) {
    if (!isDerivableSourcePath(filePath) || sourceText.includes('\u0000'))
        return [];
    const languageId = inferLanguageId(filePath);
    const candidates = discoverJavaScriptAtomCandidates({
        sourceFiles: [{ filePath: filePath.replace(/\\/g, '/'), sourceText, languageId }],
        filters: { minConfidence: 'low' }
    });
    return deriveFileAtoms({ filePath, sourceText, candidates: candidates.map((candidate) => ({ ...candidate, languageId })) });
}
function readGitBlob(cwd, spec) {
    const result = spawnSync('git', ['show', spec], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : null;
}
/**
 * Formal atoms are file-level today (`location.codePaths`). A formal atom whose
 * code path no longer exists is stale (TASK-ASP-0010). Fresh formal atoms are
 * ownership annotations: they never swallow the derived atoms of their files,
 * because a whole-file boundary would erase same-file parallelism.
 */
export function inspectFormalAtomDrift(cwd) {
    const registryPath = path.join(cwd, 'atomic-registry.json');
    const staleAtoms = [];
    const staleFiles = new Set();
    const ownersByFile = new Map();
    if (!existsSync(registryPath))
        return { staleAtoms, staleFiles, ownersByFile };
    let entries = [];
    try {
        const document = JSON.parse(readFileSync(registryPath, 'utf8'));
        const raw = document.entries ?? document.atoms ?? [];
        entries = Array.isArray(raw) ? raw : Object.values(raw);
    }
    catch {
        return { staleAtoms, staleFiles, ownersByFile };
    }
    for (const entry of entries) {
        const record = entry;
        if (typeof record.atomId !== 'string' || record.status === 'retired')
            continue;
        const codePaths = Array.isArray(record.location?.codePaths)
            ? record.location.codePaths.filter((value) => typeof value === 'string').map((value) => value.replace(/\\/g, '/'))
            : [];
        const missingPaths = codePaths.filter((codePath) => !existsSync(path.join(cwd, codePath)));
        for (const codePath of codePaths)
            ownersByFile.set(codePath, [...(ownersByFile.get(codePath) ?? []), record.atomId]);
        if (missingPaths.length > 0) {
            staleAtoms.push({ atomId: record.atomId, missingPaths });
            for (const codePath of codePaths)
                staleFiles.add(codePath);
        }
    }
    return { staleAtoms, staleFiles, ownersByFile };
}
/**
 * Claim-time reservation (TASK-ASP-0007). Each declared symbol is resolved to
 * derived atoms of the scope files at the base commit. Symbols that do not
 * exist yet (new code) stay unresolved and are confirmed at commit time.
 */
export function reserveDerivedAtoms(input) {
    const symbols = [...new Set(input.symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    if (symbols.length === 0 || derivedAtomsDisabled())
        return { refs: [], resolved: [], unresolved: symbols, staleFormalFiles: [] };
    const drift = inspectFormalAtomDrift(input.cwd);
    const resolvedAtoms = [];
    const staleFormalFiles = [];
    for (const filePath of input.targetFiles.map((entry) => entry.replace(/\\/g, '/'))) {
        if (!isDerivableSourcePath(filePath) || /[*?[]/.test(filePath))
            continue;
        if (drift.staleFiles.has(filePath)) {
            staleFormalFiles.push(filePath);
            continue;
        }
        const text = readGitBlob(input.cwd, `${input.baseCommit}:${filePath}`);
        if (text == null)
            continue;
        resolvedAtoms.push(...deriveAtomsFromText(filePath, text).filter((atom) => symbols.includes(atom.symbol)));
    }
    const resolvedSymbols = new Set(resolvedAtoms.map((atom) => atom.symbol));
    return {
        refs: derivedAtomRefs(resolvedAtoms),
        resolved: resolvedAtoms.map((atom) => ({ symbol: atom.symbol, atomCid: atom.atomCid, filePath: atom.sourceRange.filePath })),
        unresolved: symbols.filter((symbol) => !resolvedSymbols.has(symbol)),
        staleFormalFiles
    };
}
/**
 * Commit-time confirmation (TASK-ASP-0008). By default the staged index is the
 * post-image (`:path`), so partial staging is judged exactly as committed.
 * `source: 'worktree'` is for `--auto-stage`, which stages precisely the
 * worktree content of the ticket bundle. Unsupported or underivable files are
 * skipped and remain file-level.
 */
export function confirmDerivedAtoms(input) {
    const fromWorktree = input.source === 'worktree';
    if (derivedAtomsDisabled())
        return null;
    const candidates = [...new Set(input.files.map((entry) => entry.replace(/\\/g, '/')))].filter(isDerivableSourcePath);
    if (candidates.length === 0)
        return null;
    const diff = spawnSync('git', ['diff', ...(fromWorktree ? ['HEAD'] : ['--cached']), '-U0', '--no-color', '--no-ext-diff', '--', ...candidates], {
        cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024
    });
    if (diff.status !== 0)
        return null;
    const changes = parseUnifiedZeroDiff(diff.stdout);
    const drift = inspectFormalAtomDrift(input.cwd);
    const files = [];
    const skippedFiles = [];
    for (const [filePath, change] of changes) {
        if (drift.staleFiles.has(filePath)) {
            skippedFiles.push(filePath);
            continue;
        }
        const oldText = readGitBlob(input.cwd, `HEAD:${filePath}`) ?? '';
        const newText = fromWorktree
            ? (existsSync(path.join(input.cwd, filePath)) ? readFileSync(path.join(input.cwd, filePath), 'utf8') : '')
            : readGitBlob(input.cwd, `:${filePath}`) ?? '';
        if (oldText.includes('\u0000') || newText.includes('\u0000')) {
            skippedFiles.push(filePath);
            continue;
        }
        const oldAtoms = deriveAtomsFromText(filePath, oldText);
        const newAtoms = deriveAtomsFromText(filePath, newText);
        const touched = atomsTouchedByChange({
            oldAtoms,
            newAtoms,
            oldSpans: change.oldSpans,
            newSpans: change.newSpans,
            oldText,
            newText
        });
        files.push({
            filePath,
            touched: touched.touched,
            fileLevel: touched.fileLevel,
            preambleAdditive: isPreambleChangeAdditive({ hunks: change.hunks, oldAtoms, newAtoms })
        });
    }
    const registryPath = path.join(input.cwd, BROKER_REGISTRY_RELATIVE_PATH);
    const activeIntents = existsSync(registryPath) ? loadRegistry(registryPath, { persistCleanup: false }).activeIntents : [];
    const conflicts = findDerivedAtomConflicts({ taskId: input.taskId, files, activeIntents });
    const refs = derivedAtomRefs(files.flatMap((file) => file.touched));
    return { files, skippedFiles, refs, conflicts };
}
/** Record confirmed atoms on the task's active broker intent (no-op when the task has none). */
export function recordConfirmedDerivedAtoms(input) {
    const registryPath = path.join(input.cwd, BROKER_REGISTRY_RELATIVE_PATH);
    if (input.refs.length === 0 || !existsSync(registryPath))
        return false;
    const authority = createBrokerTransactionAuthority(registryPath);
    if (!authority.read().document.activeIntents.some((intent) => intent.taskId === input.taskId))
        return false;
    commitBrokerRegistryTransaction({
        store: authority.store,
        operation: 'register',
        taskId: input.taskId,
        actorId: input.actorId,
        idempotencyKey: `derived-atoms-confirm:${input.taskId}:${input.refs.map((ref) => ref.atomCid).sort().join(',')}`,
        mutate: (doc) => mergeIntentDerivedAtoms(doc, input.taskId, input.refs)
    });
    return true;
}
