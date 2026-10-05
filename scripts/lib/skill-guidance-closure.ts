import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Read one entry and its explicitly linked advanced rules for contract checks. */
export function readSkillGuidanceClosure(repositoryRoot: string, entryPath: string) {
  const root = realpathSync(repositoryRoot);
  const readLocal = (filePath: string) => {
    const canonical = realpathSync(filePath);
    const relative = path.relative(root, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Skill guidance reference must remain repository-local: ${entryPath}`);
    }
    return readFileSync(canonical, 'utf8');
  };
  const entry = path.resolve(root, entryPath);
  const entryText = readLocal(entry);
  const link = entryText.match(/\[Advanced governed routes\]\(([^)]+)\)/)?.[1];
  if (!link) return { entryText, text: entryText, referencePath: null };
  const sourceReferenceRoot = path.basename(entry).replace(/\.skill\.md$/, '.files/references');
  const referencePath = path.resolve(path.dirname(entry), link.replace('{{REFERENCE_ROOT}}', sourceReferenceRoot));
  return { entryText, text: `${entryText}\n${readLocal(referencePath)}`, referencePath };
}
