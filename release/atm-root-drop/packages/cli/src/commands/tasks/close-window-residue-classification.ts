/**
 * Tell an unreconciled live index apart from another agent's staged work.
 *
 * The close window blocks on staged entries outside the governed bundle. Two
 * completely different conditions produce that symptom. One is genuine foreign
 * work: another lane staged something, and deferring it — parking a byte-exact
 * snapshot and restoring it afterwards — is the right answer. The other is this
 * repository's own reconciliation debt: a governed commit advanced HEAD through
 * a sealed candidate index and the live index never caught up, so paths that
 * were already committed still read as staged changes against HEAD.
 *
 * Deferring the second kind is a null operation by construction. The snapshot
 * is restored byte-identically on release, so the debt is faithfully recreated
 * after the close, and it compounds with every commit taken in that state. The
 * operator is told to defer when what they actually need is to drain.
 *
 * This module only classifies. It never mutates the index, never touches the
 * close-window lease, and never changes what defer parks or restores — the
 * proof is a dry run, and its whole output is a diagnosis.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  drainLiveIndexReconciliationReceipt,
  type LiveIndexDrain
} from '../git-governance/implementation/live-index-drain.ts';

export const CLOSE_WINDOW_RESIDUE_CLASSIFICATION_SCHEMA_ID = 'atm.closeWindowResidueClassification.v1';

const EVIDENCE_DIRECTORY = '.atm/history/evidence';
const RECEIPT_SUFFIX = '.live-index-reconciliation.json';

export interface CloseWindowResidueSource {
  readonly path: string;
  /** The task whose receipt proves this path, which need not be the closing task. */
  readonly receiptTaskId: string;
  readonly firstUnreconciledCommit: string | null;
}

export interface CloseWindowResidueClassification {
  readonly schemaId: typeof CLOSE_WINDOW_RESIDUE_CLASSIFICATION_SCHEMA_ID;
  /** Staged paths a dry-run drain proved are this repository's own debt. */
  readonly provenResidueFiles: readonly string[];
  readonly residueSources: readonly CloseWindowResidueSource[];
  /** Everything else, which keeps the existing foreign-staged treatment. */
  readonly foreignStagedFiles: readonly string[];
}

