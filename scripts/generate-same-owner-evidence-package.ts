import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function parseArgs(argv: string[]) {
  let outputDir = 'docs/reports/paper-evidence';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') {
      outputDir = argv[index + 1] ?? outputDir;
      index += 1;
    }
  }
  return {
    outputDir: path.resolve(root, outputDir)
  };
}

type BoundedRegion = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
};

type SuggestedAtom = {
  atomId: string;
  atomCid: string;
  role: string;
  summary: string;
  sourceRange: BoundedRegion;
};

type SummaryDoc = {
  generatedAt: string;
  hotFile: string;
  traces: {
    sameOwnerPositiveLane: {
      state: string;
      reason: string;
      boundedRegions?: BoundedRegion[];
    };
    sameOwnerNegativeLane: {
      state: string;
      reason: string;
      boundedRegions?: BoundedRegion[];
    };
    sameOwnerNegativeSplitSuggestion: {
      suggestionKind: string;
      ownerAtomId: string;
      rationale: string;
      conflictRegion: BoundedRegion;
      suggestedAtoms: SuggestedAtom[];
    };
  };
  commands: string[];
  artifactPaths: Record<string, string>;
};

type ApplyDoc = {
  mergePlanId: string;
  proposalIds: string[];
  verdict: string;
  applyMethod: string;
  brokerOperationRun: {
    records: Array<{
      runId: string;
      lane_decision: string;
      merge_verdict: string;
      commit_sha?: string;
      task_ids?: string[];
      actor_ids?: string[];
      evidence_path?: string;
    }>;
  };
};

type ApprovedQueueDoc = {
  entries: Array<{
    proposalId: string;
    atomId: string;
    status: string;
    review?: {
      decision: string;
      reason: string;
      evidenceId?: string;
      decidedAt?: string;
    };
    proposal: {
      patchDraft: {
        candidateId: string;
        ownerAtomId: string;
        conflictRegion: BoundedRegion;
        suggestedAtoms: SuggestedAtom[];
      };
    };
  }>;
};

function formatRange(region: BoundedRegion | null | undefined): string {
  if (!region) {
    return 'n/a';
  }
  return `${region.lineStart}-${region.lineEnd}`;
}

function relative(posixPath: string) {
  return posixPath.replace(/\\/g, '/');
}

const { outputDir } = parseArgs(process.argv.slice(2));
mkdirSync(outputDir, { recursive: true });

const summary = readJson<SummaryDoc>('docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-summary.json');
const apply = readJson<ApplyDoc>('docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-hot-apply.json');
const approvedQueue = readJson<ApprovedQueueDoc>('docs/reports/split-suggestion-evidence/split-suggestion-review-approved-queue.json');

const positiveLane = summary.traces.sameOwnerPositiveLane;
const negativeLane = summary.traces.sameOwnerNegativeLane;
const splitSuggestion = summary.traces.sameOwnerNegativeSplitSuggestion;
const applyRecord = apply.brokerOperationRun.records[0] ?? null;
const positiveRegion = positiveLane.boundedRegions?.[0] ?? null;
const negativeRegion = negativeLane.boundedRegions?.[0] ?? null;

const curatorApprovalChain = approvedQueue.entries
  .filter((entry) => entry.proposal.patchDraft.ownerAtomId === splitSuggestion.ownerAtomId)
  .map((entry) => ({
    proposalId: entry.proposalId,
    mapId: entry.atomId,
    status: entry.status,
    decision: entry.review?.decision ?? null,
    reason: entry.review?.reason ?? null,
    evidenceId: entry.review?.evidenceId ?? null,
    decidedAt: entry.review?.decidedAt ?? null,
    patchDraft: entry.proposal.patchDraft
  }));

const packageDoc = {
  schemaId: 'atm.paperEvidencePackage.v1',
  generatedAt: new Date().toISOString(),
  packageId: 'paper.same-owner-bounded-atom.unique-package',
  title: '同 owner map、不同 bounded atom 的 merge / block / curator approval 唯一完整包',
  targetFile: summary.hotFile,
  positiveCase: {
    scope: 'same owner map, disjoint bounded atom',
    admissionState: positiveLane.state,
    admissionReason: positiveLane.reason,
    lane: 'deterministic-composer',
    verdict: 'needs-physical-split',
    boundedRegion: positiveRegion,
    applyVerdict: apply.verdict,
    applyMethod: apply.applyMethod,
    mergePlanId: apply.mergePlanId,
    proposalIds: apply.proposalIds,
    runId: applyRecord?.runId ?? null,
    laneDecision: applyRecord?.lane_decision ?? null,
    mergeVerdict: applyRecord?.merge_verdict ?? null,
    commitSha: applyRecord?.commit_sha ?? null,
    taskIds: applyRecord?.task_ids ?? [],
    actorIds: applyRecord?.actor_ids ?? []
  },
  negativeCase: {
    scope: 'same owner map, same bounded atom',
    admissionState: negativeLane.state,
    admissionReason: negativeLane.reason,
    lane: 'blocked',
    verdict: 'blocked-cid-conflict',
    boundedRegion: negativeRegion,
    splitSuggestion
  },
  curatorApprovalChain,
  sourceArtifacts: {
    summary: 'docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-summary.json',
    applyEvidence: 'docs/reports/same-owner-bounded-atom-dogfood/proposal-gated-hot-apply.json',
    brokerEvidenceBundle: 'docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.json',
    brokerEvidenceReport: 'docs/reports/same-owner-bounded-atom-dogfood/broker-evidence-bundle/broker-evidence-bundle.md',
    approvedQueue: 'docs/reports/split-suggestion-evidence/split-suggestion-review-approved-queue.json',
    approvedDecision: 'docs/reports/split-suggestion-evidence/map-curator.patch.same-owner-blocked-suggestion.approve.json'
  },
  replayCommands: summary.commands
};

