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
import {
  compileFourPlanIndependentCertificate,
  type FourPlanEvidenceObservation,
  type FourPlanIndependentCertificate,
  type FourPlanReleaseSurface,
  type FourPlanReviewer
} from '../packages/core/src/evidence/four-plan-independent-certificate.ts';

const CERTIFICATE_PATH = 'docs/reports/plan-3x-4x-independent-certificate.json';
const CLOSEBACK_PATH = 'docs/reports/plan-3x-4x-release-closeback.json';
const REMOTE = 'origin';
const BRANCH = 'main';

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

function digestOf(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function resolveOriginMain(): string {
  const output = git(['ls-remote', REMOTE, `refs/heads/${BRANCH}`]);
  const sha = output.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`unable to resolve ${REMOTE}/${BRANCH} from the remote; refusing to compile a certificate without a live remote SHA`);
  }
  return sha;
}

function observe(paths: readonly string[], targetHead: string): FourPlanEvidenceObservation[] {
  const tracked = new Set(
    paths.filter((path) => gitOk(['ls-files', '--error-unmatch', '--', path]))
  );
  const dirty = new Set(
    git(['status', '--porcelain', '--', ...paths])
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).replace(/^"|"$/g, '').replace(/\\/g, '/').trim())
  );
  return paths.map((path) => {
    const present = existsSync(path);
    const lastCommit = tracked.has(path) ? git(['log', '-1', '--format=%H', '--', path]) : '';
    return {
      path,
      present,
      digest: present ? digestOf(path) : '',
      tracked: tracked.has(path),
      dirty: dirty.has(path),
      lastCommit,
      reachableFromTargetHead:
        lastCommit.length === 40 && gitOk(['merge-base', '--is-ancestor', lastCommit, targetHead])
    };
  });
}

function buildReleaseSurfaces(
  closeback: Record<string, any>,
  targetHead: string,
  originMain: string
): FourPlanReleaseSurface[] {
  const declared: readonly Record<string, any>[] = Array.isArray(closeback.releaseSurfaces) ? closeback.releaseSurfaces : [];
  const surfaces: FourPlanReleaseSurface[] = [
    {
      surfaceId: 'target-head',
      expectedDigest: String(closeback.targetHead ?? ''),
      observedDigest: targetHead,
      reachable: true
    },
    {
      surfaceId: 'origin-main',
      expectedDigest: String(closeback.originMain ?? ''),
      observedDigest: originMain,
      reachable: true
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

function compile(generatedAt: string): CompileOutcome {
  const prior = JSON.parse(readFileSync(CERTIFICATE_PATH, 'utf8')) as Record<string, any>;
  const closeback = JSON.parse(readFileSync(CLOSEBACK_PATH, 'utf8')) as Record<string, any>;
  const targetHead = git(['rev-parse', 'HEAD']);
  const originMain = resolveOriginMain();

  const dimensions = (prior.dimensions ?? []).map((dimension: Record<string, any>) => ({
    dimensionId: String(dimension.dimensionId ?? ''),
    status: dimension.status,
    digest: String(dimension.digest ?? ''),
    evidenceRefs: (dimension.evidenceRefs ?? []).map(String),
    reviewerRole: dimension.reviewerRole ?? null
  }));
  const reviewers: FourPlanReviewer[] = (prior.reviewers ?? []).map((reviewer: Record<string, any>) => ({
    reviewerId: String(reviewer.reviewerId ?? ''),
    roles: (reviewer.roles ?? []).map(String),
    outputPath: String(reviewer.outputPath ?? ''),
    digest: String(reviewer.digest ?? ''),
    inputDigests: (reviewer.inputDigests ?? []).map(String)
  }));

  const referenced = [
    ...new Set<string>([
      ...dimensions.flatMap((dimension: { evidenceRefs: string[] }) => dimension.evidenceRefs),
      ...reviewers.map((reviewer) => reviewer.outputPath)
    ])
  ]
    .filter((path) => path.length > 0 && path !== CERTIFICATE_PATH)
    .sort();

  const certificate = compileFourPlanIndependentCertificate({
    certificateId: String(prior.certificateId ?? ''),
    certificatePath: CERTIFICATE_PATH,
    generatedAt,
    writerRole: String(prior.writerRole ?? ''),
    reviewers,
    minimumIndependentReviewers: Number(prior.minimumIndependentReviewers ?? 0),
    forbiddenReviewerRoles: (prior.forbiddenReviewerRoles ?? []).map(String),
    dimensions,
    evidenceObservations: observe(referenced, targetHead),
    releaseSurfaces: buildReleaseSurfaces(closeback, targetHead, originMain),
    mutationControls: (prior.mutationControls ?? []).map(String),
    provenance: {
      compiledBy: 'scripts/compile-four-plan-independent-certificate.ts',
      head: targetHead,
      originMain,
      remoteRef: `${REMOTE}/${BRANCH}`,
      closebackDigest: digestOf(CLOSEBACK_PATH),
      closebackTargetHead: String(closeback.targetHead ?? ''),
      taskId: 'ATM-GOV-0360'
    }
  });
  return { certificate, targetHead, originMain };
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
    const { certificate, targetHead, originMain } = compile(new Date().toISOString());
    writeFileSync(CERTIFICATE_PATH, `${JSON.stringify(certificate, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `wrote ${CERTIFICATE_PATH}\n`
        + `  verdict: ${certificate.overallVerdict} (status ${certificate.status})\n`
        + `  head: ${targetHead}\n  ${REMOTE}/${BRANCH}: ${originMain}\n`
        + `  independent reviewers: ${certificate.independentReviewerCount}/${certificate.minimumIndependentReviewers}\n`
        + `  digest: ${certificate.certificateDigest}\n`
        + certificate.diagnostics.map((entry) => `  - ${entry}\n`).join('')
    );
    return 0;
  }

  const committed = JSON.parse(readFileSync(CERTIFICATE_PATH, 'utf8')) as FourPlanIndependentCertificate;
  const { certificate, originMain } = compile(String(committed.generatedAt ?? ''));
  const drift = Object.keys(certificate)
    .filter((key) => JSON.stringify((certificate as any)[key]) !== JSON.stringify((committed as any)[key]))
    .sort();

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
