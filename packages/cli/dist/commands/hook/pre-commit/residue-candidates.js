import { normalizeRelativePath, runGitLines } from '../git-index-diagnostics.js';
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
/**
 * A sealed candidate index is the commit surface. Live-worktree residue is
 * intentionally outside that surface while another task's staged work is
 * retained, so it must not be attributed to the candidate commit.
 */
export function resolvePreCommitResidueCandidates(root, scopedIndexActive) {
    const paths = scopedIndexActive
        ? runGitLines(root, ['diff', '--cached', '--name-only'])
        : [...runGitLines(root, ['diff', '--name-only']), ...runGitLines(root, ['ls-files', '--others', '--exclude-standard'])];
    return uniqueSorted(paths.map(normalizeRelativePath).filter(Boolean));
}
