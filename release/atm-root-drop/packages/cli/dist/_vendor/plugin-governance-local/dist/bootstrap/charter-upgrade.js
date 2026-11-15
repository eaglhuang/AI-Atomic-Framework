import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundledRootDropTemplateRoot, renderTemplate } from './bootstrap/bootstrap-support.js';
// Upgrades an adopter's AtomicCharter to the charter bundled with this ATM
// release. Framework-owned invariants (ids present in the bundled template)
// follow the framework; adopter-added invariants, project fields, and unknown
// top-level fields are preserved. Invariants new to this adopter enter an
// advisory window (data on the invariant) unless the caller enforces them now.
const charterFile = '.atm/charter/atomic-charter.md';
const firstPrinciplesFile = '.atm/charter/atm-first-principles.md';
const invariantsFile = '.atm/charter/charter-invariants.json';
const templateFiles = {
    charter: '.atm/charter/atomic-charter.template.md',
    firstPrinciples: '.atm/charter/atm-first-principles.template.md',
    invariants: '.atm/charter/charter-invariants.template.json'
};
// Top-level fields the bundled template owns; every other field is adopter data.
const frameworkOwnedFields = ['schemaId', 'schemaVersion', 'specVersion', 'charterVersion', 'scheduleA', 'invariants'];
export const charterUpgradePaths = [charterFile, firstPrinciplesFile, invariantsFile];
export function compareCharterVersions(left, right) {
    const parse = (value) => (value ?? '0').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < 3; index += 1) {
        const delta = (a[index] ?? 0) - (b[index] ?? 0);
        if (delta !== 0)
            return delta < 0 ? -1 : 1;
    }
    return 0;
}
export function nextPatchVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
    return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : null;
}
export function readBundledCharterVersion(templateRoot = bundledRootDropTemplateRoot) {
    const template = JSON.parse(readFileSync(path.join(templateRoot, templateFiles.invariants), 'utf8'));
    return String(template.charterVersion);
}
export function upgradeCharter(options) {
    const templateRoot = options.templateRoot ?? bundledRootDropTemplateRoot;
    const now = options.now ?? new Date();
    const readTarget = (relative) => {
        const absolute = path.join(options.cwd, relative);
        return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    };
    const readTemplate = (relative) => readFileSync(path.join(templateRoot, relative), 'utf8');
    const before = {
        [charterFile]: readTarget(charterFile),
        [firstPrinciplesFile]: readTarget(firstPrinciplesFile),
        [invariantsFile]: readTarget(invariantsFile)
    };
    const templateText = readTemplate(templateFiles.invariants);
    const bundledVersion = String(JSON.parse(templateText).charterVersion);
    let current = null;
    const conflicts = [];
    if (before[invariantsFile] !== null) {
        try {
            current = JSON.parse(before[invariantsFile]);
        }
        catch {
            conflicts.push(`${invariantsFile} is not parseable JSON; restore it from version control before upgrading.`);
        }
    }
    const currentVersion = typeof current?.charterVersion === 'string' ? current.charterVersion : null;
    if (current && compareCharterVersions(currentVersion, bundledVersion) > 0) {
        conflicts.push(`Adopter charter ${currentVersion} is newer than the bundled charter ${bundledVersion}; upgrade ATM instead of downgrading the charter.`);
    }
    const projectName = typeof current?.projectName === 'string' && current.projectName.trim()
        ? current.projectName
        : path.basename(path.resolve(options.cwd));
    const lastAmendedAt = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const tokens = { PROJECT_NAME: projectName, CHARTER_VERSION: '1.0.0', LAST_AMENDED_DATE: lastAmendedAt };
    const renderedCharter = renderTemplate(readTemplate(templateFiles.charter), tokens);
    const renderedFirstPrinciples = renderTemplate(readTemplate(templateFiles.firstPrinciples), tokens);
    const template = JSON.parse(renderTemplate(templateText, {
        ...tokens,
        ATOMIC_CHARTER_SHA256: `sha256:${sha256(renderedCharter)}`,
        ATM_FIRST_PRINCIPLES_SHA256: `sha256:${sha256(renderedFirstPrinciples)}`
    }));
    const templateInvariants = asInvariants(template.invariants);
    const currentInvariants = asInvariants(current?.invariants);
    const currentById = new Map(currentInvariants.map((entry) => [entry.id, entry]));
    const frameworkIds = new Set(templateInvariants.map((entry) => entry.id));
    const status = conflicts.length > 0
        ? 'conflict'
        : current === null
            ? 'missing'
            : compareCharterVersions(currentVersion, bundledVersion) === 0 && before[firstPrinciplesFile] !== null && Boolean(current.scheduleA)
                ? 'current'
                : 'outdated';
    const addedInvariants = current === null ? [] : templateInvariants.filter((entry) => !currentById.has(entry.id)).map((entry) => entry.id);
    const updatedInvariants = templateInvariants
        .filter((entry) => currentById.has(entry.id) && !sameFrameworkContent(currentById.get(entry.id), entry))
        .map((entry) => entry.id);
    const preservedAdopterInvariants = currentInvariants.filter((entry) => !frameworkIds.has(entry.id)).map((entry) => entry.id);
    const advisoryUntilFrameworkVersion = options.enforceNow || addedInvariants.length === 0 ? null : nextPatchVersion(options.frameworkVersion);
    const report = {
        status,
        currentVersion,
        bundledVersion,
        addedInvariants,
        updatedInvariants,
        preservedAdopterInvariants,
        scheduleAAdded: current !== null && !current.scheduleA,
        advisoryUntilFrameworkVersion,
        conflicts
    };
    if (status === 'current' || status === 'conflict') {
        return { ...report, changedFiles: [], written: false, receiptPath: null };
    }
    const mergedInvariants = [
        ...templateInvariants.map((entry) => (addedInvariants.includes(entry.id) && advisoryUntilFrameworkVersion
            ? { ...entry, stagedEnforcement: { introducedInCharterVersion: bundledVersion, advisoryUntilFrameworkVersion } }
            : entry)),
        ...currentInvariants.filter((entry) => !frameworkIds.has(entry.id))
    ];
    const adopterFields = Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => !frameworkOwnedFields.includes(key)));
    const nextDocument = {
        ...template,
        ...adopterFields,
        projectName,
        lastAmendedAt,
        charterHash: template.charterHash,
        firstPrinciplesHash: template.firstPrinciplesHash,
        migration: { strategy: 'charter-upgrade', fromVersion: currentVersion, notes: `Upgraded by atm charter upgrade to ${bundledVersion}.` },
        invariants: mergedInvariants
    };
    const after = {
        [charterFile]: renderedCharter,
        [firstPrinciplesFile]: renderedFirstPrinciples,
        [invariantsFile]: `${JSON.stringify(nextDocument, null, 2)}\n`
    };
    const changedFiles = Object.keys(after).filter((file) => before[file] !== after[file]);
    if (!options.write) {
        return { ...report, changedFiles, written: false, receiptPath: null };
    }
    for (const [file, text] of Object.entries(after)) {
        const absolute = path.join(options.cwd, file);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, text, 'utf8');
    }
    const receiptPath = `.atm/history/evidence/charter-upgrade-${now.toISOString().replace(/[:.]/g, '-')}.json`;
    const receiptAbsolute = path.join(options.cwd, receiptPath);
    mkdirSync(path.dirname(receiptAbsolute), { recursive: true });
    writeFileSync(receiptAbsolute, `${JSON.stringify({
        schemaId: 'atm.charterUpgradeReceipt',
        specVersion: '0.1.0',
        upgradedAt: now.toISOString(),
        fromVersion: currentVersion,
        toVersion: bundledVersion,
        addedInvariants,
        updatedInvariants,
        preservedAdopterInvariants,
        advisoryUntilFrameworkVersion,
        previousFiles: Object.fromEntries(Object.entries(before).map(([file, text]) => [file, text === null ? null : { sha256: sha256(text), content: text }]))
    }, null, 2)}\n`, 'utf8');
    return { ...report, changedFiles, written: true, receiptPath };
}
function asInvariants(value) {
    return Array.isArray(value)
        ? value.filter((entry) => Boolean(entry) && typeof entry.id === 'string')
        : [];
}
function sameFrameworkContent(left, right) {
    const { stagedEnforcement: _staged, ...rest } = left;
    return JSON.stringify(rest) === JSON.stringify(right);
}
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
