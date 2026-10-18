import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
export function buildCanonicalSkillCatalog(snapshot) {
    const sourceByPath = new Map(snapshot.sourceFiles.map((file) => [file.sourcePath, file.sourceDigest]));
    return {
        schemaId: 'atm.canonicalSkillCatalog.v1',
        compilerVersion: snapshot.compilerVersion,
        sourceDigest: snapshot.sourceDigest,
        entries: snapshot.templates.map((template) => toCatalogEntry(template, sourceByPath.get(template.sourcePath)))
    };
}
export function inferCompanionFiles(repositoryRoot, skillId) {
    const companionRoot = path.join(repositoryRoot, 'templates', 'skills', `${skillId}.files`);
    if (!existsSync(companionRoot))
        return [];
    return [`templates/skills/${skillId}.files/**`];
}
function toCatalogEntry(template, sourceDigest) {
    const frontmatter = template.frontmatter;
    return {
        id: frontmatter.id,
        title: frontmatter.title,
        summary: frontmatter.summary,
        command: frontmatter.command,
        firstCommand: frontmatter.firstCommand,
        owner: frontmatter.owner,
        tier: frontmatter.tier,
        installProfiles: frontmatter.installProfiles,
        invocationPolicy: frontmatter.invocationPolicy,
        companionFiles: frontmatter.companionFiles,
        adapterCapabilityRequirements: frontmatter.adapterCapabilityRequirements,
        sourcePath: template.sourcePath,
        sourceDigest: sourceDigest ?? sha256Text(`${template.sourcePath}\n${template.body}`)
    };
}
function sha256Text(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
