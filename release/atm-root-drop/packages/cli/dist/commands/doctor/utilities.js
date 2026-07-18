import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadCharterAuthorityBundle } from '../../../../integrations-core/dist/compiler/charter-block.js';
export function createCheck(name, ok, details) {
    return {
        name,
        ok: ok === true,
        details: (details && typeof details === 'object' ? details : null)
    };
}
export function createIntegrationDriftRemediation(integrationHealth) {
    const failedAdapters = (integrationHealth?.failed ?? []).map((entry) => {
        const adapterId = typeof entry.adapterId === 'string' && entry.adapterId.length > 0 ? entry.adapterId : null;
        return {
            adapterId,
            manifestPath: entry.manifestPath ?? null,
            status: entry.status ?? null,
            driftedFiles: Array.isArray(entry.driftedFiles) ? entry.driftedFiles : [],
            verifyCommand: adapterId ? `node atm.mjs integration verify ${adapterId} --json` : null,
            reinstallCommand: adapterId ? `node atm.mjs integration add ${adapterId} --force --json` : null,
            removeCommand: adapterId ? `node atm.mjs integration remove ${adapterId} --json` : null
        };
    });
    const first = failedAdapters.find((entry) => entry.adapterId) ?? null;
    return {
        schemaId: 'atm.integrationDriftRemediation.v1',
        failedAdapters,
        recommendedAction: first
            ? `Run ${first.verifyCommand}; if drift is expected, run ${first.reinstallCommand}. If the adapter is obsolete, run ${first.removeCommand}.`
            : 'Run node atm.mjs integration verify <id> --json for each failed adapter, then reinstall or remove the drifted integration manifest.'
    };
}
export function readJsonIfExists(filePath) {
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null;
}
export function listPackageDirs(root) {
    const packagesRoot = path.join(root, 'packages');
    if (!existsSync(packagesRoot))
        return [];
    return readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')));
}
export function packageDirLabel(root, packageDir) { return readJsonIfExists(path.join(root, packageDir, 'package.json'))?.name ?? packageDir; }
export function listFiles(directory) {
    if (!existsSync(directory))
        return [];
    const entries = readdirSync(directory, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listFiles(absolutePath);
        }
        return [absolutePath];
    });
}
export function checkCharterIntegrity(root) {
    const charterPath = path.join(root, '.atm', 'charter', 'atomic-charter.md');
    const invariantsPath = path.join(root, '.atm', 'charter', 'charter-invariants.json');
    const charterPresent = existsSync(charterPath);
    const invariantsPresent = existsSync(invariantsPath);
    let invariantsParseable = false;
    let hashField = null;
    if (invariantsPresent) {
        try {
            const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8'));
            invariantsParseable = true;
            hashField = typeof parsed.charterHash === 'string' ? parsed.charterHash : null;
        }
        catch {
            invariantsParseable = false;
        }
    }
    // When .atm/charter/ doesn't exist the project has not adopted the charter yet — not a failure.
    // Only fail when the charter directory exists but files are missing or corrupt.
    const charterDirExists = existsSync(path.join(root, '.atm', 'charter'));
    const ok = !charterDirExists || (charterPresent && invariantsPresent && invariantsParseable);
    return {
        ok,
        charterPath: path.relative(root, charterPath).replace(/\\/g, '/'),
        charterInvariantsPath: path.relative(root, invariantsPath).replace(/\\/g, '/'),
        charterPresent,
        invariantsPresent,
        invariantsParseable,
        hashField
    };
}
export function checkCharterIntegrityV2(root) {
    const charterPath = path.join(root, '.atm', 'charter', 'atomic-charter.md');
    const firstPrinciplesPath = path.join(root, '.atm', 'charter', 'atm-first-principles.md');
    const invariantsPath = path.join(root, '.atm', 'charter', 'charter-invariants.json');
    const charterPresent = existsSync(charterPath);
    const firstPrinciplesPresent = existsSync(firstPrinciplesPath);
    const invariantsPresent = existsSync(invariantsPath);
    let invariantsParseable = false;
    let hashField = null;
    if (invariantsPresent) {
        try {
            const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8'));
            invariantsParseable = true;
            hashField = typeof parsed.charterHash === 'string' ? parsed.charterHash : null;
        }
        catch {
            invariantsParseable = false;
        }
    }
    const charterDirExists = existsSync(path.join(root, '.atm', 'charter'));
    const bundle = charterDirExists ? loadCharterAuthorityBundle(root) : null;
    const ok = !charterDirExists || (charterPresent && firstPrinciplesPresent && invariantsPresent && invariantsParseable && bundle?.ok === true);
    return {
        ok,
        charterPath: path.relative(root, charterPath).replace(/\\/g, '/'),
        firstPrinciplesPath: path.relative(root, firstPrinciplesPath).replace(/\\/g, '/'),
        charterInvariantsPath: path.relative(root, invariantsPath).replace(/\\/g, '/'),
        charterPresent,
        firstPrinciplesPresent,
        invariantsPresent,
        invariantsParseable,
        hashField,
        bundle
    };
}
