import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveActorId } from '../../actor-registry.ts';
import { CliError, makeResult, message } from '../../shared.ts';
import {
  exclusiveAtomicCreate,
  writeWaveExitObserverReceipt,
  WaveExitObserverWriteError,
  deriveBasisActorsFromEvidenceOwners,
  WAVE_EXIT_OBSERVER_WRITE_COMMAND
} from '../../../../../core/src/evidence/wave-exit-observer-receipt-writer.ts';
import {
  deriveBasisIdentityFromEvidence,
  loadWaveExitObserverPolicy
} from '../../../../../core/src/evidence/wave-exit-observer-receipt.ts';

const ALLOWED_FLAGS = new Set([
  '--cwd',
  '--exit',
  '--actor',
  '--observer-role',
  '--basis-owners',
  '--declared-basis-actor',
  '--json',
  '--pretty',
  '--help'
]);

const OVERRIDE_FLAGS = new Set([
  '--command',
  '--artifact-path',
  '--output',
  '--output-path',
  '--basis-actor',
  '--stdout-sha256',
  '--stderr-sha256',
  '--exit-code'
]);

export interface WaveExitObserverCliDeps {
  readonly loadPolicy?: typeof loadWaveExitObserverPolicy;
  readonly resolveHead?: (cwd: string) => string;
  readonly isAncestor?: (cwd: string, ancestor: string, descendant: string) => boolean;
  readonly readObservedInput?: (cwd: string, head: string, relativePath: string) => string | null;
  readonly executeApprovedCommand?: (cwd: string, command: string) => { exitCode: number; stdout: string; stderr: string };
  readonly now?: () => string;
}

export function runWaveExitObserver(argv: string[], deps: WaveExitObserverCliDeps = {}) {
  const options = parseWaveExitObserverArgv(argv);
  const resolvedActor = resolveActorId(options.actor || undefined, options.cwd);
  if (!resolvedActor?.actorId) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence wave-exit-observer requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  }
  const policy = (deps.loadPolicy ?? loadWaveExitObserverPolicy)(options.cwd);
  const observedHead = (deps.resolveHead ?? resolveGitHead)(options.cwd);
  const derivedActors = deriveBasisActorsFromEvidenceOwners(options.cwd, options.basisOwners);
  try {
    const written = writeWaveExitObserverReceipt({
      repoRoot: options.cwd,
      exitItemId: options.exitItemId,
      observerActor: resolvedActor.actorId,
      observerRole: options.observerRole,
      claimedCommand: options.claimedCommand,
      claimedArtifactPath: options.claimedArtifactPath,
      claimedBasisActor: options.declaredBasisActor,
      extraFlags: options.extraFlags,
      policy,
      observedHead,
      observedAt: (deps.now ?? (() => new Date().toISOString()))(),
      derivedBasis: deriveBasisIdentityFromEvidence({
        producerActors: derivedActors,
        producerRole: policy.basisProducerRole
      }),
      isAncestor: (ancestor, descendant) => (deps.isAncestor ?? gitIsAncestor)(options.cwd, ancestor, descendant),
      readObservedInput: (relativePath) => (deps.readObservedInput ?? gitShowAtHead)(options.cwd, observedHead, relativePath),
      executeApprovedCommand: (command) => (deps.executeApprovedCommand ?? runSealedNodeCommand)(options.cwd, command),
      receiptExists: (absolutePath) => existsSync(absolutePath),
      createExclusiveFile: exclusiveAtomicCreate
    });
    return makeResult({
      ok: true,
      command: WAVE_EXIT_OBSERVER_WRITE_COMMAND,
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_WAVE_EXIT_OBSERVER_RECEIPT_WRITTEN', 'Canonical wave-exit observer receipt created.', {
          exitItemId: options.exitItemId,
          artifactPath: written.artifactPath,
          observerActor: resolvedActor.actorId,
          observerRole: options.observerRole,
          observedHead
        })
      ],
      evidence: {
        action: 'write',
        exitItemId: options.exitItemId,
        artifactPath: written.artifactPath,
        receipt: written.receipt
      }
    });
  } catch (error) {
    if (error instanceof WaveExitObserverWriteError) {
      throw new CliError(error.code, error.message, {
        exitCode: 1,
        details: { diagnostics: error.diagnostics, ...error.details }
      });
    }
    throw error;
  }
}

export { runWaveExitObserver as run };

function parseWaveExitObserverArgv(argv: readonly string[]) {
  let cwd = process.cwd();
  let exitItemId = '';
  let actor = '';
  let observerRole = '';
  let basisOwners: string[] = [];
  let declaredBasisActor: string | null = null;
  let claimedCommand: string | null = null;
  let claimedArtifactPath: string | null = null;
  const extraFlags: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--cwd') cwd = requireValue(argv, ++index, arg);
    else if (arg === '--exit') exitItemId = requireValue(argv, ++index, arg);
    else if (arg === '--actor') actor = requireValue(argv, ++index, arg);
    else if (arg === '--observer-role') observerRole = requireValue(argv, ++index, arg);
    else if (arg === '--basis-owners') {
      basisOwners = requireValue(argv, ++index, arg).split(',').map((entry) => entry.trim()).filter(Boolean);
    } else if (arg === '--declared-basis-actor') declaredBasisActor = requireValue(argv, ++index, arg);
    else if (arg === '--command') {
      claimedCommand = requireValue(argv, ++index, arg);
      extraFlags.push('--command');
    } else if (arg === '--artifact-path' || arg === '--output' || arg === '--output-path') {
      claimedArtifactPath = requireValue(argv, ++index, arg);
      extraFlags.push(arg);
    } else if (arg === '--json' || arg === '--pretty' || arg === '--help') {
      continue;
    } else if (arg.startsWith('--')) {
      extraFlags.push(arg);
      if (OVERRIDE_FLAGS.has(arg) && index + 1 < argv.length && !argv[index + 1]!.startsWith('--')) {
        index += 1;
      }
      if (!ALLOWED_FLAGS.has(arg) && !OVERRIDE_FLAGS.has(arg)) {
        extraFlags.push(arg);
      }
    } else {
      throw new CliError('ATM_CLI_USAGE', `evidence wave-exit-observer rejected positional argument ${arg}`, { exitCode: 2 });
    }
  }

  if (!exitItemId) throw new CliError('ATM_CLI_USAGE', 'evidence wave-exit-observer requires --exit EXIT-NN', { exitCode: 2 });
  if (!observerRole) throw new CliError('ATM_CLI_USAGE', 'evidence wave-exit-observer requires --observer-role <sealed-role>', { exitCode: 2 });
  if (basisOwners.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'evidence wave-exit-observer requires --basis-owners <task-id[,task-id]>', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(cwd),
    exitItemId,
    actor,
    observerRole,
    basisOwners,
    declaredBasisActor,
    claimedCommand,
    claimedArtifactPath,
    extraFlags
  };
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `evidence wave-exit-observer ${flag} requires a value`, { exitCode: 2 });
  }
  return value;
}

function resolveGitHead(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function gitIsAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitShowAtHead(cwd: string, head: string, relativePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${head}:${relativePath.replace(/\\/g, '/')}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

function runSealedNodeCommand(cwd: string, command: string): { exitCode: number; stdout: string; stderr: string } {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== 'node') {
    throw new CliError('ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND', 'Sealed observer command must start with node.', {
      exitCode: 1,
      details: { command }
    });
  }
  const result = spawnSync(process.execPath, parts.slice(1), {
    cwd,
    encoding: 'utf8',
    env: process.env
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}
