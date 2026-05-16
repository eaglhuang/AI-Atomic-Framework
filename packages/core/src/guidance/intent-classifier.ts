import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type GuidanceIntent =
  | 'legacy-atomization'
  | 'adapter-bootstrap'
  | 'docs-spec'
  | 'atom-create'
  | 'upgrade-existing'
  | 'unknown';

export type GuidanceIntentStatus = 'suggested' | 'active-host' | 'promoted-framework';

export interface GuidanceIntentClassification {
  readonly schemaId: 'atm.guidanceIntentClassification';
  readonly specVersion: '0.1.0';
  readonly goal: string;
  readonly matchedIntent: GuidanceIntent;
  readonly confidence: number;
  readonly matchedTerms: readonly string[];
  readonly requiredFlow: readonly string[];
  readonly nextCommand: string;
  readonly blockedAntiPatterns: readonly string[];
  readonly lexiconSources: readonly string[];
}

export interface GuidanceIntentLexiconEntry {
  readonly phrase: string;
  readonly normalizedPhrase: string;
  readonly intent: GuidanceIntent;
  readonly status: GuidanceIntentStatus;
  readonly reason: string;
  readonly source: 'framework-default' | 'host-local' | 'framework-promotion';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GuidanceIntentLexiconDocument {
  readonly schemaId: 'atm.guidanceIntentLexicon';
  readonly specVersion: '0.1.0';
  readonly entries: readonly GuidanceIntentLexiconEntry[];
}

export interface ClassifyGuidanceIntentOptions {
  readonly repositoryRoot?: string | null;
  readonly adapterStatus?: 'missing' | 'available' | 'unknown';
}

export interface RecordGuidanceIntentPhraseOptions {
  readonly repositoryRoot: string;
  readonly phrase: string;
  readonly intent: GuidanceIntent;
  readonly reason: string;
  readonly status?: GuidanceIntentStatus;
  readonly now?: string;
}

const defaultLegacyActionTerms = [
  'atomize',
  'atomization',
  'legacy atom',
  'extract legacy',
  'extract helper',
  'carve',
  'infect',
  'existing atom',
  'reuse atom',
  'transform legacy',
  'split legacy',
  'split old',
  'split hotspot',
  'migrate inherited',
  'refactor monolith',
  'refactor old',
  '原子化',
  '抽原子',
  '原子感染',
  '感染',
  '既有 atom',
  '轉化',
  '分裂',
  '拆分',
  '分拆',
  '舊系統原子',
  '舊流程原子',
  '遺留系統'
];

const defaultLegacyContextTerms = [
  'legacy',
  'old code',
  'old module',
  'old helper',
  'inherited',
  'brownfield',
  'monolith',
  'hotspot',
  'large legacy',
  '舊系統',
  '舊流程',
  '舊程式',
  '舊 helper',
  '舊模組',
  '遺留',
  '大型舊檔',
  '熱點'
];

const defaultLegacyVerbTerms = [
  'refactor',
  'migrate',
  'extract',
  'modernize',
  'convert',
  'transform',
  'evolve',
  'split',
  '拆',
  '改造',
  '轉換',
  '搬遷',
  '抽出'
];

const docsTerms = [
  'docs',
  'documentation',
  'readme',
  'spec',
  'writeup',
  '文件',
  '文檔',
  '規格',
  '說明'
];

const atomCreateTerms = [
  'create atom',
  'new atom',
  'birth atom',
  'greenfield atom',
  '建立 atom',
  '新增 atom',
  '新 atom',
  '生一顆 atom'
];

const upgradeTerms = [
  'upgrade',
  'version',
  'promote',
  'evolve atom',
  '升版',
  '升級',
  '演化版本'
];

const legacyFlow = [
  'atm guide --goal',
  'atm orient',
  'atm start --legacy-flow',
  'atm next',
  'dry-run proposal',
  'human review',
  'rollback proof',
  'guided mutation'
];

const bootstrapFlow = [
  'atm guide --goal',
  'atm bootstrap',
  'atm orient',
  'atm start --legacy-flow'
];

const blockedLegacyAntiPatterns = [
  'search host docs to choose atomize/infect/split manually',
  'direct trunk rewrite',
  'behavior.atomize/infect/split without guidance session',
  'apply without dry-run proposal',
  'apply without human review',
  'promote host-specific trigger terms into framework defaults'
];

export function classifyGuidanceIntent(
  goal: string,
  options: ClassifyGuidanceIntentOptions = {}
): GuidanceIntentClassification {
  const normalizedGoal = normalizeIntentPhrase(goal);
  const activeHostEntries = options.repositoryRoot
    ? loadHostIntentLexicon(options.repositoryRoot).entries.filter((entry) => isActiveLexiconEntry(entry))
    : [];
  const learnedLegacyTerms = activeHostEntries
    .filter((entry) => entry.intent === 'legacy-atomization')
    .map((entry) => entry.normalizedPhrase);

  const legacyActionMatches = matchTerms(normalizedGoal, [...defaultLegacyActionTerms, ...learnedLegacyTerms]);
  const legacyContextMatches = matchTerms(normalizedGoal, defaultLegacyContextTerms);
  const legacyVerbMatches = matchTerms(normalizedGoal, defaultLegacyVerbTerms);
  const docMatches = matchTerms(normalizedGoal, docsTerms);
  const atomCreateMatches = matchTerms(normalizedGoal, atomCreateTerms);
  const upgradeMatches = matchTerms(normalizedGoal, upgradeTerms);

  if (legacyActionMatches.length > 0 || (legacyContextMatches.length > 0 && legacyVerbMatches.length > 0)) {
    const matchedTerms = uniqueStrings([...legacyActionMatches, ...legacyContextMatches, ...legacyVerbMatches]);
    const adapterMissing = options.adapterStatus === 'missing';
    return buildClassification({
      goal,
      matchedIntent: 'legacy-atomization',
      confidence: adapterMissing ? 0.91 : confidenceFromMatches(0.86, matchedTerms.length),
      matchedTerms,
      requiredFlow: adapterMissing ? bootstrapFlow : legacyFlow,
      nextCommand: adapterMissing
        ? 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository" --json'
        : 'node atm.mjs start --cwd . --goal "<goal>" --legacy-flow --json',
      blockedAntiPatterns: blockedLegacyAntiPatterns,
      lexiconSources: activeHostEntries.length > 0 ? ['framework-default', 'host-local'] : ['framework-default']
    });
  }

  if (docMatches.length > 0) {
    return buildClassification({
      goal,
      matchedIntent: 'docs-spec',
      confidence: confidenceFromMatches(0.75, docMatches.length),
      matchedTerms: docMatches,
      requiredFlow: ['atm guide overview', 'docs-first evidence'],
      nextCommand: 'node atm.mjs guide overview --json',
      blockedAntiPatterns: ['host mutation before docs-first evidence'],
      lexiconSources: ['framework-default']
    });
  }

  if (atomCreateMatches.length > 0) {
    return buildClassification({
      goal,
      matchedIntent: 'atom-create',
      confidence: confidenceFromMatches(0.8, atomCreateMatches.length),
      matchedTerms: atomCreateMatches,
      requiredFlow: ['atm guide create-atom', 'atm create --dry-run'],
      nextCommand: 'node atm.mjs guide create-atom --json',
      blockedAntiPatterns: ['hand-roll atom ids', 'write registry before generator output'],
      lexiconSources: ['framework-default']
    });
  }

  if (upgradeMatches.length > 0) {
    return buildClassification({
      goal,
      matchedIntent: 'upgrade-existing',
      confidence: confidenceFromMatches(0.78, upgradeMatches.length),
      matchedTerms: upgradeMatches,
      requiredFlow: ['atm upgrade --propose --dry-run', 'human review'],
      nextCommand: 'node atm.mjs upgrade --propose --dry-run --json',
      blockedAntiPatterns: ['apply upgrade without proposal evidence'],
      lexiconSources: ['framework-default']
    });
  }

  return buildClassification({
    goal,
    matchedIntent: 'unknown',
    confidence: 0.4,
    matchedTerms: [],
    requiredFlow: ['atm orient', 'atm start', 'atm next'],
    nextCommand: 'node atm.mjs orient --cwd . --json',
    blockedAntiPatterns: ['host mutation without guidance session'],
    lexiconSources: activeHostEntries.length > 0 ? ['framework-default', 'host-local'] : ['framework-default']
  });
}

export function loadHostIntentLexicon(repositoryRoot: string): GuidanceIntentLexiconDocument {
  const filePath = hostIntentLexiconPath(repositoryRoot);
  if (!existsSync(filePath)) {
    return emptyLexicon();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<GuidanceIntentLexiconDocument>;
    if (parsed.schemaId !== 'atm.guidanceIntentLexicon' || !Array.isArray(parsed.entries)) {
      return emptyLexicon();
    }
    return {
      schemaId: 'atm.guidanceIntentLexicon',
      specVersion: '0.1.0',
      entries: parsed.entries.flatMap(normalizeLexiconEntry)
    };
  } catch {
    return emptyLexicon();
  }
}

export function recordGuidanceIntentPhrase(options: RecordGuidanceIntentPhraseOptions): {
  readonly lexiconPath: string;
  readonly entry: GuidanceIntentLexiconEntry;
  readonly document: GuidanceIntentLexiconDocument;
  readonly duplicate: boolean;
} {
  const phrase = options.phrase.trim();
  const reason = options.reason.trim();
  if (!phrase) {
    throw new Error('guide learn requires a non-empty phrase.');
  }
  if (!reason) {
    throw new Error('guide learn requires a reason.');
  }
  if (options.intent !== 'legacy-atomization') {
    throw new Error('guide learn currently supports intent legacy-atomization only.');
  }
  const status = options.status ?? 'suggested';
  if (status === 'promoted-framework') {
    assertPromotableFrameworkPhrase(phrase);
  }

  const lexiconPath = hostIntentLexiconPath(options.repositoryRoot);
  const document = loadHostIntentLexicon(options.repositoryRoot);
  const normalizedPhrase = normalizeIntentPhrase(phrase);
  const now = options.now ?? new Date().toISOString();
  let duplicate = false;
  const entries = document.entries.map((entry) => {
    if (entry.normalizedPhrase !== normalizedPhrase || entry.intent !== options.intent) {
      return entry;
    }
    duplicate = true;
    return {
      ...entry,
      phrase,
      reason,
      status,
      updatedAt: now
    };
  });
  const entry: GuidanceIntentLexiconEntry = duplicate
    ? entries.find((candidate) => candidate.normalizedPhrase === normalizedPhrase && candidate.intent === options.intent)!
    : {
        phrase,
        normalizedPhrase,
        intent: options.intent,
        status,
        reason,
        source: status === 'promoted-framework' ? 'framework-promotion' : 'host-local',
        createdAt: now,
        updatedAt: now
      };
  const nextDocument: GuidanceIntentLexiconDocument = {
    schemaId: 'atm.guidanceIntentLexicon',
    specVersion: '0.1.0',
    entries: duplicate ? entries : [...entries, entry]
  };
  mkdirSync(path.dirname(lexiconPath), { recursive: true });
  writeFileSync(lexiconPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8');
  return { lexiconPath, entry, document: nextDocument, duplicate };
}

export function hostIntentLexiconPath(repositoryRoot: string): string {
  return path.join(path.resolve(repositoryRoot), '.atm', 'guidance', 'intent-lexicon.json');
}

export function normalizeIntentPhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[，。！？、；：]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}#/_ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLexiconEntry(entry: unknown): GuidanceIntentLexiconEntry[] {
  if (typeof entry !== 'object' || entry === null) return [];
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.phrase !== 'string') return [];
  if (candidate.intent !== 'legacy-atomization') return [];
  const status = candidate.status === 'active-host' || candidate.status === 'promoted-framework'
    ? candidate.status
    : 'suggested';
  const normalizedPhrase = typeof candidate.normalizedPhrase === 'string'
    ? candidate.normalizedPhrase
    : normalizeIntentPhrase(candidate.phrase);
  const now = new Date().toISOString();
  return [{
    phrase: candidate.phrase,
    normalizedPhrase,
    intent: candidate.intent,
    status,
    reason: typeof candidate.reason === 'string' ? candidate.reason : 'host-local learned phrase',
    source: candidate.source === 'framework-promotion' ? 'framework-promotion' : 'host-local',
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now
  }];
}

