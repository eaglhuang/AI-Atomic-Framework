import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const templates = ['atm-governance-router','atm-next','atm-task-card-authoring','atm-dispatch','atm-evidence','atm-handoff','atm-upgrade-scan','atm-deep-module-refactor','mailbox-worker-execution'];
for (const id of templates) { const path = `templates/skills/${id}.skill.md`; assert.equal(existsSync(path), true, path); assert.match(readFileSync(path, 'utf8'), /Plan 4|plan4|sealed|authority|evidence/i); }
assert.match(readFileSync('templates/skills/atm-evidence.skill.md', 'utf8'), /unknown mappings fail closed/);
console.log('plan4 skill learning lineage: ok');
