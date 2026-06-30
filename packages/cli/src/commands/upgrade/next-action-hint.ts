/**
 * Next-action hint builder for the upgrade command.
 *
 * Extracted from `packages/cli/src/commands/upgrade.ts` per the
 * `upgrade/SPLIT_PLAN.md` Layer 1 split. Pure string builder — no
 * side effects.
 *
 * Surface contract: the returned object shape and string values are
 * part of the upgrade command's JSON envelope (invariant I1, CLI
 * surface), so the output of this function must remain byte-identical
 * across refactors. Callers receive the same hint structure.
 */
import { quoteCliValue } from '../shared.ts';

interface ProposalLike {
  target?: { kind?: string; mapId?: string } | null;
  status?: string;
  requiredJustification?: {
    requiredEvidenceKinds?: string[];
    requiredCliOptions?: string[];
    rationale?: string;
  } | null;
}

export function buildUpgradeNextActionHint(cwd: string, proposal: Record<string, unknown>) {
  const proposalObj = proposal as unknown as ProposalLike;
  if (proposalObj?.target?.kind !== 'map') {
    return null;
  }

  const mapId = proposalObj.target.mapId;
  const requiredJustification = proposalObj.requiredJustification;
  if (proposalObj.status === 'blocked' && requiredJustification) {
    if (requiredJustification.requiredEvidenceKinds?.length === 1 && requiredJustification.requiredEvidenceKinds?.includes('map-equivalence')) {
      return {
        status: 'blocked',
        route: 'map-equivalence-required',
        reason: requiredJustification.rationale,
        command: `node atm.mjs test --cwd ${quoteCliValue(cwd)} --map ${quoteCliValue(mapId)} --equivalence-fixtures ${quoteCliValue('<fixtures.json>')} --json`,
        commandTemplate: true,
        requiredEvidenceKinds: requiredJustification.requiredEvidenceKinds,
        requiredCliOptions: requiredJustification.requiredCliOptions,
        missingInputs: ['equivalence-fixtures']
      };
    }
    if (requiredJustification.requiredEvidenceKinds?.length === 1 && requiredJustification.requiredEvidenceKinds?.includes('polymorph-impact')) {
      return {
        status: 'blocked',
        route: 'polymorph-impact-required',
        reason: requiredJustification.rationale,
        command: `node atm.mjs upgrade --cwd ${quoteCliValue(cwd)} --propose --target map --map ${quoteCliValue(mapId)} --replacement-mode active --polymorph-impact-report ${quoteCliValue('<polymorph-impact-report.json>')} --json`,
        commandTemplate: true,
        requiredEvidenceKinds: requiredJustification.requiredEvidenceKinds,
        requiredCliOptions: requiredJustification.requiredCliOptions,
        missingInputs: ['polymorph-impact-report']
      };
    }
    return {
      status: 'blocked',
      route: 'governed-next',
      reason: requiredJustification.rationale,
      command: `node atm.mjs next --cwd ${quoteCliValue(cwd)} --json`,
      requiredEvidenceKinds: requiredJustification.requiredEvidenceKinds,
      requiredCliOptions: requiredJustification.requiredCliOptions
    };
  }

  return null;
}
