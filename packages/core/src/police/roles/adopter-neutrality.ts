import type {
  AdopterNeutralityCheckInput,
  PoliceFamilyReport,
  PoliceFinding,
  PoliceFindingAction,
  PoliceFindingSeverity,
  PoliceFamilyStatus
} from '../types.ts';
import {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  sanitizeId
} from '../shared.ts';

export function runAdopterNeutralityCheck(input: AdopterNeutralityCheckInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  const allowlist = new Set(input.allowlist ?? []);
  const profile = input.profile ?? 'standard';
  const severityForProfile: PoliceFindingSeverity = profile === 'full' ? 'block' : 'advisory';
  const actionForProfile: PoliceFindingAction = profile === 'full' ? 'request-human-review' : 'needs-review';

  for (const file of input.protectedFiles ?? []) {
    if (allowlist.has(file.filePath)) continue;
    for (const banned of input.bannedTerms ?? []) {
      if (!file.content.includes(banned.term)) continue;
      findings.push(makePoliceFinding({
        findingId: `police.registry-consistency.adopter-neutrality.${sanitizeId(banned.termClass)}.${sanitizeId(file.filePath)}`,
        policeFamily: 'registry-consistency',
        severity: severityForProfile,
        trigger: 'adopter-neutrality-violation',
        scope: `${file.scope ?? 'protected-public'}::${file.filePath}`,
        action: actionForProfile,
        routeHint: 'registry.review.adopter-neutrality',
        readModel: 'AdopterNeutralityCheck',
        message: `Protected upstream file ${file.filePath} contains adopter-specific term (${banned.termClass}).`,
        evidenceRefs: [makeEvidenceRef('adopter-neutrality-scan', 'police-artifact')],
        metadata: {
          filePath: file.filePath,
          matchedTermClass: banned.termClass,
          scope: file.scope ?? 'protected-public',
          suggestedAction: banned.suggestedAction ?? 'replace-with-adopter-neutral-term',
          profile,
          directApplyAllowed: false
        }
      }));
    }
  }

  const status: PoliceFamilyStatus = findings.length > 0 && profile === 'full' ? 'fail' : 'pass';
  return makePoliceFamilyReport({
    family: 'registry-consistency',
    mode: 'blocker',
    status,
    findings,
    sourceValidator: 'runAdopterNeutralityCheck'
  });
}