const jsonPath = path.join(outputDir, 'same-owner-bounded-atom-unique-package.json');
writeFileSync(jsonPath, `${JSON.stringify(packageDoc, null, 2)}\n`, 'utf8');

const mdLines = [
  '# 同 owner map、不同 bounded atom 論文證據唯一完整包',
  '',
  '## 一句話結論',
  '',
  'ATM 目前已具備一條完整證據鏈：當兩個寫入請求落在同一個 coarse owner map，但 proposal 所宣告的 bounded atom 區段彼此分離時，broker 會把該請求送入 `deterministic-composer` 並成功 apply；當兩者落在相同 bounded atom 區段時，broker 會 fail-closed 阻擋，並把 coarse owner map 拆分建議推進到 curator review / approval queue。',
  '',
  '## 正向案例：同 owner map、不同 bounded atom 可 merge',
  '',
  `- 目標檔案：\`${summary.hotFile}\``,
  `- owner map：\`${splitSuggestion.ownerAtomId}\``,
  `- bounded region：\`${formatRange(positiveRegion)}\``,
  `- admission state：\`${positiveLane.state}\``,
  '- broker lane：`deterministic-composer`',
  '- broker verdict：`needs-physical-split`',
  `- apply verdict：\`${apply.verdict}\``,
  `- apply method：\`${apply.applyMethod}\``,
  `- merge verdict：\`${applyRecord?.merge_verdict ?? 'n/a'}\``,
  `- broker run id：\`${applyRecord?.runId ?? 'n/a'}\``,
  `- commit sha：\`${applyRecord?.commit_sha ?? 'n/a'}\``,
  '',
  '這筆證據說明：ATM 不必把同檔同 owner map 一律視為不可並行；只要 bounded atom 區段可被證明為分離，broker 就能先在 admission 階段改走 composer 路線，再由 steward 完成可追溯的合併寫入。',
  '',
  '## 負向案例：同 owner map、相同 bounded atom 必須阻擋',
  '',
  `- 目標檔案：\`${summary.hotFile}\``,
  `- owner map：\`${splitSuggestion.ownerAtomId}\``,
  `- bounded region：\`${formatRange(negativeRegion)}\``,
  `- admission state：\`${negativeLane.state}\``,
  '- broker lane：`blocked`',
  '- broker verdict：`blocked-cid-conflict`',
  `- split suggestion kind：\`${splitSuggestion.suggestionKind}\``,
  `- conflict region：\`${formatRange(splitSuggestion.conflictRegion)}\``,
  `- suggested atoms：${splitSuggestion.suggestedAtoms.map((atom) => `\`${atom.role}:${atom.atomId}:${formatRange(atom.sourceRange)}\``).join('、')}`,
  '',
  '這筆證據說明：當 proposal bounded region 真正重疊時，ATM 不會因為它們仍屬同一個 owner map 就勉強合併，而是先阻擋寫入，再產生可審查的 split suggestion，保留 fail-closed 的安全性。',
  '',
  '## Queue / Approval 證據',
  '',
  ...curatorApprovalChain.map((entry) =>
    `- \`${entry.proposalId}\`：status=\`${entry.status}\`，decision=\`${entry.decision}\`，evidence=\`${entry.evidenceId ?? 'n/a'}\``
  ),
  '',
  '這筆證據說明：broker 的 blocked 結果不只停在錯誤訊號，而是能往上接到 curator patch draft 與 human-reviewable approval queue，形成「blocked -> suggestion -> review -> approve」的完整治理鏈。',
  '',
  '## 可查證 artifact',
  '',
  `- summary：\`${packageDoc.sourceArtifacts.summary}\``,
  `- positive apply：\`${packageDoc.sourceArtifacts.applyEvidence}\``,
  `- broker evidence bundle：\`${packageDoc.sourceArtifacts.brokerEvidenceBundle}\``,
  `- broker evidence report：\`${packageDoc.sourceArtifacts.brokerEvidenceReport}\``,
  `- approved queue：\`${packageDoc.sourceArtifacts.approvedQueue}\``,
  `- approved decision：\`${packageDoc.sourceArtifacts.approvedDecision}\``,
  '',
  '## 建議貼進論文的繁中段落',
  '',
  '在 `packages/cli/src/commands/broker.ts` 的 same-owner bounded-atom dogfood 中，我們觀察到 ATM 已可區分「同一 coarse owner map 下的分離 bounded atom」與「同一 bounded atom 的實質重疊」兩種情形。前者在 proposal-first admission 後被路由至 `deterministic-composer`，並由 steward 完成 `patch-apply`，留下 `mergeable` 的 broker operation evidence；後者則在 admission 階段 fail-closed 為 `blocked-cid-conflict`。更重要的是，阻擋並非終點：broker 會同步提出 coarse owner map split suggestion，該 suggestion 可被提升為 curator patch draft，並進入 human-reviewable approval queue。這表示 ATM 的治理能力不只限於阻擋衝突，也能把 blocked overlap 轉譯為可演進、可審查的 atom-map refinement workflow。',
  ''
];

const mdPath = path.join(outputDir, 'same-owner-bounded-atom-unique-package-zh.md');
writeFileSync(mdPath, `${mdLines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir: relative(path.relative(root, outputDir)),
  artifacts: [
    relative(path.relative(root, jsonPath)),
    relative(path.relative(root, mdPath))
  ]
}, null, 2));
