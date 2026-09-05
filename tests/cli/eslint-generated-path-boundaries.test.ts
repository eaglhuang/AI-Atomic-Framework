import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync('eslint.config.mjs', 'utf8');

assert.match(config, /['"]\.atm-runtime-cache\/\*\*['"]/,
  'ESLint must ignore the ATM runtime cache tree');
assert.match(config, /['"]atm-git-hooks-\*\/\*\*['"]/,
  'ESLint must ignore generated hook-host trees');

console.log('eslint-generated-path-boundaries.test: ok');
