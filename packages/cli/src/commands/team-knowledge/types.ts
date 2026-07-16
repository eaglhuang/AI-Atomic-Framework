export type KnowledgeMetadata = {
  repo?: string;
  channel?: string;
  domain?: string;
  paths: string[];
  atoms: string[];
  validators: string[];
};

export type TeamKnowledgeSummary = {
  schemaId: 'atm.teamKnowledgeSummary.v1';
  advisoryOnly: true;
  taskId: string;
  indexStatus: 'ready' | 'missing';
  top: number;
  hits: Array<{
    path: string;
    title: string;
    score: number;
    reason: string;
    snippet: string;
  }>;
  followUpCommand: string;
  buildCommand?: string;
};

export type KnowledgeIndexEntry = {
  id: string;
  path: string;
  title: string;
  metadata: KnowledgeMetadata;
  searchText: string;
  bodySha256?: string;
};

export type KnowledgeIndex = {
  schemaId: 'atm.teamKnowledgeIndex.v1';
  generatedAt: string;
  scope: string;
  advisoryOnly: true;
  canonicalRoot: string;
  entries: KnowledgeIndexEntry[];
};

export type KnowledgeHit = {
  path: string;
  title: string;
  score: number;
  metadata: KnowledgeMetadata;
  snippet: string;
  semanticScore?: number;
  lexicalScore?: number;
  rerankApplied?: boolean;
};

export type KnowledgeEmbeddingCache = {
  schemaId: 'atm.teamKnowledgeEmbeddingCache.v1';
  generatedAt?: string;
  advisoryOnly?: true;
  entries: Array<{
    path: string;
    vector: Record<string, number>;
  }>;
};

export type KnowledgeShardRetention = {
  path: string;
  title: string;
  status: string | null;
  supersededBy: string | null;
  archiveCandidate: boolean;
  reasons: string[];
  bytes: number;
};

export type RuntimeBudgetStatus = 'ok' | 'warning' | 'hard-limit';
