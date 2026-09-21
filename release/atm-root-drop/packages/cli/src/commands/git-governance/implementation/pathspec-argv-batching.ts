/**
 * Bound a pathspec list to what a single process invocation can actually carry.
 *
 * Every operating system caps the argument vector, and a governed commit is
 * exactly the operation that reaches that cap: a release-style bundle carries
 * hundreds of `dist/**` and `release/**` paths into one `git ls-files` or
 * `git add`. Past that ceiling the spawn fails, and it fails inside a commit
 * transaction rather than at its edge.
 *
 * The stdin pathspec route is deliberately not the answer here. This repository
 * treats `git add --pathspec-from-file=-` as an incident (see
 * `assertNoStdinPathspecGitAddPreflight`) because it makes a commit look hung.
 * So the list is split instead, and the split is planning rather than process
 * work: a pure function of the paths, the fixed leading arguments, and a
 * platform byte budget. That keeps it testable for a Windows budget from a
 * POSIX host, and it means no caller has to know a limit exists.
 *
 * Normalization is part of the contract, not a convenience. Callers compare
 * index entries by path, so the planner returns one canonical, deduplicated,
 * sorted list and guarantees that concatenating the batches reproduces it
 * exactly. Splitting a list must not change what the list means.
 */

import { CliError } from '../../shared.ts';

export const PATHSPEC_ARGV_BUDGET_SCHEMA_ID = 'atm.pathspecArgvBudget.v1';

/**
 * Windows caps the entire command line at 32767 characters in `CreateProcess`.
 * POSIX charges argv and the environment against a shared `ARG_MAX` that is
 * commonly 2 MiB; because the environment is charged to the same pool and this
 * process ships a large one, the usable share is set far below the raw cap.
 * Both numbers are ceilings to stay under, not targets to approach.
 */
const WINDOWS_COMMAND_LINE_LIMIT_BYTES = 32_767;
const POSIX_ARGV_BUDGET_BYTES = 131_072;

/**
 * Reserved for the parts of the command line this module does not measure: the
 * absolute path of the git executable, and on POSIX the environment block that
 * competes for the same limit.
 */
const EXECUTABLE_AND_ENVIRONMENT_RESERVE_BYTES = 4_096;

/**
 * Charged per argument for the separator plus worst-case quoting. Windows
 * quotes arguments containing spaces and escapes embedded quotes, so the
 * estimate is deliberately pessimistic rather than exact: overshooting costs
 * one extra batch, undershooting costs a failed spawn inside a commit.
 */
const PER_ARGUMENT_OVERHEAD_BYTES = 3;

export interface PathspecArgvBudget {
  readonly schemaId: typeof PATHSPEC_ARGV_BUDGET_SCHEMA_ID;
  readonly platform: NodeJS.Platform;
  readonly budgetBytes: number;
}

export interface PathspecBatchPlan {
  readonly schemaId: typeof PATHSPEC_ARGV_BUDGET_SCHEMA_ID;
  readonly budgetBytes: number;
  /** The normalized, deduplicated, sorted list the batches reproduce exactly. */
  readonly paths: readonly string[];
  readonly batches: readonly (readonly string[])[];
}

/**
 * The per-platform ceiling, resolved through one policy so that Windows and
 * POSIX callers share an interface and only this function knows the difference.
 */
export function resolvePathspecArgvBudget(platform: NodeJS.Platform = process.platform): PathspecArgvBudget {
  const rawLimit = platform === 'win32' ? WINDOWS_COMMAND_LINE_LIMIT_BYTES : POSIX_ARGV_BUDGET_BYTES;
  return {
    schemaId: PATHSPEC_ARGV_BUDGET_SCHEMA_ID,
    platform,
    budgetBytes: rawLimit - EXECUTABLE_AND_ENVIRONMENT_RESERVE_BYTES
  };
}

/** What one argument list costs at the process boundary, in UTF-8 bytes. */
export function estimateArgvBytes(args: readonly string[]): number {
  let total = 0;
  for (const arg of args) {
    total += Buffer.byteLength(arg, 'utf8') + PER_ARGUMENT_OVERHEAD_BYTES;
  }
  return total;
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Split `paths` into invocations that each stay within `budgetBytes` once
 * `fixedArgs` is charged to every batch.
 *
 * A path that cannot fit even alone is not batchable by any split, so it fails
 * closed here rather than producing a truncated command or a partial result
 * that a caller would read as complete.
 */
export function planPathspecBatches(input: {
  readonly paths: readonly string[];
  readonly fixedArgs: readonly string[];
  readonly budgetBytes?: number;
}): PathspecBatchPlan {
  const budgetBytes = input.budgetBytes ?? resolvePathspecArgvBudget().budgetBytes;
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  const fixedBytes = estimateArgvBytes(input.fixedArgs);
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = fixedBytes;

  for (const filePath of paths) {
    const pathBytes = estimateArgvBytes([filePath]);
    if (fixedBytes + pathBytes > budgetBytes) {
      throw new CliError(
        'ATM_GIT_PATHSPEC_ARGV_BUDGET_EXCEEDED',
        'A single pathspec exceeds the platform argument-vector budget, so no batching can make this Git invocation runnable.',
        {
          exitCode: 1,
          details: {
            schemaId: PATHSPEC_ARGV_BUDGET_SCHEMA_ID,
            path: filePath,
            pathBytes,
            fixedArgsBytes: fixedBytes,
            budgetBytes,
            recovery: [
              'Shorten the path, or run the operation from a repository root that produces a shorter relative path.',
              'Do not work around this by widening the pathspec, by dropping the path, or by moving the argument list to stdin.'
            ]
          }
        }
      );
    }
    if (current.length > 0 && currentBytes + pathBytes > budgetBytes) {
      batches.push(current);
      current = [];
      currentBytes = fixedBytes;
    }
    current.push(filePath);
    currentBytes += pathBytes;
  }
  if (current.length > 0) batches.push(current);

  return { schemaId: PATHSPEC_ARGV_BUDGET_SCHEMA_ID, budgetBytes, paths, batches };
}

/**
 * Run `invoke` once per planned batch. Callers that merge per-batch output get
 * the same result they would have got from one oversized invocation.
 */
export function forEachPathspecBatch(
  input: {
    readonly paths: readonly string[];
    readonly fixedArgs: readonly string[];
    readonly budgetBytes?: number;
  },
  invoke: (batch: readonly string[]) => void
): PathspecBatchPlan {
  const plan = planPathspecBatches(input);
  for (const batch of plan.batches) invoke(batch);
  return plan;
}
