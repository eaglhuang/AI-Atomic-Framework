import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
export const PLANNING_ROOT_RELATIVE_SUFFIX = path.join('docs', 'ai_atomic_framework');
/**
 * Canonical operator contract for planning-root ambiguity.
 *
 * This module is the registered `sourceOwner` for ATM_PLANNING_ROOT_AMBIGUOUS.
 * The ambiguity decision, its operator diagnostics, and its recovery contract are
 * defined here once so callers consume a single object instead of rescanning the
 * filesystem or assembling their own error text. `docs/governance/error-code-registry.json`
 * mirrors this contract and the focused test asserts the two stay aligned.
 */
export const PLANNING_ROOT_AMBIGUOUS_CODE = 'ATM_PLANNING_ROOT_AMBIGUOUS';
export const PLANNING_ROOT_AMBIGUOUS_RETRYABLE = true;
export const PLANNING_ROOT_AMBIGUOUS_REQUIRES_HUMAN_APPROVAL = false;
/**
 * The single safe, non-destructive route out of an ambiguous planning root.
 * Selecting a root is an operator decision; this module never makes it implicitly.
 */
export const PLANNING_ROOT_AMBIGUOUS_SAFE_NEXT_STEPS = [
    'Re-run the command with an explicit planning root, for example --planning-root <absolute-planning-root>.'
];
/** Read-only inspection preserves every ambiguous root until an owner approves cleanup. */
export const PLANNING_ROOT_AMBIGUOUS_READ_ONLY_STEPS = [
    'Inspect each candidate planning root reported in candidates[] before changing anything on disk.',
    'Run node atm.mjs doctor --json to record the ambiguous roots as governed evidence.'
];
/** Behaviours that would trade a diagnosable stop for a silent guess. */
export const PLANNING_ROOT_AMBIGUOUS_FORBIDDEN_ACTIONS = [
    'auto-cleanup-ambiguous-planning-roots',
    'silently-select-first-planning-root'
];
export function planningRootAmbiguityRecovery() {
    return {
        code: PLANNING_ROOT_AMBIGUOUS_CODE,
        retryable: PLANNING_ROOT_AMBIGUOUS_RETRYABLE,
        requiresHumanApproval: PLANNING_ROOT_AMBIGUOUS_REQUIRES_HUMAN_APPROVAL,
        safeNextSteps: PLANNING_ROOT_AMBIGUOUS_SAFE_NEXT_STEPS,
        readOnlyInspectionSteps: PLANNING_ROOT_AMBIGUOUS_READ_ONLY_STEPS,
        forbiddenActions: PLANNING_ROOT_AMBIGUOUS_FORBIDDEN_ACTIONS
    };
}
export function isDerivativeSiblingRepoName(canonicalName, candidateName) {
    if (canonicalName === candidateName)
        return false;
    if (candidateName.length <= canonicalName.length)
        return false;
    return candidateName.startsWith(`${canonicalName}-`);
}
export function repoDirFromPlanningRoot(planningRoot) {
    const normalized = planningRoot.replace(/\\/g, '/');
    const suffix = `/${PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/')}`;
    if (!normalized.endsWith(suffix))
        return null;
    return path.dirname(path.dirname(planningRoot));
}
export function repoDirNameFromPlanningRoot(planningRoot) {
    const repoDir = repoDirFromPlanningRoot(planningRoot);
    return repoDir ? path.basename(repoDir) : null;
}
export function applyCanonicalSiblingPreference(planningRoots, parentDir, options) {
    const exists = options?.exists ?? existsSync;
    const siblingRoots = planningRoots.filter((root) => {
        const repoDir = repoDirFromPlanningRoot(root);
        return repoDir !== null && path.resolve(path.dirname(repoDir)) === path.resolve(parentDir);
    });
    const siblingNames = uniqueSorted(siblingRoots
        .map((root) => repoDirNameFromPlanningRoot(root))
        .filter((entry) => Boolean(entry)));
    const excluded = new Set();
    for (const candidateName of siblingNames) {
        for (const canonicalName of siblingNames) {
            if (!isDerivativeSiblingRepoName(canonicalName, candidateName))
                continue;
            const candidateRoot = siblingRoots.find((root) => repoDirNameFromPlanningRoot(root) === candidateName);
            if (candidateRoot)
                excluded.add(path.resolve(candidateRoot));
        }
    }
    const filtered = planningRoots.filter((root) => !excluded.has(path.resolve(root)));
    const remainingSiblingNames = filtered
        .filter((root) => {
        const repoDir = repoDirFromPlanningRoot(root);
        return repoDir !== null && path.resolve(path.dirname(repoDir)) === path.resolve(parentDir);
    })
        .map((root) => repoDirNameFromPlanningRoot(root))
        .filter((entry) => Boolean(entry));
    const ambiguousSiblingGroups = [];
    const warnings = [];
    const rootByRepoName = new Map();
    for (const root of filtered) {
        const name = repoDirNameFromPlanningRoot(root);
        if (name && !rootByRepoName.has(name))
            rootByRepoName.set(name, path.resolve(root));
    }
    const derivativeOnlyFamilies = new Map();
    for (const name of remainingSiblingNames) {
        const dashIndex = name.indexOf('-');
        if (dashIndex <= 0)
            continue;
        const base = name.slice(0, dashIndex);
        if (remainingSiblingNames.includes(base))
            continue;
        derivativeOnlyFamilies.set(base, [...(derivativeOnlyFamilies.get(base) ?? []), name]);
    }
    for (const [base, members] of derivativeOnlyFamilies.entries()) {
        if (members.length < 2)
            continue;
        const siblingRepoDirs = uniqueSorted(members);
        ambiguousSiblingGroups.push(siblingRepoDirs);
        warnings.push({
            code: PLANNING_ROOT_AMBIGUOUS_CODE,
            detail: `Multiple sibling planning repos share prefix "${base}" without a canonical "${base}" directory.`,
            prefix: base,
            siblingRepoDirs,
            candidates: siblingRepoDirs.map((repoDirName) => {
                const planningRoot = rootByRepoName.get(repoDirName) ?? path.resolve(parentDir, repoDirName, PLANNING_ROOT_RELATIVE_SUFFIX);
                return {
                    repoDirName,
                    repoDir: path.resolve(parentDir, repoDirName),
                    planningRoot,
                    sourceAvailable: exists(planningRoot)
                };
            }),
            recovery: planningRootAmbiguityRecovery()
        });
    }
    return {
        roots: filtered,
        excludedDerivativeRoots: Array.from(excluded).sort((left, right) => left.localeCompare(right)),
        ambiguousSiblingGroups,
        warnings
    };
}
export function resolveCandidatePlanningRoots(cwd, options) {
    const readDir = options?.readDir ?? safeReadDir;
    const exists = options?.exists ?? existsSync;
    const roots = new Set();
    for (const configuredRoot of options?.configuredRoots ?? []) {
        roots.add(path.isAbsolute(configuredRoot) ? configuredRoot : path.resolve(cwd, configuredRoot));
    }
    roots.add(path.join(cwd, PLANNING_ROOT_RELATIVE_SUFFIX));
    const parent = path.dirname(path.resolve(cwd));
    for (const entry of readDir(parent)) {
        if (!entry.isDirectory())
            continue;
        roots.add(path.join(parent, entry.name, PLANNING_ROOT_RELATIVE_SUFFIX));
    }
    const resolved = Array.from(roots)
        .map((entry) => path.resolve(entry))
        .filter((entry) => exists(entry))
        .sort((left, right) => left.localeCompare(right));
    return applyCanonicalSiblingPreference(resolved, parent, { exists });
}
/**
 * Single entry point for planning-root selection.
 *
 * An explicit operator-supplied root always wins. Otherwise a canonical base
 * directory resolves its derivatives. When a prefix family has no canonical base
 * the selection fails closed: `resolvedRoots` is empty so no caller can fall back
 * to guessing, and `ambiguities[]` carries the candidates, their source
 * availability, and the one safe non-destructive recovery route.
 */
