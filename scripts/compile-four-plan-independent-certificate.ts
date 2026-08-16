/**
 * Compile the Plan 3.0-4.0 independent certificate from what is on disk and on
 * the remote right now.
 *
 * The certificate compiler in packages/core is pure: it judges, it does not
 * look. This script is the only thing that looks. It reads the previous
 * certificate for the claims it made — which dimensions were asserted, which
 * reviewers were named — re-observes every artifact those claims depend on,
 * resolves the target HEAD and origin/main at execution time, and hands the
 * readings to the compiler. The verdict is whatever the compiler returns.
 * There is no path here that can raise a verdict, only paths that report one.
 *
 *   node --strip-types scripts/compile-four-plan-independent-certificate.ts --mode validate
 *   node --strip-types scripts/compile-four-plan-independent-certificate.ts --mode write
 *
 * validate (default) recompiles against live state and fails when the committed
 * certificate no longer matches, which is what makes a stale certificate loud
 * instead of silent. write refreshes the committed certificate.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  composeEvidenceDigest,
  compileFourPlanIndependentCertificate,
  type FourPlanEvidenceObservation,
  type FourPlanIndependentCertificate,
  type FourPlanReleaseSurface,
  type FourPlanReviewer
} from '../packages/core/src/evidence/four-plan-independent-certificate.ts';

const CERTIFICATE_PATH = 'docs/reports/plan-3x-4x-independent-certificate.json';
const OBJECTIVE_AUDIT_PATH = 'governance-optimization/plan-3x-4x-objective-audit-2026-07-31.json';
const BLOCKER_MAP_PATH = 'docs/reports/plan-3x-4x-closeout-blocker-map.json';
const CLOSEBACK_PATH = 'docs/reports/plan-3x-4x-release-closeback.json';
const REVIEWER_A_PATH = 'docs/reports/reviews/plan-3x-4x-objective-authority-review.json';
const REVIEWER_B_PATH = 'docs/reports/reviews/plan-3x-4x-runbook-release-review.json';
const REMOTE = 'origin';
const BRANCH = 'main';

/**
 * Certificate inputs are declared authority, not fields copied from the last
 * certificate.  The latter makes a bad reviewer graph self-perpetuating:
 * refreshing a certificate would merely preserve its old self-reference.
 */
const DIMENSION_SPECS = [
  { dimensionId: 'objective-verdict', evidenceRefs: ['docs/reports/plan-3-0-objective-replay.json', 'docs/reports/plan-3-1-objective-replay.json', 'docs/reports/plan-3-2-objective-replay.json', 'docs/reports/plan4-successor-wave-objective-map.json'] },
  { dimensionId: 'card-state-verdict', evidenceRefs: ['.atm/history/tasks/ATM-GOV-0340.json', '.atm/history/tasks/ATM-GOV-0341.json'] },
  { dimensionId: 'incident-verdict', evidenceRefs: ['docs/reports/plan-3x-4x-backlog-disposition-census.json', 'docs/reports/plan-3x-4x-backlog-deferred-waiver-register.json'] },
  { dimensionId: 'freshness-verdict', evidenceRefs: ['release/atm-onefile/release-manifest.json', 'scripts/validate-runner-reproducibility.ts'] },
  { dimensionId: 'charter-verdict', evidenceRefs: ['docs/reports/plan-3x-4x-charter-current-verdict.json'] },
  { dimensionId: 'release-verdict', evidenceRefs: [CLOSEBACK_PATH] }
] as const;

/**
 * Which artifact backs each release surface. A surface with no declared
 * artifact cannot be re-observed, and the certificate says so rather than
 * copying its expected digest into the observed slot.
 */
const RELEASE_SURFACE_ARTIFACTS: Readonly<Record<string, string | null>> = {
  'frozen-runner': 'release/atm-onefile/atm.mjs',
  'root-drop': 'atm.mjs'
};

