import assert from 'node:assert/strict';
import {
  createContentAnchor,
  resolveContentAnchor,
  type ContentAnchorResolverAdapter
} from '../../packages/core/src/broker/boundaries/index.ts';
import { findJavaScriptSymbolAnchors } from '../../packages/language-js/src/index.ts';

const filePath = 'src/example.ts';
const baseDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const createdAt = '2026-07-20T00:00:00.000Z';

const jsAdapter: ContentAnchorResolverAdapter = {
  adapterId: '@ai-atomic-framework/language-js',
  adapterVersion: '0.0.0',
  supports(candidatePath) {
    return candidatePath.endsWith('.js') || candidatePath.endsWith('.ts');
  },
  findSymbol(sourceText, symbolName) {
    return findJavaScriptSymbolAnchors({ filePath, sourceText }, symbolName);
  }
};

const baseSource = [
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export function beta() {',
  '  return 2;',
  '}'
].join('\n');

const anchor = createContentAnchor({
  baseDigest,
  filePath,
  sourceText: baseSource,
  kind: 'symbol',
  symbolName: 'beta',
  lineStart: 5,
  lineEnd: 7,
  provenance: { adapterId: jsAdapter.adapterId, adapterVersion: jsAdapter.adapterVersion, createdAt },
  confidence: 'high'
});

const insertedBefore = [
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export function inserted() {',
  '  return 99;',
  '}',
  '',
  'export function beta() {',
  '  return 2;',
  '}'
].join('\n');

const resolved = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: insertedBefore,
  adapter: jsAdapter
});
assert.equal(resolved.status, 'resolved');
assert.deepEqual(resolved.resolvedLocation, { filePath, lineStart: 9, lineEnd: 11 });

const renamed = resolveContentAnchor({
  anchor,
  currentFilePath: 'src/renamed.ts',
  currentSourceText: insertedBefore,
  adapter: jsAdapter
});
assert.equal(renamed.status, 'stale');

const reordered = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: [
    'export function beta() {',
    '  return 2;',
    '}',
    '',
    'export function alpha() {',
    '  return 1;',
    '}'
  ].join('\n'),
  adapter: jsAdapter
});
assert.equal(reordered.status, 'resolved');
assert.equal(reordered.resolvedLocation?.lineStart, 1);

const duplicate = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: [
    baseSource,
    '',
    'export function beta() {',
    '  return 2;',
    '}'
  ].join('\n'),
  adapter: jsAdapter
});
assert.equal(duplicate.status, 'ambiguous');

const formatted = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: baseSource.replace('  return 2;', '  return  2;'),
  adapter: jsAdapter
});
assert.equal(formatted.status, 'resolved');
assert.equal(formatted.candidateCount, 1);

const baseMismatch = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: baseSource.replace('beta', 'gamma'),
  adapter: jsAdapter
});
assert.equal(baseMismatch.status, 'stale');

const unsupported = resolveContentAnchor({
  anchor,
  currentFilePath: filePath,
  currentSourceText: baseSource,
  adapter: { ...jsAdapter, supports: () => false }
});
assert.equal(unsupported.status, 'unsupported');

console.log('content anchor resolver fixtures passed');
