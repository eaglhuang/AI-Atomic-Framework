import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createConversationFeedbackReport,
  createConversationSuppressionKey
} from '../../packages/plugin-sdk/src/conversation/conversation-feedback-loop.ts';
import { draftConversationPatches } from '../../packages/plugin-sdk/src/conversation/conversation-patch-draft-bridge.ts';
import {
  reviewConversationTranscript,
  type ConversationTranscriptReviewInput
} from '../../packages/plugin-sdk/src/conversation/conversation-transcript-reviewer.ts';
import type {
  ConversationReviewFinding,
  ConversationReviewFindingKind
} from '../../packages/plugin-sdk/src/conversation/conversation-review-finding.ts';

export interface ConversationLearningLoopDemoResult {
  readonly ok: boolean;
  readonly findings: number;
  readonly feedbackEvents: number;
  readonly patchDrafts: number;
  readonly atomPatchDrafts: number;
  readonly skillPatchDrafts: number;
  readonly blockedDrafts: number;
  readonly actions: readonly string[];
}

type DemoFixture = {
  readonly description?: string;
  readonly input: ConversationTranscriptReviewInput;
};

export function runConversationLearningLoopDemo(): ConversationLearningLoopDemoResult {
  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-transcript.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as DemoFixture;
  const findingsReport = reviewConversationTranscript(fixture.input);

  const workflowFinding = requireFinding(findingsReport.findings, 'workflow-adjustment');
  const debugFinding = requireFinding(findingsReport.findings, 'non-trivial-debug-path');
  const staleSkillFinding = requireFinding(findingsReport.findings, 'stale-or-wrong-skill');

  const feedbackReport = createConversationFeedbackReport({
    findingsReport,
    generatedAt: '2026-05-17T03:01:00.000Z',
    sourceReportPath: 'examples/conversation-learning-loop/fixtures/demo-transcript.json',
    choiceState: [
      {
        suppressionKey: createConversationSuppressionKey(workflowFinding),
        choice: 'Y',
        chosenAt: '2026-05-17T03:01:01.000Z',
        findingId: workflowFinding.findingId,
        reason: 'Demo user opts into a dry-run atom workflow repair draft.'
      },
      {
        suppressionKey: createConversationSuppressionKey(debugFinding),
        choice: 'N',
        chosenAt: '2026-05-17T03:01:02.000Z',
        findingId: debugFinding.findingId,
        reason: 'Demo user defers the reusable debug-path draft.'
      },
      {
        suppressionKey: createConversationSuppressionKey(staleSkillFinding),
        choice: 'X',
        chosenAt: '2026-05-17T03:01:03.000Z',
        findingId: staleSkillFinding.findingId,
        reason: 'Demo user suppresses this stale-skill prompt pattern.'
      }
    ],
    occurrenceCountBySuppressionKey: {
      [createConversationSuppressionKey(debugFinding)]: 2,
      [createConversationSuppressionKey(staleSkillFinding)]: 3
    }
  });

  const patchDraftReport = draftConversationPatches({
    findingsReport,
    generatedAt: '2026-05-17T03:02:00.000Z',
    sourceReportPath: 'examples/conversation-learning-loop/fixtures/demo-transcript.json',
    atomVersionById: {
      'ATM-CORE-0001': '0.1.0'
    }
  });

  const blockedPatchDraftReport = draftConversationPatches({
    findingsReport,
    generatedAt: '2026-05-17T03:03:00.000Z',
    sourceReportPath: 'examples/conversation-learning-loop/fixtures/demo-transcript.json',
    atomVersionById: {}
  });
  const blockedDrafts = blockedPatchDraftReport.drafts.filter((draft) =>
    draft.draftKind === 'atom-patch'
    && draft.upgradeProposalDraft === undefined
    && draft.notes.some((note) => note.includes('keep this draft out of promotion queues'))
  ).length;

  const actions = [...new Set(feedbackReport.events.map((event) => event.promptAction))].sort();
  const result: ConversationLearningLoopDemoResult = {
    ok: true,
    findings: findingsReport.findings.length,
    feedbackEvents: feedbackReport.events.length,
    patchDrafts: patchDraftReport.drafts.length,
    atomPatchDrafts: patchDraftReport.drafts.filter((draft) => draft.draftKind === 'atom-patch').length,
    skillPatchDrafts: patchDraftReport.drafts.filter((draft) => draft.draftKind === 'skill-patch').length,
    blockedDrafts,
    actions
  };

  assert.equal(result.findings, 4, 'demo must extract four conversation findings');
  assert.equal(result.feedbackEvents, 4, 'demo must create one feedback event per finding');
  assert(result.actions.includes('ask-user'), 'demo must show first-criticism ask');
  assert(result.actions.includes('create-dry-run-draft'), 'demo must show Y -> dry-run draft route');
  assert(result.actions.includes('record-only-ask-later'), 'demo must show N -> ask later route');
  assert(result.actions.includes('record-only-suppressed'), 'demo must show X -> suppress route');
  assert.equal(result.atomPatchDrafts, 1, 'demo must include one atom patch draft');
  assert(result.skillPatchDrafts >= 1, 'demo must include at least one skill patch draft');
  assert(result.blockedDrafts >= 1, 'demo must include one blocked dry-run route when base atom version is missing');

  return result;
}

function requireFinding(findings: readonly ConversationReviewFinding[], kind: ConversationReviewFindingKind): ConversationReviewFinding {
  const finding = findings.find((candidate) => candidate.findingKind === kind);
  assert(finding, `missing expected finding kind: ${kind}`);
  return finding;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runConversationLearningLoopDemo();
  console.log(`[example:conversation-learning-loop] ok (${result.findings} findings, ${result.feedbackEvents} feedback events, ${result.patchDrafts} dry-run drafts, blocked=${result.blockedDrafts}, actions=${result.actions.join(',')})`);
}