interface CompileOutcome {
  readonly certificate: FourPlanIndependentCertificate;
  readonly targetHead: string;
  readonly originMain: string;
}

interface CloseoutProjection {
  readonly closeback: Record<string, any>;
  readonly certificate: FourPlanIndependentCertificate;
  readonly objectiveAudit: Record<string, any>;
  readonly blockerMap: Record<string, any>;
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
}

function gitOk(args: readonly string[]): boolean {
  try {
    execFileSync('git', [...args], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitAt(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function gitOkAt(repoRoot: string, args: readonly string[]): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function digestOf(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function digestValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex')}`;
}

function readJson(path: string): Record<string, any> {
  if (!existsSync(path)) throw new Error(`missing independent reviewer receipt: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, any>;
}

function reviewerFromReceipt(path: string): FourPlanReviewer {
  const receipt = readJson(path);
  const inputDigests = Array.isArray(receipt.inputDigests) ? receipt.inputDigests : [];
  return {
    reviewerId: String(receipt.reviewerId ?? ''),
    roles: [String(receipt.reviewerRole ?? '')].filter(Boolean),
    outputPath: path,
    // The certificate binds the observable receipt bytes. `reviewDigest` is a
    // reviewer-internal semantic signature and deliberately excludes itself,
    // so it cannot prove that the declared output path still contains that
    // receipt.
    digest: digestOf(path),
    inputPaths: inputDigests.map((entry: Record<string, any>) => String(entry.path ?? '')).filter(Boolean),
    inputDigests: inputDigests.map((entry: Record<string, any>) => String(entry.digest ?? '')).filter(Boolean)
  };
}

function sourceLocation(inputPath: string): { absolutePath: string; repoRoot: string; repoPath: string } {
  const absolutePath = path.resolve(inputPath);
  const repoRoot = gitAt(path.dirname(absolutePath), ['rev-parse', '--show-toplevel']);
  const repoPath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  return { absolutePath, repoRoot, repoPath };
}

function dimensionsFromAuthority(closeback: Record<string, any>): FourPlanIndependentCertificate['dimensions'] {
  return DIMENSION_SPECS.map(({ dimensionId, evidenceRefs }) => ({
    dimensionId,
    // Every authority starts as a positive claim. Missing, dirty, unreachable,
    // mismatched, or reviewer-negative evidence is turned into not-complete by
    // the pure compiler; no prior certificate can elevate it.
    status: 'proven' as const,
    digest: composeEvidenceDigest(evidenceRefs.map((path) => ({
      path,
      digest: path === CLOSEBACK_PATH ? digestValue(closeback) : existsSync(path) ? digestOf(path) : ''
    }))),
    evidenceRefs: [...evidenceRefs],
    reviewerRole: null
  }));
}

function resolveOriginMain(): string {
  const output = git(['ls-remote', REMOTE, `refs/heads/${BRANCH}`]);
  const sha = output.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`unable to resolve ${REMOTE}/${BRANCH} from the remote; refusing to compile a certificate without a live remote SHA`);
  }
  return sha;
}

function resolveLocalHead(): string {
  const sha = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('unable to resolve local HEAD for release closeback');
  return sha;
}

function isTargetReachableFromRemote(targetHead: string, originMain: string): boolean {
  if (targetHead === originMain) return true;
  // `ls-remote` is authoritative for the remote tip, but the object may not
  // exist locally. A missing object is deliberately not guessed as reachable.
  return gitOk(['cat-file', '-e', `${originMain}^{commit}`])
    && gitOk(['cat-file', '-e', `${targetHead}^{commit}`])
    && gitOk(['merge-base', '--is-ancestor', targetHead, originMain]);
}

function projectReleaseCloseback(targetHead: string, recordedOriginMain: string, liveOriginMain: string, generatedAt: string): Record<string, any> {
  const targetReachable = isTargetReachableFromRemote(targetHead, liveOriginMain);
  const originContinuity = isTargetReachableFromRemote(recordedOriginMain, liveOriginMain);
  const status = targetReachable ? 'pushed' : 'not-pushed';
  const releaseSurfaces = [
    { surfaceId: 'target-head', expectedDigest: targetHead, observedDigest: recordedOriginMain, reachable: targetReachable },
    { surfaceId: 'origin-main', expectedDigest: recordedOriginMain, observedDigest: recordedOriginMain, reachable: originContinuity },
    ...Object.entries(RELEASE_SURFACE_ARTIFACTS).map(([surfaceId, artifact]) => {
      const digest = artifact !== null && existsSync(artifact) ? digestOf(artifact) : '';
      return { surfaceId, expectedDigest: digest, observedDigest: digest, reachable: digest.length > 0 };
    })
  ];
  return {
    schemaId: 'atm.fourPlanReleaseCloseback.v1',
    specVersion: '0.1.0',
    generatedAt,
    taskId: 'ATM-GOV-0341',
    targetRepo: process.cwd().replace(/\\/g, '/'),
    planningRepo: 'C:/Users/User/3KLife',
    targetHead,
    originMain: recordedOriginMain,
    remoteReachability: { checked: true, targetHeadReachableFromOriginMain: targetReachable, status },
    releaseSurfaces,
    status,
    diagnostics: targetReachable
      ? ['target HEAD is remote-reachable from origin/main', 'release surface parity is current; independent certificate still governs final completion']
      : ['target HEAD is not remote-reachable from origin/main; release remains blocked'],
    legacyAuthority: {
      retired: false,
      reversible: true,
      reason: 'Independent certificate is the final authority for release authorization; unpushed targets never retire legacy authority.'
    }
  };
}

function observe(paths: readonly string[], targetHead: string, closeback: Record<string, any>): FourPlanEvidenceObservation[] {
  return paths.map((inputPath) => {
    if (inputPath === CLOSEBACK_PATH) {
      return {
        path: inputPath,
        present: true,
        digest: digestValue(closeback),
        tracked: true,
        dirty: false,
        lastCommit: String(closeback.targetHead ?? ''),
        reachableFromTargetHead: isTargetReachableFromRemote(String(closeback.targetHead ?? ''), targetHead)
      };
    }
    const present = existsSync(inputPath);
    let location: { absolutePath: string; repoRoot: string; repoPath: string } | null = null;
    try { if (present) location = sourceLocation(inputPath); } catch { location = null; }
    const tracked = location !== null && gitOkAt(location.repoRoot, ['ls-files', '--error-unmatch', '--', location.repoPath]);
    const dirty = tracked && location !== null && gitAt(location.repoRoot, ['status', '--porcelain', '--', location.repoPath]).trim().length > 0;
    const lastCommit = tracked && location !== null ? gitAt(location.repoRoot, ['log', '-1', '--format=%H', '--', location.repoPath]) : '';
    return {
      path: inputPath,
      present,
      digest: present ? digestOf(inputPath) : '',
      tracked,
      dirty,
      lastCommit,
      reachableFromTargetHead:
        lastCommit.length === 40 && location !== null && gitOkAt(location.repoRoot, ['merge-base', '--is-ancestor', lastCommit, targetHead])
    };
  });
}

/**
 * Both required surfaces are observed on the remote, never on the local HEAD.
 * A certificate authorizes what is published; a commit that exists only in this
 * working copy is not published, and binding to the local HEAD would make every
 * certificate invalidate itself the moment it is committed.
 */
function buildReleaseSurfaces(
  closeback: Record<string, any>,
  originMain: string
): FourPlanReleaseSurface[] {
  const declared: readonly Record<string, any>[] = Array.isArray(closeback.releaseSurfaces) ? closeback.releaseSurfaces : [];
  const recordedOriginMain = String(closeback.originMain ?? '');
  const surfaces: FourPlanReleaseSurface[] = [
    {
      surfaceId: 'target-head',
      expectedDigest: String(closeback.targetHead ?? ''),
      observedDigest: recordedOriginMain,
      reachable: isTargetReachableFromRemote(String(closeback.targetHead ?? ''), originMain)
    },
    {
      surfaceId: 'origin-main',
      expectedDigest: recordedOriginMain,
      observedDigest: recordedOriginMain,
      reachable: isTargetReachableFromRemote(recordedOriginMain, originMain)
    }
  ];
  for (const entry of declared) {
    const surfaceId = String(entry.surfaceId ?? '');
    if (surfaceId === 'target-head' || surfaceId === 'origin-main') continue;
    const artifact = RELEASE_SURFACE_ARTIFACTS[surfaceId] ?? null;
    const observable = artifact !== null && existsSync(artifact);
    surfaces.push({
      surfaceId,
      expectedDigest: String(entry.expectedDigest ?? ''),
      observedDigest: observable ? digestOf(artifact as string) : '',
      reachable: observable
    });
  }
  return surfaces;
}

function compile(generatedAt: string, closeback: Record<string, any>, liveOriginMain: string): CompileOutcome {
  // Evidence freshness is judged against the live published tip so a
  // governance successor commit can remain reachable. Certificate identity
  // stays bound to the sealed origin snapshot in closeback.
  const targetHead = liveOriginMain;
  const recordedOriginMain = String(closeback.originMain ?? liveOriginMain);

  const dimensions = dimensionsFromAuthority(closeback);
  const reviewers: FourPlanReviewer[] = [
    reviewerFromReceipt(REVIEWER_A_PATH),
    reviewerFromReceipt(REVIEWER_B_PATH)
  ];

  const referenced = [
    ...new Set<string>([
      ...dimensions.flatMap((dimension: { evidenceRefs: readonly string[] }) => dimension.evidenceRefs),
      ...reviewers.flatMap((reviewer) => [reviewer.outputPath, ...(reviewer.inputPaths ?? [])])
    ])
  ]
    .filter((path) => path.length > 0 && path !== CERTIFICATE_PATH)
    .sort();

  const certificate = compileFourPlanIndependentCertificate({
    certificateId: 'ATM-GOV-0341-independent-four-plan-certificate',
    certificatePath: CERTIFICATE_PATH,
    generatedAt,
    writerRole: 'certificate-writer',
    reviewers,
    minimumIndependentReviewers: 2,
    forbiddenReviewerRoles: ['certificate-writer', 'closure-actor', 'evidence-producer', 'fixture-generator', 'implementer', 'override-approver'],
    dimensions,
    evidenceObservations: observe(referenced, targetHead, closeback),
    releaseSurfaces: buildReleaseSurfaces(closeback, liveOriginMain),
    mutationControls: ['digest-parity-before-release', 'fail-closed-on-not-complete', 'independent-reviewer-role-separation', 'no-legacy-retirement-with-stale-or-unpushed-surface'],
    provenance: {
      compiledBy: 'scripts/compile-four-plan-independent-certificate.ts',
      observedRemoteHead: recordedOriginMain,
      originMain: recordedOriginMain,
      remoteRef: `${REMOTE}/${BRANCH}`,
      closebackDigest: digestValue(closeback),
      closebackTargetHead: String(closeback.targetHead ?? ''),
      taskId: 'ATM-GOV-0341',
      reviewerReceipts: [REVIEWER_A_PATH, REVIEWER_B_PATH]
    }
  });
  return { certificate, targetHead, originMain: recordedOriginMain };
}

function certificateIsProven(certificate: FourPlanIndependentCertificate): boolean {
  return certificate.status === 'proven'
    && certificate.overallVerdict === 'complete'
    && certificate.releaseAuthorized === true
    && certificate.diagnostics.length === 0
    && certificate.independentReviewerCount >= certificate.minimumIndependentReviewers
    && ['objective-verdict', 'card-state-verdict', 'incident-verdict', 'freshness-verdict', 'charter-verdict', 'release-verdict']
      .every((dimensionId) => certificate.dimensions.find((entry) => entry.dimensionId === dimensionId)?.status === 'proven');
}

/**
 * The certificate has two consumers that bind to its digest.  Project all
 * three artifacts from one observed certificate so a normal write can never
 * leave a new producer beside stale consumer bindings.  This deliberately
 * preserves the audit's objective evidence and the map's explanatory text:
 * only the certificate-derived state is projected here.
 */
function projectCloseoutArtifacts(
  certificate: FourPlanIndependentCertificate,
  closeback: Record<string, any>,
  generatedAt: string
): CloseoutProjection {
  const objectiveAudit = JSON.parse(readFileSync(OBJECTIVE_AUDIT_PATH, 'utf8')) as Record<string, any>;
  const blockerMap = JSON.parse(readFileSync(BLOCKER_MAP_PATH, 'utf8')) as Record<string, any>;
  const independentReviewProven = certificateIsProven(certificate);
  objectiveAudit.releasePushProvenance = {
    ...objectiveAudit.releasePushProvenance,
    status: closeback.status === 'pushed' ? 'proven' : 'not-complete'
  };
  const sharedControls = [objectiveAudit.backlogCensus, objectiveAudit.releasePushProvenance]
    .every((control) => control?.status === 'proven');
  const rowsProven = Array.isArray(objectiveAudit.rows)
    && objectiveAudit.rows.every((row: Record<string, any>) => row.status === 'proven');
  const certificateCanBeProven = rowsProven
    && (objectiveAudit.unknownRows ?? []).length === 0
    && (objectiveAudit.unresolvedRows ?? []).length === 0
    && sharedControls
    && independentReviewProven
    && objectiveAudit.legacyAuthority?.reversible === true;

  objectiveAudit.resultDigest = certificate.certificateDigest;
  objectiveAudit.independentReview = {
    ...objectiveAudit.independentReview,
    status: independentReviewProven ? 'proven' : 'not-complete'
  };
  objectiveAudit.status = certificateCanBeProven ? 'proven' : 'not-certified';
  objectiveAudit.legacyAuthority = {
    ...objectiveAudit.legacyAuthority,
    retired: certificateCanBeProven
  };
  if (!certificateCanBeProven) {
    objectiveAudit.supersession = {
      ...objectiveAudit.supersession,
      blockers: [...certificate.diagnostics]
    };
  }

  blockerMap.generatedAt = generatedAt;
  blockerMap.sourceReports = (blockerMap.sourceReports ?? []).map((entry: Record<string, any>) =>
    entry.path === CERTIFICATE_PATH
      ? { ...entry, digest: certificate.certificateDigest }
      : entry
  );
  const certificateBlocker = (blockerMap.blockerClasses ?? []).find((entry: Record<string, any>) => entry.id === 'B5-release-certificate');
  if (certificateBlocker) certificateBlocker.status = certificateIsProven(certificate) ? 'resolved' : 'open';
  return { closeback, certificate, objectiveAudit, blockerMap };
}

function writeCloseoutProjection(projection: CloseoutProjection): void {
  const targets = [
    [CLOSEBACK_PATH, projection.closeback],
    [CERTIFICATE_PATH, projection.certificate],
    [OBJECTIVE_AUDIT_PATH, projection.objectiveAudit],
    [BLOCKER_MAP_PATH, projection.blockerMap]
  ] as const;
  // Read and serialize every target before the first mutation: malformed or
  // inaccessible consumers fail before this command changes any artifact.
  const originals = targets.map(([path]) => [path, readFileSync(path, 'utf8')] as const);
  const contents = targets.map(([path, value]) => [path, `${JSON.stringify(value, null, 2)}\n`] as const);
  try {
    for (const [path, content] of contents) writeFileSync(path, content, 'utf8');
    const writtenAudit = JSON.parse(readFileSync(OBJECTIVE_AUDIT_PATH, 'utf8')) as Record<string, any>;
    const writtenMap = JSON.parse(readFileSync(BLOCKER_MAP_PATH, 'utf8')) as Record<string, any>;
    const certificateSource = (writtenMap.sourceReports ?? []).find((entry: Record<string, any>) => entry.path === CERTIFICATE_PATH);
    if (writtenAudit.resultDigest !== projection.certificate.certificateDigest
      || certificateSource?.digest !== projection.certificate.certificateDigest) {
      throw new Error('closeout projection postcondition failed: certificate consumers do not bind the written digest');
    }
  } catch (error) {
    for (const [path, original] of originals) writeFileSync(path, original, 'utf8');
    throw error;
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const modeIndex = argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : 'validate';
  if (mode !== 'validate' && mode !== 'write') {
    process.stderr.write(`unknown --mode ${String(mode)}; expected validate or write\n`);
    return 2;
  }

  if (mode === 'write') {
    const originMain = resolveOriginMain();
    // Keep the certificate a deterministic statement about its remote release
    // snapshot.  A wall-clock value changes reviewer-bound projection bytes on
    // every write, which prevents a self-contained evidence chain from ever
    // reaching a fixed point.
    const generatedAt = git(['show', '-s', '--format=%cI', originMain]);
    const closeback = projectReleaseCloseback(resolveLocalHead(), originMain, originMain, generatedAt);
    const { certificate, targetHead } = compile(generatedAt, closeback, originMain);
    writeCloseoutProjection(projectCloseoutArtifacts(certificate, closeback, generatedAt));
    process.stdout.write(
      `wrote canonical closeout projection rooted at ${CERTIFICATE_PATH}\n`
        + `  verdict: ${certificate.overallVerdict} (status ${certificate.status})\n`
        + `  observed ${REMOTE}/${BRANCH}: ${originMain} (local HEAD ${targetHead === originMain ? 'not used' : targetHead})\n`
        + `  independent reviewers: ${certificate.independentReviewerCount}/${certificate.minimumIndependentReviewers}\n`
        + `  digest: ${certificate.certificateDigest}\n`
        + certificate.diagnostics.map((entry) => `  - ${entry}\n`).join('')
    );
    return 0;
  }

  const committed = JSON.parse(readFileSync(CERTIFICATE_PATH, 'utf8')) as FourPlanIndependentCertificate;
  const committedCloseback = readJson(CLOSEBACK_PATH);
  const originMain = resolveOriginMain();
  const closeback = projectReleaseCloseback(
    String(committedCloseback.targetHead ?? ''),
    String(committedCloseback.originMain ?? ''),
    originMain,
    String(committedCloseback.generatedAt ?? '')
  );
  const { certificate } = compile(String(committed.generatedAt ?? ''), closeback, originMain);
  const drift = Object.keys(certificate)
    .filter((key) => JSON.stringify((certificate as any)[key]) !== JSON.stringify((committed as any)[key]))
    .sort();
  if (JSON.stringify(closeback) !== JSON.stringify(committedCloseback)) drift.push('release-closeback');

  process.stdout.write(
    `certificate: ${CERTIFICATE_PATH}\n`
      + `  committed verdict: ${String(committed.overallVerdict)} (status ${String(committed.status)})\n`
      + `  recomputed verdict: ${certificate.overallVerdict} (status ${certificate.status})\n`
      + `  live ${REMOTE}/${BRANCH}: ${originMain}\n`
      + `  committed digest: ${String(committed.certificateDigest)}\n`
      + `  recomputed digest: ${certificate.certificateDigest}\n`
      + certificate.diagnostics.map((entry) => `  - ${entry}\n`).join('')
  );
  if (drift.length > 0) {
    process.stderr.write(
      `committed certificate no longer matches live state; drifted fields: ${drift.join(', ')}\n`
        + `re-run with --mode write to refresh it\n`
    );
    return 1;
  }
  process.stdout.write('committed certificate matches live state\n');
  return 0;
}

process.exit(main());
