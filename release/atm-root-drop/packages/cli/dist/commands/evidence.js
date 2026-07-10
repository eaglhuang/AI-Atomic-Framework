import { CliError } from './shared.js';
import { run as runEvidenceAdd } from './evidence/verbs/add.js';
import { run as runEvidenceRun } from './evidence/verbs/run.js';
import { run as runEvidenceVerify } from './evidence/verbs/verify.js';
import { run as runEvidenceDiff } from './evidence/verbs/diff.js';
import { run as runEvidenceValidators } from './evidence/verbs/validators.js';
import { run as runEvidenceMissing } from './evidence/verbs/missing.js';
import { run as runGitHeadEvidenceBackfill } from './evidence/verbs/git-head-backfill.js';
import { runEvidenceHistoricalBatch } from './evidence/historical-batch.js';
import { runEvidenceHistoricalBatchFinalize } from './evidence/historical-batch-finalize.js';
export { verifyTaskEvidence, computeMissingValidatorReport, buildAutoEvidencePlan, executeAutoEvidencePlan, buildTeamArtifactHandoffEvidence, evidenceBundleManifestRelativePath, evidenceBundleManifestPathForTask, readEvidenceBundleManifest, quoteForShell, detectAutoLinkedValidator, EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID, TEAM_ARTIFACT_HANDOFF_EVIDENCE_SCHEMA_ID, TEAM_CLOSURE_ATTESTATION_SCHEMA_ID } from './evidence/bundle-io.js';
export async function runEvidence(argv) {
    const action = (argv[0] ?? '').toLowerCase();
    if (action === 'add')
        return runEvidenceAdd(argv.slice(1));
    if (action === 'run')
        return runEvidenceRun(argv.slice(1));
    if (action === 'git-head-backfill')
        return runGitHeadEvidenceBackfill(argv.slice(1));
    if (action === 'verify')
        return runEvidenceVerify(argv.slice(1));
    if (action === 'diff')
        return runEvidenceDiff(argv.slice(1));
    if (action === 'validators')
        return runEvidenceValidators(argv.slice(1));
    if (action === 'missing')
        return runEvidenceMissing(argv.slice(1));
    if (action === 'historical-batch')
        return runEvidenceHistoricalBatch(argv.slice(1));
    if (action === 'historical-batch-finalize')
        return runEvidenceHistoricalBatchFinalize(argv.slice(1));
    throw new CliError('ATM_CLI_USAGE', 'evidence supports: add, run, git-head-backfill, verify, diff, validators, missing, historical-batch, historical-batch-finalize', { exitCode: 2 });
}