function isActiveLexiconEntry(entry: GuidanceIntentLexiconEntry): boolean {
  return entry.status === 'active-host' || entry.status === 'promoted-framework';
}

function matchTerms(normalizedGoal: string, terms: readonly string[]): readonly string[] {
  return uniqueStrings(terms
    .map((term) => normalizeIntentPhrase(term))
    .filter((term) => term && normalizedGoal.includes(term)));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function confidenceFromMatches(base: number, matchCount: number): number {
  return Math.min(0.97, Number((base + Math.max(0, matchCount - 1) * 0.03).toFixed(2)));
}

function buildClassification(input: Omit<GuidanceIntentClassification, 'schemaId' | 'specVersion'>): GuidanceIntentClassification {
  return {
    schemaId: 'atm.guidanceIntentClassification',
    specVersion: '0.1.0',
    ...input
  };
}

function emptyLexicon(): GuidanceIntentLexiconDocument {
  return {
    schemaId: 'atm.guidanceIntentLexicon',
    specVersion: '0.1.0',
    entries: []
  };
}

function assertPromotableFrameworkPhrase(phrase: string): void {
  const normalizedPhrase = normalizeIntentPhrase(phrase);
  if (
    /[a-z]:[\\/]/i.test(phrase)
    || /[/\\]/.test(phrase)
    || /\b[a-z]+[0-9][a-z0-9]*\b/i.test(normalizedPhrase)
    || /\b[a-z0-9]+-[a-z0-9]+-[a-z0-9-]+\b/i.test(normalizedPhrase)
  ) {
    throw new Error('framework promotion requires a neutral, adopter-free phrase.');
  }
}
