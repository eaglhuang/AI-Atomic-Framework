import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const template = readFileSync('templates/skills/atm-dispatch.skill.md', 'utf8');
const installed = [
  '.agents/skills/atm-dispatch/SKILL.md',
  'integrations/codex-skills/atm-dispatch/SKILL.md',
  '.claude/skills/atm-dispatch/SKILL.md',
  '.cursor/rules/skills/atm-dispatch/SKILL.md',
  '.github/instructions/atm-dispatch.instructions.md',
  '.github/prompts/atm-dispatch.prompt.md'
];

function windowsIoSection(content: string): string {
  const start = content.indexOf('## Windows Text Document IO Rule');
  const end = content.indexOf('## Copy-paste Dispatch Packet Rule', start);
  assert.ok(start >= 0 && end > start, 'dispatch skill must expose the Windows text IO section');
  return content.slice(start, end);
}

const section = windowsIoSection(template);
assert.match(section, /Copy-paste-safe read example/);
const example = section.match(/```powershell\n([\s\S]*?)```/)?.[1] ?? '';
assert.match(example, /node --input-type=module/);
assert.match(example, /readFileSync\(file, 'utf8'\)/);
assert.match(example, /process\.argv\[2\]/);
assert.doesNotMatch(example, /node -e|node --eval/);

for (const file of installed) {
  const installedSection = windowsIoSection(readFileSync(file, 'utf8'));
  assert.equal(installedSection, section, `${file} must preserve the safe Windows IO example`);
}

console.log('atm-dispatch Windows text IO guidance: ok');
