/**
 * Charter invariants block renderer for integration skills.
 *
 * The renderer consumes the repository-local charter authority bundle so skill
 * injection fails closed when the charter, first principles, or invariants drift.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function loadCharterAuthorityBundle(repositoryRoot) {
    const atomicCharterPath = path.join(repositoryRoot, '.atm', 'charter', 'atomic-charter.md');
    const firstPrinciplesPath = path.join(repositoryRoot, '.atm', 'charter', 'atm-first-principles.md');
    const invariantsPath = path.join(repositoryRoot, '.atm', 'charter', 'charter-invariants.json');
    const repairCommand = 'node atm.mjs init --adopt default --force --json';
    const errors = [];
    const atomicCharter = readRequiredText(atomicCharterPath, errors);
    const firstPrinciples = readRequiredText(firstPrinciplesPath, errors);
    const invariantsText = readRequiredText(invariantsPath, errors);
    let parsed = null;
    if (invariantsText !== null) {
        try {
            parsed = JSON.parse(invariantsText);
        }
        catch {
            errors.push('charter-invariants.json is not parseable JSON');
        }
    }
    const invariants = Array.isArray(parsed?.invariants) ? parsed.invariants : [];
    if (parsed && invariants.length === 0) {
        errors.push('charter-invariants.json has no invariants');
    }
    if (parsed && !parsed.scheduleA) {
        errors.push('charter-invariants.json is missing Schedule A economic thresholds');
    }
    if (parsed && atomicCharter !== null && typeof parsed.charterHash === 'string') {
        const actual = sha256Text(atomicCharter);
        if (parsed.charterHash !== actual) {
            errors.push(`atomic-charter.md hash mismatch: expected ${parsed.charterHash}, got ${actual}`);
        }
    }
    if (parsed && firstPrinciples !== null && typeof parsed.firstPrinciplesHash === 'string') {
        const actual = sha256Text(firstPrinciples);
        if (parsed.firstPrinciplesHash !== actual) {
            errors.push(`atm-first-principles.md hash mismatch: expected ${parsed.firstPrinciplesHash}, got ${actual}`);
        }
    }
    return {
        ok: errors.length === 0,
        atomicCharterPath: relativeRepoPath(repositoryRoot, atomicCharterPath),
        firstPrinciplesPath: relativeRepoPath(repositoryRoot, firstPrinciplesPath),
        invariantsPath: relativeRepoPath(repositoryRoot, invariantsPath),
        charterVersion: typeof parsed?.charterVersion === 'string' ? parsed.charterVersion : null,
        lastAmendedAt: typeof parsed?.lastAmendedAt === 'string' ? parsed.lastAmendedAt : null,
        invariantCount: invariants.length,
        scheduleA: parsed?.scheduleA ?? null,
        errors,
        repairCommand
    };
}
export function renderCharterInvariantsBlock(repositoryRoot) {
    const invariantsPath = path.join(repositoryRoot, '.atm', 'charter', 'charter-invariants.json');
    if (!existsSync(invariantsPath)) {
        return {
            text: 'Charter invariants are unavailable in this repository yet. Restore `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json` to inject the current repo charter.',
            sourcePath: null,
            invariantCount: 0,
            fallbackReason: 'missing'
        };
    }
    const bundle = loadCharterAuthorityBundle(repositoryRoot);
    if (!bundle.ok) {
        return {
            text: `Charter authority bundle is unavailable or mismatched in this repository. Repair with \`${bundle.repairCommand}\`. Problems: ${bundle.errors.join('; ')}`,
            sourcePath: bundle.invariantsPath,
            invariantCount: 0,
            fallbackReason: 'invalid'
        };
    }
    try {
        const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8'));
        const invariants = Array.isArray(parsed.invariants)
            ? parsed.invariants
                .filter((entry) => typeof entry?.id === 'string' && typeof entry?.title === 'string' && typeof entry?.rule === 'string')
                .map((entry) => ({
                id: entry.id,
                title: entry.title,
                rule: entry.rule,
                enforcement: typeof entry.enforcement === 'string' ? entry.enforcement : 'unknown',
                breakingChange: entry.breakingChange === true
            }))
            : [];
        if (invariants.length === 0) {
            return {
                text: 'Charter invariants are unreadable in this repository. Repair `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json`.',
                sourcePath: relativeRepoPath(repositoryRoot, invariantsPath),
                invariantCount: 0,
                fallbackReason: 'invalid'
            };
        }
        return {
            text: invariants.map((entry) => renderCharterInvariantLine(entry)).join('\n'),
            sourcePath: relativeRepoPath(repositoryRoot, invariantsPath),
            invariantCount: invariants.length,
            fallbackReason: null
        };
    }
    catch {
        return {
            text: 'Charter invariants could not be read in this repository. Repair `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json`.',
            sourcePath: relativeRepoPath(repositoryRoot, invariantsPath),
            invariantCount: 0,
            fallbackReason: 'unreadable'
        };
    }
}
function renderCharterInvariantLine(entry) {
    const breakingChange = entry.breakingChange ? 'yes' : 'no';
    return `- \`${entry.id}\` ??**${entry.title}** (enforcement: \`${entry.enforcement}\`, breaking change: ${breakingChange})\n  Rule: ${entry.rule}`;
}
function readRequiredText(filePath, errors) {
    if (!existsSync(filePath)) {
        errors.push(`missing file: ${filePath}`);
        return null;
    }
    try {
        return readFileSync(filePath, 'utf8');
    }
    catch {
        errors.push(`unreadable file: ${filePath}`);
        return null;
    }
}
function sha256Text(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function relativeRepoPath(repositoryRoot, filePath) {
    return path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
}
