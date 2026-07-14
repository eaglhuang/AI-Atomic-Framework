export interface ClosurePacketValidationIssue {
  readonly path: string;
  readonly kind: 'missing' | 'invalidFormat';
  readonly formatExpected?: string;
  readonly actualValue?: string;
}

export interface ClosurePacketValidationResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly invalidFormat: readonly ClosurePacketValidationIssue[];
}
