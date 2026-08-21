/**
 * compiler/skill-projection-parity.ts
 *
 * TASK-SKL-0038 — installed-copy projection parity
 *
 * An installed skill copy is a derived artifact. It is compared against the
 * compiled projection, never against the uncompiled template source, and every
 * mismatch resolves to exactly one of four dispositions. There is deliberately
 * no fifth "advisory" state: unbounded advisory drift is how an installed copy
 * quietly becomes a second source of truth.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
/**
 * Report the ways a projection can stop describing the snapshot it claims to
 * come from. A projection that keeps stale provenance is worse than one with
 * none, because downstream verification trusts the recorded fields.
 *
 * The parameters are structural on purpose: a compiled projection and its
 * sealed snapshot satisfy them, and so does any fixture, without this module
 * having to depend on the compiler it checks.
 */
export function collectProjectionMetadataFindings(projection, sourceSnapshot) {
    const findings = [];
    const compare = (field, expected, actual) => {
        if (expected === actual)
            return;
        findings.push({
            field,
            expected,
            actual,
            summary: `projection ${field} ${actual ?? '<missing>'} does not match sealed snapshot ${expected ?? '<missing>'}`
        });
    };
    compare('sourceDigest', sourceSnapshot.sourceDigest, projection.sourceDigest);
    compare('sourceUniverseDigest', sourceSnapshot.sourceUniverseDigest, projection.sourceUniverseDigest);
    compare('compilerVersion', sourceSnapshot.compilerVersion, projection.compilerVersion);
    if (!projection.manifestDigest?.startsWith('sha256:')) {
        findings.push({
            field: 'manifestDigest',
            expected: 'sha256:<digest>',
            actual: projection.manifestDigest ?? null,
            summary: 'projection must carry a manifest digest over its compiled files'
        });
    }
    return findings;
}
export function evaluateInstalledProjectionParity(input) {
    const readText = input.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'));
    const hasFile = input.fileExists ?? existsSync;
    const rulesById = new Map((input.dispositions ?? []).map((rule) => [rule.templateId, rule]));
    const findings = [];
    for (const compiledFile of input.compiledProjectionFiles) {
        const normalizedRelativePath = compiledFile.relativePath.replace(/\\/g, '/');
        if (!normalizedRelativePath.endsWith('/SKILL.md'))
            continue;
        const [templateId] = normalizedRelativePath.split('/');
        if (!templateId)
            continue;
        const installedPath = path.join(input.installedSkillRoot, templateId, 'SKILL.md');
        // An installed copy that does not exist is an install-profile question,
        // not a parity question; discovery findings own that case.
        if (!hasFile(installedPath))
            continue;
        const installedContent = readText(installedPath);
        // Parity compares the compiled projection against the installed copy
        // directly. Re-inserting the source placeholder here is what previously
        // made a mismatch read as "expected {{CHARTER_INVARIANTS}}", blaming the
        // template for what was really an installed-copy divergence.
        const expected = normalizeInstalledText(compiledFile.content);
        const actual = normalizeInstalledText(installedContent);
        if (expected === actual) {
            findings.push({
                templateId,
                installedPath,
                disposition: 'sync',
                summary: 'installed copy matches the compiled projection',
                owningTaskId: null
            });
            continue;
        }
        const rule = rulesById.get(templateId);
        const summary = summarizeFirstInstalledDrift(expected, actual);
        if (!rule) {
            findings.push({ templateId, installedPath, disposition: 'fail-closed', summary, owningTaskId: null });
            continue;
        }
        if (rule.disposition === 'approved-baseline') {
            // A baseline is finite because it pins bytes: the moment the installed
            // copy leaves the pinned digest the baseline stops covering it.
            const installedDigest = createHash('sha256').update(installedContent).digest('hex');
            if (rule.expectedInstalledDigest !== installedDigest) {
                findings.push({
                    templateId,
                    installedPath,
                    disposition: 'fail-closed',
                    summary: `installed copy left approved baseline ${rule.expectedInstalledDigest ?? '<undeclared>'} (now ${installedDigest}); ${summary}`,
                    owningTaskId: rule.owningTaskId
                });
                continue;
            }
        }
        findings.push({
            templateId,
            installedPath,
            disposition: rule.disposition,
            summary: `${rule.disposition} (${rule.owningTaskId}): ${rule.reason}; ${summary}`,
            owningTaskId: rule.owningTaskId
        });
    }
    return { findings, failClosed: findings.filter((finding) => finding.disposition === 'fail-closed') };
}
function normalizeInstalledText(content) {
    return content
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .trimEnd();
}
function summarizeFirstInstalledDrift(expected, actual) {
    const expectedLines = expected.split('\n');
    const actualLines = actual.split('\n');
    const maxLength = Math.max(expectedLines.length, actualLines.length);
    for (let index = 0; index < maxLength; index += 1) {
        if ((expectedLines[index] ?? '') !== (actualLines[index] ?? '')) {
            return `first differing line ${index + 1}: projection ${JSON.stringify(expectedLines[index] ?? '<missing>')}, installed ${JSON.stringify(actualLines[index] ?? '<missing>')}`;
        }
    }
    return 'content differs after normalization';
}
