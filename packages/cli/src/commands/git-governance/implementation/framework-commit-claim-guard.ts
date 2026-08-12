import type { FrameworkCommitAuthorityContext } from '../../framework-development/framework-temp-publication-capability.ts';
import { CliError, quoteCliValue } from '../../shared.ts';

/**
 * Enforces the sole authority boundary for taskless framework commits.
 *
 * A task id normally supplies the commit scope. Without one, the caller must
 * present a live temporary claim for the current lane; the shared Git index is
 * never an authority source.
 */
export function assertFrameworkCommitClaimAuthority(input: {
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly authority: FrameworkCommitAuthorityContext;
}): void {
  if (!input.authority.frameworkClaimRequired || input.authority.usesFrameworkClaimCommit) return;

  throw new CliError(
    'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED',
    'A taskless framework commit requires one live temporary claim bound to the current lane; refusing to infer scope from the shared staged index.',
    {
      exitCode: 1,
      details: {
        actorId: input.actorId,
        laneSessionId: input.laneSessionId,
        requiredCommand: `node atm.mjs framework-mode claim --actor ${quoteCliValue(input.actorId)} --files "<claimed-files>" --json`,
      },
    },
  );
}
