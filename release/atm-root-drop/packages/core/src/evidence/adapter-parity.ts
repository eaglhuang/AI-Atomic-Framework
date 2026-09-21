import { createHash } from 'node:crypto';

export const ADAPTER_PARITY_SCHEMA_ID = 'atm.adapterParityReceipt.v1' as const;
export const EDITORS = ['codex', 'claude-code', 'cursor', 'copilot', 'gemini', 'antigravity'] as const;

type AdapterObservation = {
  readonly editor: string;
  readonly sourceDigest?: string;
  readonly compilerDigest?: string;
  readonly manifestDigest?: string;
  readonly reinstallSmoke?: boolean;
  readonly frozenRunnerSmoke?: boolean;
};

export interface AdapterParityResult {
  readonly schemaId: typeof ADAPTER_PARITY_SCHEMA_ID;
  readonly status: 'proven' | 'blocked';
  readonly sourceDigest: string;
  readonly expectedCompilerDigests: Readonly<Record<string, string>>;
  readonly expectedManifestDigests: Readonly<Record<string, string>>;
  readonly adapters: readonly Required<AdapterObservation>[];
  readonly degraded: readonly string[];
  readonly diagnostics: readonly string[];
  readonly rollback: { readonly supported: true; readonly preservesSourceEvidence: true };
  readonly resultDigest: string;
}

const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const normalize = (value: unknown) => String(value ?? '').trim();

/**
 * Evaluates adapter parity against one sealed projection expectation.
 *
 * The expected manifest digest is per adapter because output format differs by
 * editor.  Source and compiler digests are shared, so a green adapter cannot
 * substitute its values for another adapter's projection.
 */
export function compileAdapterParity(input: {
  readonly sourceDigest: string;
  readonly expectedCompilerDigests: Readonly<Record<string, string>>;
  readonly expectedManifestDigests: Readonly<Record<string, string>>;
  readonly adapters?: readonly AdapterObservation[];
}): AdapterParityResult {
  const sourceDigest = normalize(input?.sourceDigest);
  const expectedCompilerDigests = Object.fromEntries(
    Object.entries(input?.expectedCompilerDigests ?? {}).map(([editor, compilerDigest]) => [editor, normalize(compilerDigest)])
  );
  const expectedManifestDigests = Object.fromEntries(
    Object.entries(input?.expectedManifestDigests ?? {}).map(([editor, manifestDigest]) => [editor, normalize(manifestDigest)])
  );
  const adapters = [...(input?.adapters ?? [])].map((item) => ({
    editor: normalize(item.editor),
    sourceDigest: normalize(item.sourceDigest),
    compilerDigest: normalize(item.compilerDigest),
    manifestDigest: normalize(item.manifestDigest),
    reinstallSmoke: item.reinstallSmoke === true,
    frozenRunnerSmoke: item.frozenRunnerSmoke === true
  })).sort((left, right) => left.editor.localeCompare(right.editor));
  const diagnostics: string[] = [];
  const degraded = new Set<string>();
  const counts = new Map<string, number>();

  for (const adapter of adapters) {
    counts.set(adapter.editor, (counts.get(adapter.editor) ?? 0) + 1);
    if (!EDITORS.includes(adapter.editor as typeof EDITORS[number])) {
      diagnostics.push(`unknown-adapter:${adapter.editor || '<empty>'}`);
      degraded.add(adapter.editor || '<empty>');
    }
  }
  for (const editor of EDITORS) {
    const matches = adapters.filter((adapter) => adapter.editor === editor);
    if (matches.length === 0) {
      diagnostics.push(`missing-adapter:${editor}`);
      degraded.add(editor);
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push(`duplicate-adapter:${editor}`);
      degraded.add(editor);
      continue;
    }
    const adapter = matches[0];
    const expectedManifestDigest = expectedManifestDigests[editor];
    if (!sourceDigest || adapter.sourceDigest !== sourceDigest) {
      diagnostics.push(`source-digest-drift:${editor}`);
      degraded.add(editor);
    }
    if (!expectedCompilerDigests[editor] || adapter.compilerDigest !== expectedCompilerDigests[editor]) {
      diagnostics.push(`compiler-digest-drift:${editor}`);
      degraded.add(editor);
    }
    if (!expectedManifestDigest || adapter.manifestDigest !== expectedManifestDigest) {
      diagnostics.push(`manifest-digest-drift:${editor}`);
      degraded.add(editor);
    }
    if (!adapter.reinstallSmoke) {
      diagnostics.push(`reinstall-smoke-failed:${editor}`);
      degraded.add(editor);
    }
    if (!adapter.frozenRunnerSmoke) {
      diagnostics.push(`frozen-runner-smoke-failed:${editor}`);
      degraded.add(editor);
    }
  }
  for (const editor of Object.keys(expectedManifestDigests)) {
    if (!EDITORS.includes(editor as typeof EDITORS[number])) {
      diagnostics.push(`unexpected-manifest-expectation:${editor}`);
    }
  }
  if (adapters.length !== EDITORS.length) diagnostics.push('six-editor-set-incomplete');

  const status = diagnostics.length === 0 ? 'proven' : 'blocked';
  return {
    schemaId: ADAPTER_PARITY_SCHEMA_ID,
    status,
    sourceDigest,
    expectedCompilerDigests,
    expectedManifestDigests,
    adapters,
    degraded: [...degraded].sort(),
    diagnostics,
    rollback: { supported: true, preservesSourceEvidence: true },
    resultDigest: digest({ sourceDigest, expectedCompilerDigests, expectedManifestDigests, adapters, diagnostics, status })
  };
}

export const createAdapterParity = compileAdapterParity;