function normalize(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function listReceiptTaskIds(cwd: string): readonly string[] {
  const directory = path.join(cwd, EVIDENCE_DIRECTORY);
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((entry) => entry.endsWith(RECEIPT_SUFFIX))
      .map((entry) => entry.slice(0, -RECEIPT_SUFFIX.length))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The retained paths a receipt claims, read without proving anything. This is
 * the cheap filter that keeps the expensive per-receipt proof off the close
 * path whenever the staged set has nothing to do with recorded debt.
 */
function readReceiptRetainedPaths(cwd: string, taskId: string): readonly string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(cwd, EVIDENCE_DIRECTORY, `${taskId}${RECEIPT_SUFFIX}`), 'utf8')
    ) as { retainedPaths?: readonly { path?: unknown }[] };
    return (parsed.retainedPaths ?? [])
      .map((entry) => (typeof entry?.path === 'string' ? normalize(entry.path) : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function classifyCloseWindowUnexpectedStaged(input: {
  readonly cwd: string;
  readonly unexpectedStagedFiles: readonly string[];
  /** Injected by tests; defaults read the real evidence directory. */
  readonly receiptTaskIds?: readonly string[];
  readonly readRetainedPaths?: (taskId: string) => readonly string[];
  readonly proveDrainable?: (taskId: string) => LiveIndexDrain;
}): CloseWindowResidueClassification {
  const staged = new Set(input.unexpectedStagedFiles.map(normalize).filter(Boolean));
  if (staged.size === 0) return classification([], [], []);

  const readRetained = input.readRetainedPaths ?? ((taskId: string) => readReceiptRetainedPaths(input.cwd, taskId));
  const prove = input.proveDrainable
    ?? ((taskId: string) => drainLiveIndexReconciliationReceipt({ cwd: input.cwd, taskId, dryRun: true }));

  const provenResidueFiles = new Set<string>();
  const residueSources: CloseWindowResidueSource[] = [];

  for (const taskId of input.receiptTaskIds ?? listReceiptTaskIds(input.cwd)) {
    if (!readRetained(taskId).some((filePath) => staged.has(filePath))) continue;
    let drain: LiveIndexDrain;
    try {
      // A dry run proves the pre-state without writing. A receipt that cannot be
      // read or proved simply yields no residue: this classifier only ever
      // narrows a block, so an unreadable receipt leaves the stricter foreign
      // treatment in place.
      drain = prove(taskId);
    } catch {
      continue;
    }
    for (const filePath of drain.drainedPaths.map(normalize)) {
      if (!staged.has(filePath) || provenResidueFiles.has(filePath)) continue;
      provenResidueFiles.add(filePath);
      residueSources.push({
        path: filePath,
        receiptTaskId: taskId,
        firstUnreconciledCommit: drain.headSha
      });
    }
  }

  const foreignStagedFiles = [...staged].filter((filePath) => !provenResidueFiles.has(filePath)).sort();
  return classification([...provenResidueFiles].sort(), residueSources, foreignStagedFiles);
}

function classification(
  provenResidueFiles: readonly string[],
  residueSources: readonly CloseWindowResidueSource[],
  foreignStagedFiles: readonly string[]
): CloseWindowResidueClassification {
  return {
    schemaId: CLOSE_WINDOW_RESIDUE_CLASSIFICATION_SCHEMA_ID,
    provenResidueFiles,
    residueSources,
    foreignStagedFiles
  };
}

/** The drain command that clears one receipt's proven debt. */
export function residueDrainCommand(receiptTaskId: string): string {
  return `node atm.mjs git reconcile-live-index --task ${receiptTaskId} --write --json`;
}

/**
 * One path of proven residue together with the receipt that proved it.
 *
 * The owning task is recorded per path because residue is attributed to the
 * task whose commit left the index behind, which need not be the task now
 * closing, and a single staged set can carry debt from several of them.
 */
export interface CloseWindowResidueOwnership {
  readonly path: string;
  readonly receiptTaskId: string;
}

/**
 * Every drain a residue set needs, one per distinct receipt owner.
 *
 * Naming only the first owner told an operator to run a command that clears
 * part of the debt; the close then blocks again with the identical message, so
 * the instruction reads as if it had failed. Each receipt is drained on its own
 * terms, so the recovery is the whole set, deduplicated and ordered.
 */
export function residueDrainCommands(sources: readonly CloseWindowResidueSource[]): readonly string[] {
  return [...new Set(sources.map((entry) => entry.receiptTaskId).filter(Boolean))].sort().map(residueDrainCommand);
}

export interface CloseWindowResidueDisclosure {
  readonly provenResidueFiles: readonly string[];
  readonly provenResidueEntries: readonly CloseWindowResidueOwnership[];
  readonly residueDrainCommands: readonly string[];
  /** The whole recovery as one runnable string, or null when there is none. */
  readonly residueDrainCommand: string | null;
}

export const EMPTY_CLOSE_WINDOW_RESIDUE_DISCLOSURE: CloseWindowResidueDisclosure = {
  provenResidueFiles: [],
  provenResidueEntries: [],
  residueDrainCommands: [],
  residueDrainCommand: null
};

/** Reduce a classification to exactly what the close window records and reports. */
export function residueDisclosure(classification: CloseWindowResidueClassification): CloseWindowResidueDisclosure {
  const commands = residueDrainCommands(classification.residueSources);
  return {
    provenResidueFiles: classification.provenResidueFiles,
    provenResidueEntries: classification.residueSources
      .map((entry) => ({ path: entry.path, receiptTaskId: entry.receiptTaskId }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.receiptTaskId.localeCompare(right.receiptTaskId)),
    residueDrainCommands: commands,
    residueDrainCommand: commands.length > 0 ? commands.join(' && ') : null
  };
}