export function selectPlanningRoot(cwd, options) {
    const explicitRoot = options?.explicitRoot;
    if (explicitRoot) {
        const resolvedExplicit = path.isAbsolute(explicitRoot) ? path.resolve(explicitRoot) : path.resolve(cwd, explicitRoot);
        return { status: 'explicit', failClosed: false, resolvedRoots: [resolvedExplicit], ambiguities: [] };
    }
    const resolution = resolveCandidatePlanningRoots(cwd, options);
    if (resolution.warnings.length > 0) {
        return { status: 'ambiguous', failClosed: true, resolvedRoots: [], ambiguities: resolution.warnings };
    }
    return { status: 'canonical', failClosed: false, resolvedRoots: resolution.roots, ambiguities: [] };
}
export function listCandidatePlanningRoots(cwd) {
    return resolveCandidatePlanningRoots(cwd).roots;
}
export function isExcludedDerivativePlanningRoot(taskPath, cwd, resolution) {
    const absoluteTaskPath = path.isAbsolute(taskPath) ? taskPath : path.resolve(cwd, taskPath);
    return resolution.excludedDerivativeRoots.some((root) => {
        const repoDir = repoDirFromPlanningRoot(root);
        return repoDir ? absoluteTaskPath.startsWith(`${repoDir}${path.sep}`) : false;
    });
}
export function isCanonicalPreferredPlanningRoot(taskPath, cwd) {
    const absoluteTaskPath = path.isAbsolute(taskPath) ? path.resolve(taskPath) : path.resolve(cwd, taskPath);
    const resolution = resolveCandidatePlanningRoots(cwd);
    if (isExcludedDerivativePlanningRoot(taskPath, cwd, resolution))
        return false;
    return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`) || absoluteTaskPath.startsWith(`${root.replace(/\\/g, '/')}/`));
}
function safeReadDir(directoryPath) {
    try {
        return readdirSync(directoryPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function uniqueSorted(values) {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
