export interface ExternalTaskSourcePlugin {
  readonly kind: 'external-task-source';
  readonly id: string;          // plugin unique id
  readonly version: string;     // semver

  // 三段式 hook（全 optional，允許 reference impl 漸進落地）
  parse?(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null>;
  validate?(parsed: ParsedExternalTask): Promise<ExternalTaskValidationResult>;
  generate?(intent: ExternalTaskGenerationIntent): Promise<GeneratedExternalTaskCard>;
}

export interface ExternalTaskSourceInput {
  readonly cwd: string;
  readonly sourcePath: string;          // e.g. plan markdown path
  readonly raw: string;                 // 檔案內容
}

export interface ParsedExternalTask {
  readonly taskId: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body?: string;
  readonly sourcePath: string;
}

export interface ExternalTaskValidationResult {
  readonly ok: boolean;
  readonly diagnostics: ReadonlyArray<{ code: string; level: 'error' | 'warning' | 'info'; message: string }>;
}

export interface ExternalTaskGenerationIntent {
  readonly cwd: string;
  readonly templateKey?: string;        // 由 plugin 自行定義，可選
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface GeneratedExternalTaskCard {
  readonly taskId: string;
  readonly sourcePath: string;
  readonly content: string;
}
