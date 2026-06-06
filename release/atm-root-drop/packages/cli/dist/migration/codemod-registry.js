/**
 * Codemod registry for ATM migration tooling.
 *
 * A codemod is a pure transformation function:
 *   (content: string, relativePath: string) => string | null
 *
 * Return null when the codemod does not apply to this file, or when the file
 * does not need transformation (already up-to-date).  Return the transformed
 * content string when a change should be written.
 */
// ---------------------------------------------------------------------------
// Built-in codemods
// ---------------------------------------------------------------------------
/**
 * atm-chart-version-bump
 *
 * Transforms the `atm_chart_version` frontmatter field in an ATMChart file
 * from any version that is NOT the latest to the expected target version.
 * The codemod is parameterised via closures at plan-time so it can be used
 * for any from→to pair.
 */
function makeAtmChartVersionBump(fromVersion, toVersion) {
    return (content, relativePath) => {
        // Only applies to ATMChart markdown files
        if (!relativePath.endsWith('atm-chart.md')) {
            return null;
        }
        const pattern = new RegExp(`^(atm_chart_version:\\s*)${escapeRegExp(fromVersion)}\\r?$`, 'm');
        if (!pattern.test(content)) {
            return null; // already migrated or different version
        }
        const replacePattern = new RegExp(`^(atm_chart_version:\\s*)${escapeRegExp(fromVersion)}(\\r?)$`, 'm');
        return content.replace(replacePattern, (_match, prefix, cr) => `${prefix}${toVersion}${cr}`);
    };
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const registry = new Map();
/** Register a codemod so the migration planner can look it up. */
export function registerCodemod(entry) {
    registry.set(entry.id, entry);
}
/** Look up a registered codemod by id. */
export function getCodemod(id) {
    return registry.get(id);
}
/** List all registered codemod ids. */
export function listCodemods() {
    return [...registry.keys()];
}
// ---------------------------------------------------------------------------
// Factory helpers used by the migration planner
// ---------------------------------------------------------------------------
/**
 * Build the full set of CodemodEntry objects needed for a specific migration
 * step (fromVersion → toVersion) given the codemod ids declared in the
 * migration index entry.
 */
export function resolveCodemodsForMigration(codemodIds, fromVersion, toVersion) {
    const entries = [];
    for (const id of codemodIds) {
        if (id === 'atm-chart-version-bump') {
            entries.push({
                id,
                description: `Bump atm_chart_version in ATMChart from ${fromVersion} to ${toVersion}`,
                targetPattern: '**atm-chart.md',
                apply: makeAtmChartVersionBump(fromVersion, toVersion)
            });
        }
        else {
            const registered = registry.get(id);
            if (registered) {
                entries.push(registered);
            }
        }
    }
    return entries;
}
