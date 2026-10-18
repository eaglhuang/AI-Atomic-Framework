import assert from 'node:assert/strict';
import { computeCandidateAtomCid, inferLanguageId, type BridgeAtomCandidate } from '../../packages/core/src/broker/candidate-bridge.ts';
import { computeAtomContentVersion, normalizeDerivedCandidates } from '../../packages/core/src/broker/derived-atoms.ts';

function candidate(symbol: string, lineStart: number, lineEnd: number, kind = 'function'): BridgeAtomCandidate {
  return { candidateId: `${symbol}:${lineStart}`, kind, symbol, filePath: 'src/a.ts', lineStart, lineEnd, confidence: 'high', detectionMethod: 'scanner' };
}

// TS overload signatures followed by the implementation merge into one atom.
const overloads = normalizeDerivedCandidates([candidate('parse', 1, 9), candidate('parse', 2, 9), candidate('parse', 3, 9), candidate('other', 11, 13)]);
assert.deepEqual(overloads.map((entry) => [entry.symbol, entry.lineStart, entry.lineEnd, entry.ordinal]), [['parse', 1, 9, undefined], ['other', 11, 13, undefined]]);

// Non-adjacent same-name atoms get source-order ordinals and distinct CIDs; unique atoms carry none.
const duplicates = normalizeDerivedCandidates([candidate('run', 20, 25), candidate('helper', 10, 12), candidate('run', 1, 5)]);
assert.deepEqual(duplicates.map((entry) => [entry.symbol, entry.ordinal]), [['run', 0], ['helper', undefined], ['run', 1]]);
const [firstRun, , secondRun] = duplicates;
assert.notEqual(computeCandidateAtomCid(firstRun), computeCandidateAtomCid(secondRun));

// Same kind+symbol in different files are not duplicates of each other.
const crossFile = normalizeDerivedCandidates([candidate('run', 1, 5), { ...candidate('run', 1, 5), filePath: 'src/b.ts' }]);
assert.ok(crossFile.every((entry) => entry.ordinal === undefined));

// Content version: CRLF and LF agree; body edits change it; CID does not.
const lf = 'export function a() {\n  return 1;\n}\n';
const crlf = lf.replace(/\n/g, '\r\n');
assert.equal(computeAtomContentVersion(lf, 1, 3), computeAtomContentVersion(crlf, 1, 3));
assert.notEqual(computeAtomContentVersion(lf, 1, 3), computeAtomContentVersion(lf.replace('1', '2'), 1, 3));
assert.match(computeAtomContentVersion(lf, 1, 3), /^sha256:[0-9a-f]{64}$/);

assert.equal(inferLanguageId('src/a.ts'), 'typescript');
assert.equal(inferLanguageId('lib/b.MJS'), 'javascript');
assert.equal(inferLanguageId('README'), 'unknown');
assert.notEqual(
  computeCandidateAtomCid(candidate('a', 1, 3)),
  computeCandidateAtomCid({ ...candidate('a', 1, 3), filePath: 'src/a.js' }),
  'language is part of identity'
);

console.log('ok: derived atom identity (overload merge, ordinals, content version)');
